import { wiktionarySubdomain } from './languages';

export type LookupErrorKind = 'offline' | 'not_found' | 'service_error';

export class LookupError extends Error {
  constructor(public readonly kind: LookupErrorKind, message?: string) {
    super(message ?? kind);
    this.name = 'LookupError';
  }
}

export interface DefinitionSense { pos: string | null; glosses: string[] }

export interface LookupDeps {
  fetch?: typeof fetch;
  translateConfig?: () => Promise<{ url: string; apiKey: string | null }>;
}

export interface LookupService {
  define(word: string, lang: string | null): Promise<DefinitionSense[]>;
  translate(text: string, source: string, target: string): Promise<string>;
}

const GLOSS_MAX = 300;

// Supported entity set: decode exactly one layer per pass (String.replace never
// re-scans its own output, so "&amp;lt;" becomes "&lt;", not "<").
const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': '\'',
  '&apos;': '\'',
};

const decodeEntities = (s: string): string => s.replace(/&(?:nbsp|amp|lt|gt|quot|apos|#39);/g, (m) => ENTITIES[m] ?? m);

// Only well-formed tag-like sequences: "<" followed by a letter, "!", "/" or "?"
// (prose such as "a < b" or "3 < 5 > 2" is left untouched).
const stripTags = (s: string): string => s.replace(/<[A-Za-z!/?][^>]*>/g, '');

const sanitizeHtml = (html: string): string => {
  // Decode first, then strip; repeat until stable so that multi-encoded
  // payloads like "&amp;lt;i&amp;gt;..." cannot re-form tags. Terminates
  // because every decode and every strip strictly shrinks the string.
  let out = html;
  for (;;) {
    const next = stripTags(decodeEntities(out));
    if (next === out) break;
    out = next;
  }
  // Backstop: drop any surviving "<" that could start a tag (e.g. a lone
  // "&lt;script" with no closing ">"), while keeping comparison prose intact.
  out = out.replace(/<(?=[A-Za-z!/?])/g, '');
  return out.replace(/\s+/g, ' ').trim();
};

const clampGloss = (s: string): string => (s.length > GLOSS_MAX ? `${s.slice(0, GLOSS_MAX - 1)}…` : s);

// shape: { "<LanguageName>": [{ partOfSpeech, definitions: [{ definition }] }] }
function parseDefinitions(json: Record<string, unknown>): DefinitionSense[] {
  const groups = Object.values(json).find(Array.isArray) as
    | { partOfSpeech?: string; definitions?: { definition?: string }[] }[]
    | undefined;
  if (!groups) return [];
  const senses: DefinitionSense[] = [];
  for (const g of groups) {
    const glosses = (g.definitions ?? [])
      .map((d) => clampGloss(sanitizeHtml(d.definition ?? '')))
      .filter((s) => s.length > 0);
    if (glosses.length > 0) senses.push({ pos: g.partOfSpeech ?? null, glosses });
  }
  return senses;
}

export function createLookupService(deps: LookupDeps = {}): LookupService {
  const doFetch = deps.fetch ?? fetch;
  const translateConfig = deps.translateConfig ?? (async () => ({ url: 'https://libretranslate.com', apiKey: null as string | null }));

  async function define(word: string, lang: string | null): Promise<DefinitionSense[]> {
    const first = wiktionarySubdomain(lang);
    const editions = [first, 'en', 'fr'].filter((v, i, a) => a.indexOf(v) === i);
    for (const sub of editions) {
      let res: Response;
      try {
        res = await doFetch(`https://${sub}.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`);
      } catch {
        throw new LookupError('offline');
      }
      if (res.status === 404) continue;
      // 501 = this edition does not implement the definition endpoint at all
      // (fr.wiktionary answers it for every word) — try the next edition
      if (res.status === 501) continue;
      if (!res.ok) throw new LookupError('service_error', `wiktionary ${sub}: HTTP ${res.status}`);
      const json = (await res.json()) as Record<string, unknown>;
      const senses = parseDefinitions(json);
      if (senses.length > 0) return senses;
    }
    throw new LookupError('not_found', word);
  }

  async function translate(text: string, source: string, target: string): Promise<string> {
    const { url, apiKey } = await translateConfig();
    let res: Response;
    try {
      res = await doFetch(`${url.replace(/\/+$/, '')}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: text, source, target, format: 'text', ...(apiKey ? { api_key: apiKey } : {}) }),
      });
    } catch {
      throw new LookupError('offline');
    }
    if (res.status === 404) throw new LookupError('not_found');
    if (!res.ok) throw new LookupError('service_error', `libretranslate: HTTP ${res.status}`);
    const json = (await res.json()) as { translatedText?: unknown };
    if (typeof json.translatedText !== 'string') throw new LookupError('service_error', 'missing translatedText');
    return json.translatedText;
  }

  return { define, translate };
}
