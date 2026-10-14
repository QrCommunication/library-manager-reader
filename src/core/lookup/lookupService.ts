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
  define(word: string, lang: string | null, uiLang?: string): Promise<DefinitionSense[]>;
  translate(text: string, source: string, target: string): Promise<string>;
}

const GLOSS_MAX = 300;

// Wikimedia's User-Agent policy: generic library UAs (okhttp, the RN default on
// Android) are blocked at the edge with 403 — a descriptive UA is required.
const WIKTIONARY_UA = 'LibraryManagerReader/1.0 (https://github.com/QrCommunication/library-manager-reader)';

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

// Fallback parser for editions without the REST definition endpoint (all but
// en answer 501): action=parse HTML works on every edition and every future UI
// language. Sections are <h2> per language, POS in <h3>/<h4>, definitions in
// <ol><li>; nested <ul>/<dl> (quotes, examples, derivations) are dropped
// before li extraction so a gloss never swallows its citations. First language
// section yielding definitions wins — the wiki's own language comes first.
const MAX_SENSES = 8;
const MAX_GLOSSES = 6;

export function parseWiktionaryHtml(html: string): DefinitionSense[] {
  let clean = html;
  for (;;) {
    const next = clean.replace(/<(ul|dl)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
    if (next === clean) break;
    clean = next;
  }
  for (const sec of [...clean.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>([\s\S]*?)(?=<h2\b|$)/g)]) {
    const senses: DefinitionSense[] = [];
    for (const h of [...sec[2]!.matchAll(/<h([34])\b[^>]*>([\s\S]*?)<\/h\1\s*>([\s\S]*?)(?=<h[34]\b|$)/gi)]) {
      const pos = stripTags(h[2]!).replace(/\s+/g, ' ').trim() || null;
      const glosses: string[] = [];
      for (const ol of [...h[3]!.matchAll(/<ol\b[^>]*>([\s\S]*?)<\/ol\s*>/gi)]) {
        for (const li of [...ol[1]!.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi)]) {
          const g = clampGloss(sanitizeHtml(li[1]!));
          if (g.length > 1 && !glosses.includes(g)) glosses.push(g);
          if (glosses.length >= MAX_GLOSSES) break;
        }
        if (glosses.length >= MAX_GLOSSES) break;
      }
      if (glosses.length > 0) senses.push({ pos, glosses });
      if (senses.length >= MAX_SENSES) break;
    }
    if (senses.length > 0) return senses;
  }
  return [];
}

const parseHtmlBody = (json: unknown): DefinitionSense[] => {
  const text = (json as { parse?: { text?: unknown } } | null)?.parse?.text;
  return typeof text === 'string' ? parseWiktionaryHtml(text) : [];
};

export function createLookupService(deps: LookupDeps = {}): LookupService {
  const doFetch = deps.fetch ?? fetch;
  const translateConfig = deps.translateConfig ?? (async () => ({ url: 'https://libretranslate.com', apiKey: null as string | null }));

  // Editions: UI language first (definitions in the reader's language), then
  // the book language, then en. Each edition tries the REST definition endpoint
  // (only en ships it) and falls back to the action=parse HTML, which works on
  // every edition.
  async function define(word: string, lang: string | null, uiLang?: string): Promise<DefinitionSense[]> {
    const editions = [wiktionarySubdomain(uiLang ?? lang), wiktionarySubdomain(lang), 'en']
      .filter((v, i, a) => a.indexOf(v) === i);
    let hardError: string | null = null;
    const trySource = async (url: string, parse: (json: unknown) => DefinitionSense[]): Promise<DefinitionSense[] | null> => {
      let res: Response;
      try {
        res = await doFetch(url, { headers: { 'User-Agent': WIKTIONARY_UA } });
      } catch {
        throw new LookupError('offline');
      }
      // 404 = word missing; 501 = REST endpoint not deployed on this edition
      if (res.status === 404 || res.status === 501) return null;
      if (!res.ok) {
        hardError = `wiktionary: HTTP ${res.status} (${url})`;
        return null;
      }
      const senses = parse(await res.json());
      return senses.length > 0 ? senses : null;
    };
    for (const sub of editions) {
      const w = encodeURIComponent(word);
      const rest = await trySource(`https://${sub}.wiktionary.org/api/rest_v1/page/definition/${w}`, (j) => parseDefinitions(j as Record<string, unknown>));
      if (rest) return rest;
      const html = await trySource(
        `https://${sub}.wiktionary.org/w/api.php?action=parse&format=json&formatversion=2&prop=text&page=${w}&redirects=1`,
        parseHtmlBody,
      );
      if (html) return html;
    }
    if (hardError) throw new LookupError('service_error', hardError);
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
