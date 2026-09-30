import { t, type Language, type Params } from '../i18n/index.js';

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
  key: string;
  params: Params;
}

/** Error with a translation key: `message` is English, `localize()` gives any supported language. */
export class MdpressError extends Error {
  constructor(
    readonly key: string,
    readonly code: ErrorCode,
    readonly params: Params = {},
    readonly issues: Issue[] = [],
  ) {
    super(t(key, params, 'en'));
    this.name = 'MdpressError';
  }

  localize(lang: Language): string {
    return t(this.key, this.params, lang);
  }
}

export function localizeIssue(issue: Issue, lang: Language): string {
  return t(issue.key, issue.params, lang);
}

export function exitCodeFor(err: unknown): number {
  return err instanceof MdpressError && err.code === 'DEPENDENCY_MISSING' ? 2 : 1;
}
