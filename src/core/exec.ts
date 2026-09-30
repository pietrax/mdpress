import { spawn } from 'node:child_process';

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string>;
  input?: string;
}

export interface RunResult {
  stdout: Buffer;
  stderr: string;
}

export class CommandError extends Error {
  constructor(
    readonly command: string,
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    super(`${command} è terminato con codice ${exitCode}: ${stderr.trim()}`);
    this.name = 'CommandError';
  }
}

export function run(command: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env } });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => err.push(d));
    child.on('error', reject);
    child.on('close', (code) => {
      const stderr = Buffer.concat(err).toString('utf8');
      if (code === 0) resolve({ stdout: Buffer.concat(out), stderr });
      else reject(new CommandError(command, code, stderr));
    });
    child.stdin.on('error', () => {
      /* il processo può chiudere stdin prima di leggerlo: non è un errore */
    });
    child.stdin.end(opts.input ?? '');
  });
}
