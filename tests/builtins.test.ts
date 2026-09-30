import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { Catalog } from '../src/core/catalog.js';
import { builtinTemplatesDir } from '../src/core/paths.js';
import { hasTools, tempDir } from './helpers.js';
import { renderSample } from '../src/core/preview.js';

async function builtins() {
  const catalog = new Catalog({ builtinDir: builtinTemplatesDir, userDir: join(await tempDir(), 't') });
  return (await catalog.list()).filter((e) => e.builtin);
}

describe('template built-in', () => {
  it('are four, valid, with the expected ids and slugs', async () => {
    const list = await builtins();
    expect(list.map((e) => [e.template.slug, e.template.id]).sort()).toEqual([
      ['letter', 'mdplet01'],
      ['report', 'mdprep01'],
      ['standard', 'mdpstd01'],
      ['technical', 'mdptec01'],
    ]);
  });

  it('are all English', async () => {
    for (const e of await builtins()) expect(e.template.language).toBe('en');
  });

  it('report has the logo and the cover', async () => {
    const report = (await builtins()).find((e) => e.template.slug === 'report');
    expect(report?.logoPath).toMatch(/report\/logo\.png$/);
    expect(report?.template.cover.enabled).toBe(true);
  });

  it.runIf(hasTools)('each one renders a thumbnail', async () => {
    for (const e of await builtins()) {
      const png = await renderSample(e.template, e.logoPath, 'png');
      expect(png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    }
  });
});
