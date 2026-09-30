import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULTS, ID_RE, lighten, newId, parsePlaceholders, parseTemplate } from '../src/core/theme.js';
import { MdpressError } from '../src/core/errors.js';
import { builtinTemplatesDir } from '../src/core/paths.js';

const base = { id: 'abcd1234', slug: 'prova', name: 'Prova' };

function issuesOf(input: unknown): string[] {
  try {
    parseTemplate(input);
  } catch (err) {
    if (err instanceof MdpressError) return err.issues.map((i) => i.path);
    throw err;
  }
  return [];
}

describe('parseTemplate', () => {
  it('completa un template minimo con i default', () => {
    const t = parseTemplate(base);
    expect(t.schemaVersion).toBe(1);
    expect(t.page.size).toBe('A4');
    expect(t.fonts.size).toBe(11);
    expect(t.logo.file).toBeNull();
  });
  it('unisce i campi annidati parziali', () => {
    const t = parseTemplate({ ...base, colors: { accent: '#ff0000' } });
    expect(t.colors.accent).toBe('#ff0000');
    expect(t.colors.text).toBe(DEFAULTS.colors.text);
  });
  it('segnala colori non validi col percorso del campo', () => {
    expect(issuesOf({ ...base, colors: { accent: 'rosso' } })).toEqual(['colors.accent']);
  });
  it('rifiuta slug non validi', () => {
    expect(issuesOf({ ...base, slug: 'Ciao Mondo' })).toEqual(['slug']);
  });
  it('rifiuta versioni di schema sconosciute', () => {
    expect(issuesOf({ ...base, schemaVersion: 2 })).toEqual(['schemaVersion']);
  });
  it('accetta come logo solo logo.png o logo.jpg', () => {
    expect(issuesOf({ ...base, logo: { file: '../x.png' } })).toEqual(['logo.file']);
    expect(parseTemplate({ ...base, logo: { file: 'logo.jpg' } }).logo.file).toBe('logo.jpg');
  });
  it('rifiuta margini fuori intervallo', () => {
    expect(issuesOf({ ...base, page: { margins: { top: 200 } } })).toEqual(['page.margins.top']);
  });
  it('rifiuta input che non è un oggetto', () => {
    expect(issuesOf('ciao')).toEqual(['']);
  });
});

describe('parsePlaceholders', () => {
  it('separa testo e segnaposto noti', () => {
    expect(parsePlaceholders('{title} - p. {page}/{pages} {foo}')).toEqual([
      { kind: 'field', name: 'title' },
      { kind: 'text', value: ' - p. ' },
      { kind: 'field', name: 'page' },
      { kind: 'text', value: '/' },
      { kind: 'field', name: 'pages' },
      { kind: 'text', value: ' {foo}' },
    ]);
  });
  it('stringa vuota → nessun segmento', () => {
    expect(parsePlaceholders('')).toEqual([]);
  });
});

describe('utilità', () => {
  it('lighten mescola col bianco', () => {
    expect(lighten('#000000', 0.5)).toBe('#808080');
    expect(lighten('#0b3d91', 0)).toBe('#0b3d91');
    expect(lighten('#0b3d91', 1)).toBe('#ffffff');
  });
  it('newId produce id validi', () => {
    expect(newId()).toMatch(ID_RE);
  });
});

describe('built-in standard', () => {
  it('è valido e coincide con i default', async () => {
    const raw = JSON.parse(await readFile(join(builtinTemplatesDir, 'standard', 'template.json'), 'utf8'));
    const { id, slug, name, description, ...rest } = parseTemplate(raw);
    expect({ id, slug, name }).toEqual({ id: 'mdpstd01', slug: 'standard', name: 'Standard' });
    expect({ ...rest, description: DEFAULTS.description }).toEqual(DEFAULTS);
    expect(description.length).toBeGreaterThan(0);
  });
});

describe('messaggi di validazione in italiano', () => {
  function messagesOf(input: unknown): string[] {
    try {
      parseTemplate(input);
    } catch (err) {
      if (err instanceof MdpressError) return err.issues.map((i) => i.message);
    }
    return [];
  }
  const base = { id: 'abcd1234', slug: 'p', name: 'P' };

  it('intervalli e tipo dei numeri', () => {
    expect(messagesOf({ ...base, fonts: { size: 20 } })[0]).toContain('al massimo 16');
    expect(messagesOf({ ...base, fonts: { size: 2 } })[0]).toContain('almeno 8');
    expect(messagesOf({ ...base, page: { margins: { top: null } } })).toEqual(['inserisci un numero']);
  });
});
