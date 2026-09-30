import { afterEach, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultTemplateRef, readConfig, writeConfig } from '../src/core/config.js';
import { tempDir } from './helpers.js';

const saved = process.env.MDPRESS_HOME;
afterEach(() => {
  if (saved === undefined) delete process.env.MDPRESS_HOME;
  else process.env.MDPRESS_HOME = saved;
});

it('without a config uses standard, then saves the chosen default', async () => {
  process.env.MDPRESS_HOME = join(await tempDir(), 'home');
  expect(await readConfig()).toEqual({});
  expect(await defaultTemplateRef()).toBe('standard');
  await writeConfig({ defaultTemplate: 'abc12345' });
  expect(await defaultTemplateRef()).toBe('abc12345');
});

it('a corrupted config.json gives a clear error', async () => {
  const home = await tempDir();
  process.env.MDPRESS_HOME = home;
  await writeFile(join(home, 'config.json'), '{ broken');
  await expect(readConfig()).rejects.toMatchObject({ key: 'errors.configInvalid', code: 'BAD_INPUT' });
});
