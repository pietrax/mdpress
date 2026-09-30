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
  it('sono quattro, validi, con id e slug attesi', async () => {
    const list = await builtins();
    expect(list.map((e) => [e.template.slug, e.template.id]).sort()).toEqual([
      ['lettera', 'mdplet01'],
      ['report', 'mdprep01'],
      ['standard', 'mdpstd01'],
      ['tecnico', 'mdptec01'],
    ]);
  });

  it('report ha il logo e la copertina', async () => {
    const report = (await builtins()).find((e) => e.template.slug === 'report');
    expect(report?.logoPath).toMatch(/report\/logo\.png$/);
    expect(report?.template.cover.enabled).toBe(true);
  });

  it.runIf(hasTools)('ognuno produce la miniatura', async () => {
    for (const e of await builtins()) {
      const png = await renderSample(e.template, e.logoPath, 'png');
      expect(png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    }
  });
});
