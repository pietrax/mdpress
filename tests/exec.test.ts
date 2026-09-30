import { expect, it } from 'vitest';
import { CommandError, run } from '../src/core/exec.js';

it('captures stdout', async () => {
  const r = await run('node', ['-e', 'process.stdout.write("ok")']);
  expect(r.stdout.toString()).toBe('ok');
});

it('passes env and stdin', async () => {
  const script = 'process.stdin.on("data", (d) => process.stdout.write(process.env.X + d))';
  const r = await run('node', ['-e', script], { env: { X: 'a' }, input: 'b' });
  expect(r.stdout.toString()).toBe('ab');
});

it('throws CommandError with code and stderr', async () => {
  const p = run('node', ['-e', 'console.error("boom"); process.exit(3)']);
  await expect(p).rejects.toBeInstanceOf(CommandError);
  await expect(p).rejects.toMatchObject({ exitCode: 3, stderr: expect.stringContaining('boom') });
});

it('rejects with ENOENT when the command does not exist', async () => {
  await expect(run('missing-command-mdpress', [])).rejects.toMatchObject({ code: 'ENOENT' });
});
