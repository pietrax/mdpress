import { access, copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import JSZip from 'jszip';
import { MdpressError } from './errors.js';
import { builtinTemplatesDir, userTemplatesDir } from './paths.js';
import { ID_RE, LOGO_FILE_RE, newId, parseTemplate, type Template } from './theme.js';
import { uniqueSlug } from './slug.js';

export const TEMPLATE_FILE = 'template.json';

export interface CatalogEntry {
  template: Template;
  dir: string;
  builtin: boolean;
  logoPath: string | null;
}

export interface CatalogOptions {
  builtinDir: string;
  userDir: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isImage(data: Buffer, ext: 'png' | 'jpg' | 'svg'): boolean {
  if (ext === 'png') return data.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  if (ext === 'svg') return /^(?:\uFEFF)?\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*<svg[\s>]/i.test(data.subarray(0, 4096).toString('utf8'));
  return data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
}

export class Catalog {
  constructor(readonly opts: CatalogOptions) {}

  static default(): Catalog {
    return new Catalog({ builtinDir: builtinTemplatesDir, userDir: userTemplatesDir() });
  }

  async list(): Promise<CatalogEntry[]> {
    return [...(await this.loadDir(this.opts.builtinDir, true)), ...(await this.loadDir(this.opts.userDir, false))];
  }

  async resolve(ref: string): Promise<CatalogEntry> {
    const all = await this.list();
    const hit = all.find((e) => e.template.id === ref) ?? all.find((e) => e.template.slug === ref);
    if (!hit) {
      throw new MdpressError('errors.templateNotFound', 'TEMPLATE_NOT_FOUND', { ref });
    }
    return hit;
  }

  async create(input: Record<string, unknown>): Promise<CatalogEntry> {
    const template = parseTemplate({ ...input, id: newId(), schemaVersion: 1 });
    await this.assertSlugFree(template.slug);
    await this.assertDirFree(join(this.opts.userDir, template.slug));
    return this.write(template);
  }

  async update(ref: string, input: Record<string, unknown>): Promise<CatalogEntry> {
    const current = await this.writable(ref);
    const template = parseTemplate({ ...input, id: current.template.id, schemaVersion: 1 });
    let targetDir = current.dir;
    if (template.slug !== current.template.slug) {
      await this.assertSlugFree(template.slug, template.id);
      await this.assertDirFree(join(this.opts.userDir, template.slug));
      targetDir = join(this.opts.userDir, template.slug);
      await rename(current.dir, targetDir);
    }
    return this.write(template, targetDir);
  }

  async duplicate(ref: string, slug: string, name?: string): Promise<CatalogEntry> {
    const source = await this.resolve(ref);
    const template = parseTemplate({
      ...source.template,
      id: newId(),
      slug,
      name: name ?? `${source.template.name} (copy)`,
    });
    await this.assertSlugFree(template.slug);
    await this.assertDirFree(join(this.opts.userDir, template.slug));
    const entry = await this.write(template);
    if (source.logoPath && template.logo.file) {
      await copyFile(source.logoPath, join(entry.dir, template.logo.file));
      return this.entry(template, entry.dir, false);
    }
    return entry;
  }

  async remove(ref: string): Promise<void> {
    const entry = await this.writable(ref);
    await rm(entry.dir, { recursive: true, force: true });
  }

  async setLogo(ref: string, data: Buffer, ext: string): Promise<CatalogEntry> {
    const entry = await this.writable(ref);
    const normalized = ext.toLowerCase() === 'jpeg' ? 'jpg' : ext.toLowerCase();
    if ((normalized !== 'png' && normalized !== 'jpg' && normalized !== 'svg') || !isImage(data, normalized)) {
      throw new MdpressError('errors.logoType', 'BAD_INPUT');
    }
    if (data.length > 2 * 1024 * 1024) {
      throw new MdpressError('errors.logoTooLarge', 'BAD_INPUT');
    }
    const file = `logo.${normalized}`;
    const filePath = join(entry.dir, file);
    // Write the new logo first
    await writeFile(filePath, data);
    // Update the template with the new logo file
    const updated = { ...entry.template, logo: { ...entry.template.logo, file } };
    await this.write(updated, entry.dir);
    // Remove old logo files (not the one just written)
    for (const oldFile of await readdir(entry.dir)) {
      if (LOGO_FILE_RE.test(oldFile) && oldFile !== file) {
        await rm(join(entry.dir, oldFile));
      }
    }
    return this.entry(updated, entry.dir, false);
  }

  async exportZip(ref: string): Promise<Buffer> {
    const entry = await this.resolve(ref);
    const zip = new JSZip();
    zip.file(TEMPLATE_FILE, JSON.stringify(entry.template, null, 2) + '\n');
    if (entry.logoPath && entry.template.logo.file) {
      zip.file(entry.template.logo.file, await readFile(entry.logoPath));
    }
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  }

  async importZip(data: Buffer): Promise<CatalogEntry> {
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(data);
    } catch {
      throw new MdpressError('errors.zipInvalid', 'BAD_INPUT');
    }
    const jsonFile = zip.file(TEMPLATE_FILE) ?? zip.file(/(^|\/)template\.json$/)[0];
    if (!jsonFile) throw new MdpressError('errors.zipNoTemplate', 'BAD_INPUT');
    const prefix = jsonFile.name.slice(0, -TEMPLATE_FILE.length);

    let raw: unknown;
    try {
      raw = JSON.parse(await jsonFile.async('string'));
    } catch {
      throw new MdpressError('errors.zipBadJson', 'BAD_INPUT');
    }
    const input = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    const parsed = parseTemplate({
      ...input,
      id: typeof input.id === 'string' && ID_RE.test(input.id) ? input.id : newId(),
    });

    const all = await this.list();
    const id = all.some((e) => e.template.id === parsed.id) ? newId() : parsed.id;

    // Collect taken slugs from the catalog and existing folder names
    let existingDirs: string[] = [];
    try {
      existingDirs = await readdir(this.opts.userDir);
    } catch {
      // ignore ENOENT
    }
    const taken = [...all.map((e) => e.template.slug), ...existingDirs];
    const slug = uniqueSlug(parsed.slug, taken);
    const logoFile = parsed.logo.file ? zip.file(prefix + parsed.logo.file) : null;

    // Check the logo size limit if present
    if (logoFile) {
      const logoData = await logoFile.async('nodebuffer');
      if (logoData.length > 2 * 1024 * 1024) {
        throw new MdpressError('errors.logoTooLarge', 'BAD_INPUT');
      }
    }

    const template: Template = {
      ...parsed,
      id,
      slug,
      logo: { ...parsed.logo, file: logoFile ? parsed.logo.file : null },
    };

    const entry = await this.write(template);
    if (logoFile && template.logo.file) {
      await writeFile(join(entry.dir, template.logo.file), await logoFile.async('nodebuffer'));
      return this.entry(template, entry.dir, false);
    }
    return entry;
  }

  protected async write(template: Template, dir = join(this.opts.userDir, template.slug)): Promise<CatalogEntry> {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, TEMPLATE_FILE), JSON.stringify(template, null, 2) + '\n');
    return this.entry(template, dir, false);
  }

  protected async entry(template: Template, dir: string, builtin: boolean): Promise<CatalogEntry> {
    const logoPath = template.logo.file ? join(dir, template.logo.file) : null;
    return { template, dir, builtin, logoPath: logoPath && (await exists(logoPath)) ? logoPath : null };
  }

  private async writable(ref: string): Promise<CatalogEntry> {
    const entry = await this.resolve(ref);
    if (entry.builtin) {
      throw new MdpressError('errors.templateReadonly', 'TEMPLATE_READONLY', { name: entry.template.name });
    }
    return entry;
  }

  private async assertSlugFree(slug: string, exceptId?: string): Promise<void> {
    const all = await this.list();
    if (all.some((e) => e.template.slug === slug && e.template.id !== exceptId)) {
      throw new MdpressError('errors.slugTaken', 'SLUG_TAKEN', { slug });
    }
  }

  private async assertDirFree(dir: string): Promise<void> {
    if (await exists(dir)) {
      const slug = dir.split('/').pop() || '';
      throw new MdpressError('errors.folderTaken', 'SLUG_TAKEN', { slug });
    }
  }

  private async loadDir(root: string, builtin: boolean): Promise<CatalogEntry[]> {
    let names: string[];
    try {
      names = await readdir(root);
    } catch {
      return [];
    }
    const entries: CatalogEntry[] = [];
    for (const name of names) {
      const dir = join(root, name);
      const file = join(dir, TEMPLATE_FILE);
      if (!(await exists(file))) continue;
      try {
        const template = parseTemplate(JSON.parse(await readFile(file, 'utf8')));
        entries.push(await this.entry(template, dir, builtin));
      } catch (err) {
        process.emitWarning(`mdpress: skipped template in ${dir}: ${(err as Error).message}`);
      }
    }
    return entries.sort((a, b) => a.template.name.localeCompare(b.template.name));
  }
}
