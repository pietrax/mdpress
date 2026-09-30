import { MdpressError } from './errors.js';
import { run } from './exec.js';

export type DepName = 'pandoc' | 'typst';

export const MIN_VERSIONS: Record<DepName, string> = { pandoc: '3.1.2', typst: '0.12' };

export interface DepStatus {
  name: DepName;
  found: boolean;
  version: string | null;
  min: string;
  ok: boolean;
}

export function parseVersion(output: string): string | null {
  return /(\d+\.\d+(?:\.\d+)?)/.exec(output)?.[1] ?? null;
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

export function formatDep(s: DepStatus): string {
  return s.found ? `${s.name} ${s.version ?? '?'} (≥ ${s.min})` : `${s.name} ✗`;
}

async function probe(name: DepName): Promise<DepStatus> {
  const min = MIN_VERSIONS[name];
  try {
    const { stdout } = await run(name, ['--version']);
    const version = parseVersion(stdout.toString('utf8'));
    return { name, found: true, version, min, ok: version !== null && compareVersions(version, min) >= 0 };
  } catch {
    return { name, found: false, version: null, min, ok: false };
  }
}

let cached: Promise<DepStatus[]> | null = null;

export function checkDeps(fresh = false): Promise<DepStatus[]> {
  if (!cached || fresh) cached = Promise.all([probe('pandoc'), probe('typst')]);
  return cached;
}

export async function assertDeps(): Promise<void> {
  const bad = (await checkDeps()).filter((s) => !s.ok);
  if (bad.length > 0) {
    throw new MdpressError('errors.dependenciesMissing', 'DEPENDENCY_MISSING', { list: bad.map(formatDep).join(', ') });
  }
}
