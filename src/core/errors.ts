export type ErrorCode =
  | 'TEMPLATE_INVALID'
  | 'TEMPLATE_NOT_FOUND'
  | 'TEMPLATE_READONLY'
  | 'SLUG_TAKEN'
  | 'DEPENDENCY_MISSING'
  | 'RENDER_FAILED'
  | 'BAD_INPUT';

export interface Issue {
  path: string;
  message: string;
}

export class MdpressError extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode,
    readonly issues: Issue[] = [],
  ) {
    super(message);
    this.name = 'MdpressError';
  }
}

export function exitCodeFor(err: unknown): number {
  return err instanceof MdpressError && err.code === 'DEPENDENCY_MISSING' ? 2 : 1;
}
