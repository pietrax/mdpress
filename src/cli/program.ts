import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Command, CommanderError, Help } from 'commander';
import { Catalog } from '../core/catalog.js';
import { defaultTemplateRef, readConfig, writeConfig, type Config } from '../core/config.js';
import { checkDeps } from '../core/deps.js';
import { MdpressError, exitCodeFor, localizeIssue } from '../core/errors.js';
import { LANGUAGES, t, type Language, type Params } from '../i18n/index.js';
import { UnsupportedLanguageError, detectLanguage } from '../i18n/detect.js';
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

/** Commander hardcodes its help headings and the "default:" label in English: map them here. */
function localizedHelp(tr: (key: string) => string) {
  const titles: Record<string, string> = {
    'Usage:': tr('cli.help.usage'),
    'Options:': tr('cli.help.options'),
    'Global Options:': tr('cli.help.globalOptions'),
    'Commands:': tr('cli.help.commands'),
    'Arguments:': tr('cli.help.arguments'),
  };
  const defaults = (text: string) => text.replace(/\(default: /g, `(${tr('cli.help.default')}: `);
  return {
    styleTitle: (str: string) => titles[str] ?? str,
    optionDescription(this: Help, option: Parameters<Help['optionDescription']>[0]) {
      return defaults(Help.prototype.optionDescription.call(this, option));
    },
    argumentDescription(this: Help, argument: Parameters<Help['argumentDescription']>[0]) {
      return defaults(Help.prototype.argumentDescription.call(this, argument));
    },
  };
}

const PARSE_ERRORS: Record<string, string> = {
  'commander.unknownOption': 'cli.parse.unknownOption',
  'commander.unknownCommand': 'cli.parse.unknownCommand',
  'commander.missingArgument': 'cli.parse.missingArgument',
  'commander.optionMissingArgument': 'cli.parse.optionMissingArgument',
  'commander.excessArguments': 'cli.parse.excessArguments',
};

function buildProgram(io: CliIO, state: State, catalog: Catalog, lang: Language): Command {
  const tr = (key: string, params?: Params) => t(key, params, lang);
  const program = new Command('mdpress')
    .description(tr('cli.description'))
    .option('--lang <lang>', tr('cli.options.lang'))
    .version(version, '-V, --version', tr('cli.options.version'))
    .helpOption('-h, --help', tr('cli.options.help'))
    .helpCommand('help [command]', tr('cli.options.helpCommand'))
    .exitOverride()
    .configureHelp(localizedHelp(tr))
    // Parse errors are printed by main() in the chosen language, so commander's own English line is muted.
    .configureOutput({ writeOut: (s) => io.out(s.trimEnd()), writeErr: (s) => io.err(s.trimEnd()), outputError: () => {} });

  program
    .command('render <file>')
    .description(tr('cli.render.description'))
    .option('-t, --template <ref>', tr('cli.render.template'))
    .option('-f, --format <formats>', tr('cli.render.format'), 'pdf')
    .option('-o, --output <path>', tr('cli.render.output'))
    .option('--toc', tr('cli.render.toc'))
    .option('--no-toc', tr('cli.render.noToc'))
    .option('--cover', tr('cli.render.cover'))
    .option('--no-cover', tr('cli.render.noCover'))
    .option('--debug', tr('cli.render.debug'))
    .action(async (file: string, o: { template?: string; format: string; output?: string; toc?: boolean; cover?: boolean; debug?: boolean }) => {
      const result = await renderFile(file, {
        templateRef: o.template,
        formats: parseFormats(o.format),
        output: o.output,
        overrides: { toc: o.toc, cover: o.cover },
        debug: o.debug,
        catalog,
      });
      for (const w of result.warnings) io.err(tr('cli.render.warning', { message: localizeWarning(w, lang) }));
      for (const p of result.outputs) io.out(tr('cli.render.written', { path: p }));
      for (const d of result.workDirs) io.out(tr('cli.render.workDir', { dir: d }));
    });

  const templates = program.command('templates').description(tr('cli.templates.description'));

  templates.command('list').description(tr('cli.templates.list')).action(async () => {
    const def = await defaultTemplateRef();
    for (const e of await catalog.list()) {
      const tpl = e.template;
      const mark = tpl.id === def || tpl.slug === def ? '*' : ' ';
      io.out(`${mark} ${tpl.id}  ${tpl.slug.padEnd(20)} ${tpl.name}${e.builtin ? `  ${tr('cli.templates.builtin')}` : ''}`);
    }
  });

  templates.command('show <ref>').description(tr('cli.templates.show')).action(async (ref: string) => {
    io.out(JSON.stringify((await catalog.resolve(ref)).template, null, 2));
  });

  templates
    .command('new <slug>')
    .description(tr('cli.templates.new'))
    .option('--from <ref>', tr('cli.templates.from'))
    .option('--name <name>', tr('cli.templates.name'))
    .action(async (slug: string, o: { from?: string; name?: string }) => {
      const e = o.from ? await catalog.duplicate(o.from, slug, o.name) : await catalog.create({ slug, name: o.name ?? slug });
      io.out(tr('cli.templates.created', { slug: e.template.slug, id: e.template.id, dir: e.dir }));
    });

  templates.command('import <file>').description(tr('cli.templates.import')).action(async (file: string) => {
    let data: Buffer;
    try {
      data = await readFile(file);
    } catch {
      throw new MdpressError('errors.fileNotFound', 'BAD_INPUT', { file });
    }
    const e = await catalog.importZip(data);
    io.out(tr('cli.templates.imported', { slug: e.template.slug, id: e.template.id }));
  });

  templates
    .command('export <ref>')
    .description(tr('cli.templates.export'))
    .option('-o, --output <file>', tr('cli.templates.exportOutput'))
    .action(async (ref: string, o: { output?: string }) => {
      const e = await catalog.resolve(ref);
      const out = resolve(o.output ?? `${e.template.slug}.zip`);
      await writeFile(out, await catalog.exportZip(ref));
      io.out(tr('cli.templates.exported', { path: out }));
    });

  templates.command('delete <ref>').description(tr('cli.templates.delete')).action(async (ref: string) => {
    const entry = await catalog.resolve(ref);
    await catalog.remove(ref);
    io.out(tr('cli.templates.deleted', { ref }));
    const config = await readConfig();
    if (config.defaultTemplate === entry.template.id || config.defaultTemplate === entry.template.slug) {
      delete config.defaultTemplate;
      await writeConfig(config);
      io.out(tr('cli.templates.defaultReset'));
    }
  });

  templates
    .command('default [ref]')
    .description(tr('cli.templates.default'))
    .action(async (ref?: string) => {
      if (!ref) {
        io.out(await defaultTemplateRef());
        return;
      }
      const e = await catalog.resolve(ref);
      await writeConfig({ ...(await readConfig()), defaultTemplate: e.template.id });
      io.out(tr('cli.templates.defaultSet', { slug: e.template.slug, id: e.template.id }));
    });

  program
    .command('serve')
    .description(tr('cli.serve.description'))
    .option('-p, --port <port>', tr('cli.serve.port'), '4321')
    .option('--no-open', tr('cli.serve.noOpen'))
    .action(async (o: { port: string; open: boolean }) => {
      const port = Number(o.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new MdpressError('errors.portInvalid', 'BAD_INPUT', { port: o.port });
      }
      const { startServer } = await import('../server/app.js');
      try {
        const { url } = await startServer({ port, open: o.open, catalog, language: lang });
        io.out(tr('cli.serve.listening', { url }));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
          throw new MdpressError('errors.portInUse', 'BAD_INPUT', { port, next: port + 1 });
        }
        throw err;
      }
    });

  program.command('doctor').description(tr('cli.doctor.description')).action(async () => {
    const deps = await checkDeps(true);
    for (const d of deps) {
      const mark = d.ok ? '✓' : '✗';
      io.out(
        d.found
          ? tr('cli.doctor.found', { mark, name: d.name, version: d.version ?? '?', min: d.min })
          : tr('cli.doctor.notFound', { mark, name: d.name, min: d.min }),
      );
    }
    if (deps.some((d) => !d.ok)) {
      io.err(tr('cli.doctor.install'));
      state.code = 2;
    }
  });

  return program;
}

/** Removes --lang from argv (it is a global option accepted anywhere) and returns its value. */
function extractLangFlag(argv: string[]): { argv: string[]; flag?: string } {
  const rest: string[] = [];
  let flag: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--lang') {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('-')) flag = '';
      else {
        flag = next;
        i++;
      }
    } else if (arg.startsWith('--lang=')) {
      flag = arg.slice('--lang='.length);
    } else {
      rest.push(arg);
    }
  }
  return { argv: rest, flag };
}

export async function main(
  argv: string[],
  io: CliIO = stdio,
  catalog: Catalog = Catalog.default(),
  env: Record<string, string | undefined> = process.env,
): Promise<number> {
  const { argv: args, flag } = extractLangFlag(argv);
  const config = await readConfig().catch(() => ({}) as Config);
  let lang: Language;
  try {
    lang = detectLanguage({ flag, config: config.language, env });
  } catch (err) {
    if (!(err instanceof UnsupportedLanguageError)) throw err;
    const fallback = detectLanguage({ config: config.language, env });
    const supported = LANGUAGES.join(', ');
    io.err(
      err.value.trim() === ''
        ? t('errors.languageMissing', { supported }, fallback)
        : t('errors.unsupportedLanguage', { lang: err.value, supported }, fallback),
    );
    return 1;
  }
  const state: State = { code: 0 };
  try {
    await buildProgram(io, state, catalog, lang).parseAsync(args);
    return state.code;
  } catch (err) {
    if (err instanceof CommanderError) {
      const key = PARSE_ERRORS[err.code];
      if (key) io.err(t(key, { token: /'([^']*)'/.exec(err.message)?.[1] ?? '' }, lang));
      return err.exitCode;
    }
    if (err instanceof MdpressError) {
      io.err(t('cli.errorPrefix', { message: err.localize(lang) }, lang));
      for (const issue of err.issues) io.err(`  ${issue.path || t('cli.issueRoot', {}, lang)}: ${localizeIssue(issue, lang)}`);
      return exitCodeFor(err);
    }
    io.err(t('cli.unexpectedError', { details: (err as Error).stack ?? String(err) }, lang));
    return 1;
  }
}
