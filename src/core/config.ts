import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { MdpressError } from './errors.js';
import { configPath } from './paths.js';

export interface Config {
  defaultTemplate?: string;
}

export const BUILTIN_DEFAULT_TEMPLATE = 'standard';

export async function readConfig(): Promise<Config> {
  let raw: string;
  try {
    raw = await readFile(configPath(), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Config) : {};
  } catch {
    throw new MdpressError(`config.json non valido: ${configPath()}`, 'BAD_INPUT');
  }
}

export async function writeConfig(config: Config): Promise<void> {
  await mkdir(dirname(configPath()), { recursive: true });
  await writeFile(configPath(), JSON.stringify(config, null, 2) + '\n');
}

export async function defaultTemplateRef(): Promise<string> {
  return (await readConfig()).defaultTemplate ?? BUILTIN_DEFAULT_TEMPLATE;
}
