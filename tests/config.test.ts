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

it('senza config usa standard, poi salva il default scelto', async () => {
  process.env.MDPRESS_HOME = join(await tempDir(), 'home');
  expect(await readConfig()).toEqual({});
  expect(await defaultTemplateRef()).toBe('standard');
  await writeConfig({ defaultTemplate: 'abc12345' });
  expect(await defaultTemplateRef()).toBe('abc12345');
});

it('config.json corrotto dà un errore chiaro', async () => {
  const home = await tempDir();
  process.env.MDPRESS_HOME = home;
  await writeFile(join(home, 'config.json'), '{ rotto');
  await expect(readConfig()).rejects.toThrow(/config\.json non valido/);
});
