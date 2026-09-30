import { expect, it } from 'vitest';
import { CommandError, run } from '../src/core/exec.js';

it('cattura stdout', async () => {
  const r = await run('node', ['-e', 'process.stdout.write("ok")']);
  expect(r.stdout.toString()).toBe('ok');
});

it('passa env e stdin', async () => {
  const script = 'process.stdin.on("data", (d) => process.stdout.write(process.env.X + d))';
  const r = await run('node', ['-e', script], { env: { X: 'a' }, input: 'b' });
  expect(r.stdout.toString()).toBe('ab');
});

it('lancia CommandError con codice e stderr', async () => {
  const p = run('node', ['-e', 'console.error("male"); process.exit(3)']);
  await expect(p).rejects.toBeInstanceOf(CommandError);
  await expect(p).rejects.toMatchObject({ exitCode: 3, stderr: expect.stringContaining('male') });
});

it('rifiuta con ENOENT se il comando non esiste', async () => {
  await expect(run('comando-inesistente-mdpress', [])).rejects.toMatchObject({ code: 'ENOENT' });
});
