import { afterEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { configPath, mdpressHome, packageRoot, userTemplatesDir } from '../src/core/paths.js';
import { MdpressError, exitCodeFor } from '../src/core/errors.js';

const saved = process.env.MDPRESS_HOME;
afterEach(() => {
  if (saved === undefined) delete process.env.MDPRESS_HOME;
  else process.env.MDPRESS_HOME = saved;
});

describe('paths', () => {
  it('packageRoot è la radice del pacchetto', () => {
    expect(existsSync(join(packageRoot, 'package.json'))).toBe(true);
  });
  it('usa ~/.config/mdpress di default', () => {
    delete process.env.MDPRESS_HOME;
    expect(mdpressHome()).toBe(join(homedir(), '.config', 'mdpress'));
  });
  it('MDPRESS_HOME sovrascrive la radice', () => {
    process.env.MDPRESS_HOME = '/tmp/casa';
    expect(userTemplatesDir()).toBe('/tmp/casa/templates');
    expect(configPath()).toBe('/tmp/casa/config.json');
  });
});

describe('errors', () => {
  it('exitCodeFor: 2 per dipendenze mancanti, 1 altrimenti', () => {
    expect(exitCodeFor(new MdpressError('x', 'DEPENDENCY_MISSING'))).toBe(2);
    expect(exitCodeFor(new MdpressError('x', 'BAD_INPUT'))).toBe(1);
    expect(exitCodeFor(new Error('x'))).toBe(1);
  });
});
