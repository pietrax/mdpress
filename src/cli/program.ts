import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Command, CommanderError } from 'commander';
import { Catalog } from '../core/catalog.js';
import { defaultTemplateRef, readConfig, writeConfig } from '../core/config.js';
import { checkDeps } from '../core/deps.js';
import { MdpressError, exitCodeFor, localizeIssue } from '../core/errors.js';
import { parseFormats } from '../core/options.js';
import { packageRoot } from '../core/paths.js';
import { localizeWarning, renderFile } from '../core/render.js';

export interface CliIO {
  out(line: string): void;
  err(line: string): void;
}

export const stdio: CliIO = {
  out: (line) => process.stdout.write(line + '\n'),
  err: (line) => process.stderr.write(line + '\n'),
};

const version: string = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')).version;

interface State {
  code: number;
}

function buildProgram(io: CliIO, state: State, catalog: Catalog): Command {
  const program = new Command('mdpress')
    .description('Impagina Markdown in PDF e DOCX con template personalizzabili')
    .version(version)
    .exitOverride()
    .configureOutput({ writeOut: (s) => io.out(s.trimEnd()), writeErr: (s) => io.err(s.trimEnd()) });

  program
    .command('render <file>')
    .description('Impagina un file Markdown')
    .option('-t, --template <ref>', 'id o slug del template')
    .option('-f, --format <formati>', 'pdf, docx o pdf,docx', 'pdf')
    .option('-o, --output <percorso>', 'file o cartella (con / finale) di destinazione')
    .option('--toc', 'includi l’indice')
    .option('--no-toc', 'escludi l’indice')
    .option('--cover', 'forza la copertina')
    .option('--no-cover', 'escludi la copertina')
    .option('--debug', 'conserva la cartella di lavoro')
    .action(async (file: string, o: { template?: string; format: string; output?: string; toc?: boolean; cover?: boolean; debug?: boolean }) => {
      const result = await renderFile(file, {
        templateRef: o.template,
        formats: parseFormats(o.format),
        output: o.output,
        overrides: { toc: o.toc, cover: o.cover },
        debug: o.debug,
        catalog,
      });
      for (const w of result.warnings) io.err(`⚠ ${localizeWarning(w, 'en')}`);
      for (const p of result.outputs) io.out(`✓ ${p}`);
      for (const d of result.workDirs) io.out(`Cartella di lavoro: ${d}`);
    });

  const templates = program.command('templates').description('Gestisce il catalogo dei template');

  templates.command('list').description('Elenca i template').action(async () => {
    const def = await defaultTemplateRef();
    for (const e of await catalog.list()) {
      const t = e.template;
      const mark = t.id === def || t.slug === def ? '*' : ' ';
      io.out(`${mark} ${t.id}  ${t.slug.padEnd(20)} ${t.name}${e.builtin ? '  (built-in)' : ''}`);
    }
  });

  templates.command('show <ref>').description('Mostra il JSON di un template').action(async (ref: string) => {
    io.out(JSON.stringify((await catalog.resolve(ref)).template, null, 2));
  });

  templates
    .command('new <slug>')
    .description('Crea un template (vuoto o copia di un altro)')
    .option('--from <ref>', 'template da duplicare')
    .option('--name <nome>', 'nome leggibile')
    .action(async (slug: string, o: { from?: string; name?: string }) => {
      const e = o.from ? await catalog.duplicate(o.from, slug, o.name) : await catalog.create({ slug, name: o.name ?? slug });
      io.out(`✓ creato ${e.template.slug} (${e.template.id}) in ${e.dir}`);
    });

  templates.command('import <file>').description('Importa un template da .zip').action(async (file: string) => {
    let data: Buffer;
    try {
      data = await readFile(file);
    } catch {
      throw new MdpressError('errors.fileNotFound', 'BAD_INPUT', { file });
    }
    const e = await catalog.importZip(data);
    io.out(`✓ importato ${e.template.slug} (${e.template.id})`);
  });

  templates
    .command('export <ref>')
    .description('Esporta un template in .zip')
    .option('-o, --output <file>', 'file .zip di destinazione')
    .action(async (ref: string, o: { output?: string }) => {
      const e = await catalog.resolve(ref);
      const out = resolve(o.output ?? `${e.template.slug}.zip`);
      await writeFile(out, await catalog.exportZip(ref));
      io.out(`✓ ${out}`);
    });

  templates.command('delete <ref>').description('Elimina un template utente').action(async (ref: string) => {
    const entry = await catalog.resolve(ref);
    await catalog.remove(ref);
    io.out(`✓ eliminato ${ref}`);
    const config = await readConfig();
    if (config.defaultTemplate === entry.template.id || config.defaultTemplate === entry.template.slug) {
      delete config.defaultTemplate;
      await writeConfig(config);
      io.out('Il template eliminato era quello di default: il default è tornato a standard.');
    }
  });

  templates
    .command('default [ref]')
    .description('Mostra o imposta il template di default')
    .action(async (ref?: string) => {
      if (!ref) {
        io.out(await defaultTemplateRef());
        return;
      }
      const e = await catalog.resolve(ref);
      await writeConfig({ ...(await readConfig()), defaultTemplate: e.template.id });
      io.out(`✓ template di default: ${e.template.slug} (${e.template.id})`);
    });

  program
    .command('serve')
    .description('Avvia l’interfaccia web locale')
    .option('-p, --port <porta>', 'porta', '4321')
    .option('--no-open', 'non aprire il browser')
    .action(async (o: { port: string; open: boolean }) => {
      const port = Number(o.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new MdpressError('errors.portInvalid', 'BAD_INPUT', { port: o.port });
      }
      const { startServer } = await import('../server/app.js');
      try {
        const { url } = await startServer({ port, open: o.open, catalog });
        io.out(`mdpress è in ascolto su ${url} (Ctrl+C per uscire)`);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
          throw new MdpressError('errors.portInUse', 'BAD_INPUT', { port, next: port + 1 });
        }
        throw err;
      }
    });

  program.command('doctor').description('Verifica pandoc e typst').action(async () => {
    const deps = await checkDeps(true);
    for (const d of deps) {
      io.out(`${d.ok ? '✓' : '✗'} ${d.name} ${d.found ? (d.version ?? '?') : 'non trovato'} (richiesta ≥ ${d.min})`);
    }
    if (deps.some((d) => !d.ok)) {
      io.err('Installa le dipendenze con: brew install pandoc typst');
      state.code = 2;
    }
  });

  return program;
}

export async function main(argv: string[], io: CliIO = stdio, catalog: Catalog = Catalog.default()): Promise<number> {
  const state: State = { code: 0 };
  try {
    await buildProgram(io, state, catalog).parseAsync(argv);
    return state.code;
  } catch (err) {
    if (err instanceof CommanderError) return err.exitCode;
    if (err instanceof MdpressError) {
      io.err(`Error: ${err.message}`);
      for (const issue of err.issues) io.err(`  ${issue.path || '(root)'}: ${localizeIssue(issue, 'en')}`);
      return exitCodeFor(err);
    }
    io.err(`Errore inatteso: ${(err as Error).stack ?? String(err)}`);
    return 1;
  }
}
