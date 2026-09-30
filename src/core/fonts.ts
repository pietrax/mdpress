import { run } from './exec.js';

export async function listFonts(): Promise<string[]> {
  const { stdout } = await run('typst', ['fonts']);
  const names = stdout.toString('utf8').split('\n').map((s) => s.trim()).filter(Boolean);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}
