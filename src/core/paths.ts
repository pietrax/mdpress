import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Radice del pacchetto: vale sia per src/core (sviluppo) sia per dist/core (build). */
export const packageRoot = resolve(here, '..', '..');
export const builtinTemplatesDir = join(packageRoot, 'templates');
export const assetsDir = join(packageRoot, 'assets');
export const webDistDir = join(packageRoot, 'dist', 'web');

export function mdpressHome(): string {
  return process.env.MDPRESS_HOME ?? join(homedir(), '.config', 'mdpress');
}

export function userTemplatesDir(): string {
  return join(mdpressHome(), 'templates');
}

export function configPath(): string {
  return join(mdpressHome(), 'config.json');
}
