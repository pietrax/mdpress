import { access, copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MdpressError } from './errors.js';
import { builtinTemplatesDir, userTemplatesDir } from './paths.js';
import { LOGO_FILE_RE, newId, parseTemplate, type Template } from './theme.js';

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

function isImage(data: Buffer, ext: 'png' | 'jpg'): boolean {
  if (ext === 'png') return data.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
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
      throw new MdpressError(
        `Template "${ref}" non trovato. Usa "mdpress templates list" per vedere quelli disponibili.`,
        'TEMPLATE_NOT_FOUND',
      );
    }
    return hit;
  }

  async create(input: Record<string, unknown>): Promise<CatalogEntry> {
    const template = parseTemplate({ ...input, id: newId(), schemaVersion: 1 });
    await this.assertSlugFree(template.slug);
    return this.write(template);
  }

  async update(ref: string, input: Record<string, unknown>): Promise<CatalogEntry> {
    const current = await this.writable(ref);
    const template = parseTemplate({ ...input, id: current.template.id, schemaVersion: 1 });
    if (template.slug !== current.template.slug) {
      await this.assertSlugFree(template.slug, template.id);
      await rename(current.dir, join(this.opts.userDir, template.slug));
    }
    return this.write(template);
  }

  async duplicate(ref: string, slug: string, name?: string): Promise<CatalogEntry> {
    const source = await this.resolve(ref);
    const template = parseTemplate({
      ...source.template,
      id: newId(),
      slug,
      name: name ?? `${source.template.name} (copia)`,
    });
    await this.assertSlugFree(template.slug);
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
    if ((normalized !== 'png' && normalized !== 'jpg') || !isImage(data, normalized)) {
      throw new MdpressError('Il logo deve essere un file PNG o JPG', 'BAD_INPUT');
    }
    for (const file of await readdir(entry.dir)) {
      if (LOGO_FILE_RE.test(file)) await rm(join(entry.dir, file));
    }
    const file = `logo.${normalized}`;
    await writeFile(join(entry.dir, file), data);
    return this.write({ ...entry.template, logo: { ...entry.template.logo, file } });
  }

  protected async write(template: Template): Promise<CatalogEntry> {
    const dir = join(this.opts.userDir, template.slug);
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
      throw new MdpressError(
        `"${entry.template.name}" è un template built-in: duplicalo per modificarlo`,
        'TEMPLATE_READONLY',
      );
    }
    return entry;
  }

  private async assertSlugFree(slug: string, exceptId?: string): Promise<void> {
    const all = await this.list();
    if (all.some((e) => e.template.slug === slug && e.template.id !== exceptId)) {
      throw new MdpressError(`Esiste già un template con slug "${slug}"`, 'SLUG_TAKEN');
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
        process.emitWarning(`mdpress: template ignorato in ${dir}: ${(err as Error).message}`);
      }
    }
    return entries.sort((a, b) => a.template.name.localeCompare(b.template.name));
  }
}
