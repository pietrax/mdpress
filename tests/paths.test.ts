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
  it('packageRoot is the package root', () => {
    expect(existsSync(join(packageRoot, 'package.json'))).toBe(true);
  });
  it('defaults to ~/.config/mdpress', () => {
    delete process.env.MDPRESS_HOME;
    expect(mdpressHome()).toBe(join(homedir(), '.config', 'mdpress'));
  });
  it('MDPRESS_HOME overrides the root', () => {
    process.env.MDPRESS_HOME = '/tmp/home';
    expect(userTemplatesDir()).toBe('/tmp/home/templates');
    expect(configPath()).toBe('/tmp/home/config.json');
  });
});

describe('errors', () => {
  it('exitCodeFor: 2 for missing dependencies, 1 otherwise', () => {
    expect(exitCodeFor(new MdpressError('errors.dependenciesMissing', 'DEPENDENCY_MISSING', { list: 'x' }))).toBe(2);
    expect(exitCodeFor(new MdpressError('errors.formatMissing', 'BAD_INPUT'))).toBe(1);
    expect(exitCodeFor(new Error('x'))).toBe(1);
  });
});
