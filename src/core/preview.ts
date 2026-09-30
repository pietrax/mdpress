import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assetsDir } from './paths.js';
import { render } from './render.js';
import type { Template } from './theme.js';

export const SAMPLE_MD = join(assetsDir, 'sample.md');

/** PDF or PNG thumbnail of the sample document laid out with the template. */
export async function renderSample(template: Template, logoPath: string | null, kind: 'pdf' | 'png'): Promise<Buffer> {
  const markdown = await readFile(SAMPLE_MD, 'utf8');
  const result = await render({
    markdown,
    baseDir: assetsDir,
    fallbackTitle: 'Sample document',
    template,
    logoPath,
    kind,
  });
  return result.data;
}
