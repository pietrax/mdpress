import { expect, it } from 'vitest';
import { parseFormats, resolveOptions } from '../src/core/options.js';
import { parseTemplate } from '../src/core/theme.js';

const withCover = parseTemplate({ id: 'abcd1234', slug: 'p', name: 'P', cover: { enabled: true } });

it('precedenza: CLI > front-matter > template > default', () => {
  expect(resolveOptions(withCover, {}, {})).toEqual({ toc: false, cover: true });
  expect(resolveOptions(withCover, { cover: false, toc: true }, {})).toEqual({ toc: true, cover: false });
  expect(resolveOptions(withCover, { cover: false, toc: true }, { cover: true, toc: false })).toEqual({
    toc: false,
    cover: true,
  });
});

it('parseFormats accetta pdf e docx, toglie i doppioni e rifiuta il resto', () => {
  expect(parseFormats('pdf,docx')).toEqual(['pdf', 'docx']);
  expect(parseFormats(' docx , docx ')).toEqual(['docx']);
  expect(() => parseFormats('odt')).toThrow(/Formato non supportato: odt/);
  expect(() => parseFormats('')).toThrow(/Indica almeno un formato/);
});
