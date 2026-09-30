import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers.js';

const script = join(__dirname, '..', 'scripts', 'check-no-italian.mjs');

describe('check-no-italian', () => {
  it('passes on the repository', () => {
    const r = spawnSync('node', [script], { encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  it('fails on a file with an Italian word', async () => {
    const dir = await tempDir();
    const file = join(dir, 'sample.ts');
    // Built from pieces so this test file itself stays clean.
    await writeFile(file, `const label = '${'pagin' + 'a'}';\n`);
    const r = spawnSync('node', [script, file], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('sample.ts:1:');
  });

  it('fails when an explicit path does not exist', async () => {
    const missing = join(await tempDir(), 'missing.ts');
    const r = spawnSync('node', [script, missing], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`Path not found: ${missing}`);
  });
});
