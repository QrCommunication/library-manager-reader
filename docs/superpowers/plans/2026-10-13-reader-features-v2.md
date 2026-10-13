# Features lecteur V1.x — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** porter le lecteur au niveau des fonctions indispensables d'un lecteur mobile : sélection → dictionnaire/traduction en ligne, surlignages + notes, recherche dans le livre, synthèse vocale, luminosité + thème auto.

**Architecture:** évolutions purement additives du protocole v1 (moteur et app livrés ensemble) ; lookup en ligne via service injectable (Wiktionary + LibreTranslate) ; annotations en SQLite (migration v2, tombstones 30 j) dessinées par l'overlayer de foliate-js ; recherche et TTS pilotées moteur→app avec contrôle de flux côté natif.

**Tech Stack:** Expo SDK 57, TypeScript strict, React Native, foliate-js (view/search/tts/overlayer), node:sqlite / expo-sqlite, expo-speech (seule nouvelle dépendance native autorisée), i18next fr/en.

**Spec:** `docs/superpowers/specs/2026-10-13-reader-features-v2-design.md`

## Global Constraints

- Expo SDK 57, TypeScript strict (`strict` + `noUncheckedIndexedAccess`), i18next fr/en (parité testée, aucun texte en dur), epoch ms, UUID v7, tombstones purgés à 30 jours, commits conventionnels, PROTOCOL_VERSION inchangé (évolutions purement additives — moteur et app sont livrés ensemble).
- Dépendances natives autorisées : celles de la V1 **plus `expo-speech`** (Expo-official, nécessaire pour la TTS robuste — `speechSynthesis` n'est pas fiable dans l'Android WebView). Aucune autre nouveauté ; pas de dépendance JS nouvelle non plus.
- Les livres ne sont jamais modifiés ; la V1 reste hors ligne à l'exception des fonctions de lookup (A) qui dégradent proprement hors connexion.
- Toute modification de `src/engine/*` impose `npm run build:engine` (le bundle inliné `src/engine/engineHtml.ts` doit être commité avec le code ; la CI vérifie la fraîcheur).
- Chaque chaîne i18n nouvelle est ajoutée dans **les deux** `src/i18n/fr.ts` et `src/i18n/en.ts` (le test de parité échoue sinon).
- Le câblage DOM du moteur n'est pas testable unitairement dans ce harnais (précédent V1, Task 12) : il est vérifié par `typecheck` + `build:engine` + recette manuelle ; les couches protocole/bridge/repo/composants portent les tests TDD.

## Interfaces vérifiées dans le dépôt (état au 2026-10-13, branche main)

- `ReaderBridge` (`src/core/reader/bridge.ts`) : `openBook`, `goTo`, `goToFraction`, `next`, `prev`, `applySettings`, `captureBookmark`, `onProgress(cb): () => void`, `onEngineError(cb): () => void` ; `handleRaw(raw)` parse via `parseMessage` (allowlist `ENGINE_TO_APP_TYPES` dans `src/core/bridge/protocol.ts`).
- `useReaderSession` retourne `{ state, errorKind, title, fraction, toc, bridge, retry }` ; `BridgeLike` (même fichier) est la tranche structurelle consommée par ReaderScreen.
- `createServices` (`src/core/services.ts`) : `{ books, progress, bookmarks, settings, fs, paths }` ; `AppServices` fourni via `ServicesProvider`/`useServices`.
- Migration (`src/db/migrate.ts`) : `CURRENT_SCHEMA_VERSION = 1`, `MIGRATIONS: Record<number, string>`, chaque pas transactionnel (`BEGIN`/`user_version`/`COMMIT`).
- `settingsRepo` : lecture JSON avec fusion des défauts (`{ ...fallback, ...parsed }`), repli intégral si corrompu — les nouveaux champs de `UiPrefs`/`ReaderSettings` n'exigent **aucune** migration.
- Stores zustand (`src/features/settings/*.ts`) : `hydrate()` + `update(partial)` persistant via settingsRepo.
- APIs foliate-js vérifiées dans `node_modules/foliate-js/` (vendu) :
  - `view.getCFI(index, range)`, `view.resolveNavigation(target): Promise<{index, anchor}>`
  - `view.addAnnotation(annotation, remove?)` (async, `annotation.value` = cfi) + événement `draw-annotation` `{ draw, annotation, doc, range }` — l'hôte dessine via `draw(Overlayer.highlight, { color })` ; `view.deleteAnnotation(annotation)`
  - les annotations ne sont PAS redessinées automatiquement au changement de section : la démo officielle re-apelle `addAnnotation` sur `relocate` — le moteur fera pareil
  - `async *view.search({ query })` yield `{ progress }`, `{ label, subitems: [{cfi, excerpt}] }` puis `'done'` ; `view.clearSearch()` annule/efface
  - `TTS` (`foliate-js/tts.js`) : `new TTS(doc, textWalker, highlight, granularity)` ; `start()/resume()/next(paused)/prev(paused)` retournent une chaîne SSML (ou `undefined` en fin) ; `next(true)` appelle `highlight(range)` ; `textWalker` exporté par `foliate-js/text-walker.js`
  - l'événement `load` de la vue porte `{ doc, index }` — le paginator n'émet RIEN pour la sélection : le moteur câble lui-même `selectionchange` sur le doc chargé
- `src/engine/foliate-js.d.ts` : déclarations minimales des membres utilisés — à étendre à chaque nouveau membre (tâches 5, 9, 11, 14).

---

### Task 1: Langues européennes (carte lookup)

**Files:**
- Create: `src/core/lookup/languages.ts`
- Test: `src/core/lookup/__tests__/languages.test.ts`

**Interfaces:**
- Consumes: rien (donnée pure).
- Produces: `export interface LookupLanguage { code: string; wiktionary: string; label: { fr: string; en: string } }`, `export const LOOKUP_LANGUAGES: LookupLanguage[]` (~45 langues souveraines européennes), `export function byCode(code: string): LookupLanguage | null`, `export function wiktionarySubdomain(lang: string | null): string` (normalise `fr-FR`→`fr`, repli `'en'`).

- [ ] **Step 1: Write the failing test**

```ts
import { byCode, LOOKUP_LANGUAGES, wiktionarySubdomain } from '../languages';

describe('lookup languages', () => {
  it('has at least 40 unique ISO codes with labels in both languages', () => {
    expect(LOOKUP_LANGUAGES.length).toBeGreaterThanOrEqual(40);
    const codes = new Set(LOOKUP_LANGUAGES.map((l) => l.code));
    expect(codes.size).toBe(LOOKUP_LANGUAGES.length);
    for (const l of LOOKUP_LANGUAGES) {
      expect(l.wiktionary).toMatch(/^[a-z-]+$/);
      expect(l.label.fr.length).toBeGreaterThan(0);
      expect(l.label.en.length).toBeGreaterThan(0);
    }
  });

  it('covers the major European languages', () => {
    for (const c of ['fr','en','de','es','it','pt','nl','ru','el','tr','pl','sv','uk','cs','da','fi','hu','ro','bg','hr','sk','sl','sr','lt','lv','et','ga','is','mt','sq','hy','az','eu','be','bs','ca','gl','mk','lb','ka','cy','gd']) {
      expect(byCode(c)).toBeDefined();
    }
  });

  it('returns null for unknown codes', () => {
    expect(byCode('zz')).toBeNull();
  });

  it('normalizes BCP-47 tags and falls back to en', () => {
    expect(wiktionarySubdomain('fr-FR')).toBe('fr');
    expect(wiktionarySubdomain('fr')).toBe('fr');
    expect(wiktionarySubdomain(null)).toBe('en');
    expect(wiktionarySubdomain('zz')).toBe('en');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/core/lookup/__tests__/languages.test.ts`
Expected: FAIL — `Cannot find module '../languages'`

- [ ] **Step 3: Write the implementation**

```ts
export interface LookupLanguage {
  code: string; // ISO 639-1
  wiktionary: string; // sous-domaine de l'édition Wiktionary
  label: { fr: string; en: string };
}

// Langues souveraines d'Europe (≈45) — la source de traduction est la langue
// du livre, la cible est la langue de l'interface (fr|en).
export const LOOKUP_LANGUAGES: LookupLanguage[] = [
  { code: 'sq', wiktionary: 'sq', label: { fr: 'Albanais', en: 'Albanian' } },
  { code: 'de', wiktionary: 'de', label: { fr: 'Allemand', en: 'German' } },
  { code: 'en', wiktionary: 'en', label: { fr: 'Anglais', en: 'English' } },
  { code: 'hy', wiktionary: 'hy', label: { fr: 'Arménien', en: 'Armenian' } },
  { code: 'az', wiktionary: 'az', label: { fr: 'Azéri', en: 'Azerbaijani' } },
  { code: 'eu', wiktionary: 'eu', label: { fr: 'Basque', en: 'Basque' } },
  { code: 'be', wiktionary: 'be', label: { fr: 'Biélorusse', en: 'Belarusian' } },
  { code: 'bs', wiktionary: 'bs', label: { fr: 'Bosnien', en: 'Bosnian' } },
  { code: 'bg', wiktionary: 'bg', label: { fr: 'Bulgare', en: 'Bulgarian' } },
  { code: 'ca', wiktionary: 'ca', label: { fr: 'Catalan', en: 'Catalan' } },
  { code: 'hr', wiktionary: 'hr', label: { fr: 'Croate', en: 'Croatian' } },
  { code: 'da', wiktionary: 'da', label: { fr: 'Danois', en: 'Danish' } },
  { code: 'es', wiktionary: 'es', label: { fr: 'Espagnol', en: 'Spanish' } },
  { code: 'et', wiktionary: 'et', label: { fr: 'Estonien', en: 'Estonian' } },
  { code: 'fi', wiktionary: 'fi', label: { fr: 'Finnois', en: 'Finnish' } },
  { code: 'fr', wiktionary: 'fr', label: { fr: 'Français', en: 'French' } },
  { code: 'gl', wiktionary: 'gl', label: { fr: 'Galicien', en: 'Galician' } },
  { code: 'cy', wiktionary: 'cy', label: { fr: 'Gallois', en: 'Welsh' } },
  { code: 'gd', wiktionary: 'gd', label: { fr: 'Écossais (gaélique)', en: 'Scottish Gaelic' } },
  { code: 'ka', wiktionary: 'ka', label: { fr: 'Géorgien', en: 'Georgian' } },
  { code: 'el', wiktionary: 'el', label: { fr: 'Grec', en: 'Greek' } },
  { code: 'hu', wiktionary: 'hu', label: { fr: 'Hongrois', en: 'Hungarian' } },
  { code: 'ga', wiktionary: 'ga', label: { fr: 'Irlandais', en: 'Irish' } },
  { code: 'is', wiktionary: 'is', label: { fr: 'Islandais', en: 'Icelandic' } },
  { code: 'it', wiktionary: 'it', label: { fr: 'Italien', en: 'Italian' } },
  { code: 'lv', wiktionary: 'lv', label: { fr: 'Letton', en: 'Latvian' } },
  { code: 'lb', wiktionary: 'lb', label: { fr: 'Luxembourgeois', en: 'Luxembourgish' } },
  { code: 'mk', wiktionary: 'mk', label: { fr: 'Macédonien', en: 'Macedonian' } },
  { code: 'mt', wiktionary: 'mt', label: { fr: 'Maltais', en: 'Maltese' } },
  { code: 'no', wiktionary: 'no', label: { fr: 'Norvégien', en: 'Norwegian' } },
  { code: 'nl', wiktionary: 'nl', label: { fr: 'Néerlandais', en: 'Dutch' } },
  { code: 'pl', wiktionary: 'pl', label: { fr: 'Polonais', en: 'Polish' } },
  { code: 'pt', wiktionary: 'pt', label: { fr: 'Portugais', en: 'Portuguese' } },
  { code: 'ro', wiktionary: 'ro', label: { fr: 'Roumain', en: 'Romanian' } },
  { code: 'ru', wiktionary: 'ru', label: { fr: 'Russe', en: 'Russian' } },
  { code: 'sr', wiktionary: 'sr', label: { fr: 'Serbe', en: 'Serbian' } },
  { code: 'sk', wiktionary: 'sk', label: { fr: 'Slovaque', en: 'Slovak' } },
  { code: 'sl', wiktionary: 'sl', label: { fr: 'Slovène', en: 'Slovenian' } },
  { code: 'sv', wiktionary: 'sv', label: { fr: 'Suédois', en: 'Swedish' } },
  { code: 'cs', wiktionary: 'cs', label: { fr: 'Tchèque', en: 'Czech' } },
  { code: 'tr', wiktionary: 'tr', label: { fr: 'Turc', en: 'Turkish' } },
  { code: 'uk', wiktionary: 'uk', label: { fr: 'Ukrainien', en: 'Ukrainian' } },
];

export function byCode(code: string): LookupLanguage | null {
  return LOOKUP_LANGUAGES.find((l) => l.code === code.toLowerCase()) ?? null;
}

export function wiktionarySubdomain(lang: string | null): string {
  const base = lang?.split('-')[0]?.toLowerCase() ?? '';
  return byCode(base)?.wiktionary ?? 'en';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/core/lookup/__tests__/languages.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/lookup/languages.ts src/core/lookup/__tests__/languages.test.ts
git commit -m "feat(lookup): European languages map (ISO 639-1 ↔ Wiktionary edition ↔ fr/en labels)"
```

---

### Task 2: LookupService (Wiktionary + LibreTranslate, erreurs typées)

**Files:**
- Create: `src/core/lookup/lookupService.ts`
- Test: `src/core/lookup/__tests__/lookupService.test.ts`

**Interfaces:**
- Consumes: `wiktionarySubdomain` (Task 1).
- Produces: `export type LookupErrorKind = 'offline' | 'not_found' | 'service_error'`; `export class LookupError extends Error { constructor(public readonly kind: LookupErrorKind, message?: string) }`; `export interface DefinitionSense { pos: string | null; glosses: string[] }`; `export interface LookupDeps { fetch?: typeof fetch; translateConfig?: () => Promise<{ url: string; apiKey: string | null }> }`; `export interface LookupService { define(word: string, lang: string | null): Promise<DefinitionSense[]>; translate(text: string, source: string, target: string): Promise<string> }`; `export function createLookupService(deps?: LookupDeps): LookupService`.

- [ ] **Step 1: Write the failing test**

```ts
import { createLookupService, LookupError } from '../lookupService';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const fetchOk = (status: number, body: unknown) =>
  jest.fn(async () => jsonResponse(status, body));

describe('lookupService.define', () => {
  it('parses Wiktionary senses, strips HTML and truncates long glosses', async () => {
    const fetched = fetchOk(200, {
      English: [{
        partOfSpeech: 'Noun',
        definitions: [
          { definition: 'A <b>book</b> &amp; its pages' },
          { definition: 'x'.repeat(400) },
        ],
      }],
    });
    const service = createLookupService({ fetch: fetched as unknown as typeof fetch });
    const senses = await service.define('book', 'en');
    expect(senses).toEqual([{ pos: 'Noun', glosses: ['A book & its pages', `${'x'.repeat(299)}…`] }]);
    expect(fetched).toHaveBeenCalledWith(
      'https://en.wiktionary.org/api/rest_v1/page/definition/book',
    );
  });

  it('falls through the edition chain [lang, en, fr] and dedupes', async () => {
    const fetched = jest.fn()
      .mockResolvedValueOnce(jsonResponse(404, { error: 'Not found' }))
      .mockResolvedValueOnce(jsonResponse(200, {
        English: [{ partOfSpeech: 'Verb', definitions: [{ definition: 'to read' }] }],
      }));
    const service = createLookupService({ fetch: fetched as unknown as typeof fetch });
    const senses = await service.define('read', 'de');
    expect(senses).toEqual([{ pos: 'Verb', glosses: ['to read'] }]);
    expect((fetched.mock.calls[0] as string[])[0]).toContain('de.wiktionary.org');
    expect((fetched.mock.calls[1] as string[])[0]).toContain('en.wiktionary.org');
  });

  it('maps network rejection to offline', async () => {
    const service = createLookupService({ fetch: jest.fn(async () => { throw new Error('dns'); }) as unknown as typeof fetch });
    await expect(service.define('word', 'en')).rejects.toMatchObject({ kind: 'offline' });
  });

  it('maps exhausted chain to not_found and other HTTP errors to service_error', async () => {
    const nf = createLookupService({ fetch: fetchOk(404, {}) as unknown as typeof fetch });
    await expect(nf.define('word', 'en')).rejects.toMatchObject({ kind: 'not_found' });
    const se = createLookupService({ fetch: fetchOk(500, {}) as unknown as typeof fetch });
    await expect(se.define('word', 'en')).rejects.toMatchObject({ kind: 'service_error' });
    expect(new LookupError('offline') instanceof Error).toBe(true);
  });
});

describe('lookupService.translate', () => {
  const cfg = async () => ({ url: 'https://lt.example', apiKey: null as string | null });

  it('posts the payload and returns translatedText (no api_key when unset)', async () => {
    const fetched = jest.fn(async () => jsonResponse(200, { translatedText: 'libro' }));
    const service = createLookupService({ fetch: fetched as unknown as typeof fetch, translateConfig: cfg });
    const out = await service.translate('book', 'en', 'es');
    expect(out).toBe('libro');
    const [url, init] = fetched.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://lt.example/translate');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({ q: 'book', source: 'en', target: 'es', format: 'text' });
  });

  it('includes api_key when configured', async () => {
    const fetched = jest.fn(async () => jsonResponse(200, { translatedText: 'x' }));
    const service = createLookupService({
      fetch: fetched as unknown as typeof fetch,
      translateConfig: async () => ({ url: 'https://lt.example/', apiKey: 'secret' }),
    });
    await service.translate('book', 'en', 'es');
    const body = JSON.parse((fetched.mock.calls[0] as [string, RequestInit])[1].body as string) as Record<string, unknown>;
    expect(body.api_key).toBe('secret');
  });

  it('maps network rejection to offline and missing field to service_error', async () => {
    const offline = createLookupService({ fetch: jest.fn(async () => { throw new Error('x'); }) as unknown as typeof fetch, translateConfig: cfg });
    await expect(offline.translate('a', 'en', 'fr')).rejects.toMatchObject({ kind: 'offline' });
    const bad = createLookupService({ fetch: fetchOk(200, {}) as unknown as typeof fetch, translateConfig: cfg });
    await expect(bad.translate('a', 'en', 'fr')).rejects.toMatchObject({ kind: 'service_error' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/core/lookup/__tests__/lookupService.test.ts`
Expected: FAIL — `Cannot find module '../lookupService'`

- [ ] **Step 3: Write the implementation**

```ts
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

const stripHtml = (html: string): string => html
  .replace(/<[^>]*>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, '\'')
  .replace(/\s+/g, ' ')
  .trim();

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
      .map((d) => clampGloss(stripHtml(d.definition ?? '')))
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/core/lookup/__tests__/lookupService.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/lookup/lookupService.ts src/core/lookup/__tests__/lookupService.test.ts
git commit -m "feat(lookup): injectable lookup service (Wiktionary definitions + LibreTranslate) with typed errors"
```

---

### Task 3: Protocole additif (sélection, surlignages, recherche, TTS) + codec

**Files:**
- Modify: `src/core/types.ts` (HighlightColor, SelectionRect, Annotation)
- Modify: `src/core/bridge/protocol.ts` (nouveaux messages)
- Test: `src/core/bridge/__tests__/codec.test.ts` (tests ajoutés)

**Interfaces:**
- Consumes: rien.
- Produces (types.ts): `export type HighlightColor = 'yellow' | 'green' | 'blue' | 'red'`; `export interface SelectionRect { x: number; y: number; width: number; height: number }`; `export interface Annotation { id: string; bookId: string; cfi: string; color: HighlightColor; note: string | null; excerpt: string; createdAt: number; updatedAt: number; deletedAt: number | null }`; `export type NewAnnotation = Omit<Annotation, 'id' | 'updatedAt' | 'deletedAt'> & { id?: string }`.
- Produces (protocol.ts): app→moteur `addHighlight {id,cfi,color}` / `removeHighlight {id}` / `copySelection` / `search {query}` / `searchCancel` / `ttsStart {cfi: string|null}` / `ttsStop` / `ttsNext` ; moteur→app `selectionChanged {text: string|null, rect: SelectionRect|null, cfi: string|null, lang: string|null}` / `searchResult {cfi, excerpt, fraction}` / `searchDone {count}` / `ttsSentence {text, cfi: string|null}`.

- [ ] **Step 1: Write the failing tests** — append to `src/core/bridge/__tests__/codec.test.ts`:

```ts
describe('additive v1.x messages', () => {
  it('round-trips selectionChanged', () => {
    const msg = { type: 'selectionChanged', text: 'mot', rect: { x: 1, y: 2, width: 3, height: 4 }, cfi: 'epubcfi(/6/4)', lang: 'fr' };
    expect(parseMessage(encodeMessage(msg))).toEqual(msg);
  });

  it('round-trips selectionChanged with nulls', () => {
    const msg = { type: 'selectionChanged', text: null, rect: null, cfi: null, lang: null };
    expect(parseMessage(encodeMessage(msg))).toEqual(msg);
  });

  it('round-trips highlight, search and tts messages', () => {
    const msgs: unknown[] = [
      { type: 'addHighlight', id: 'a1', cfi: 'epubcfi(/6/4)', color: 'yellow' },
      { type: 'removeHighlight', id: 'a1' },
      { type: 'copySelection' },
      { type: 'search', query: 'mot' },
      { type: 'searchCancel' },
      { type: 'searchResult', cfi: 'epubcfi(/6/4)', excerpt: '…mot…', fraction: 0.42 },
      { type: 'searchDone', count: 3 },
      { type: 'ttsStart', cfi: null },
      { type: 'ttsStop' },
      { type: 'ttsNext' },
      { type: 'ttsSentence', text: 'Phrase.', cfi: null },
    ];
    for (const m of msgs) expect(parseMessage(encodeMessage(m))).toEqual(m);
  });

  it('still rejects unknown engine types', () => {
    expect(parseMessage(JSON.stringify({ type: 'notAThing' })).type).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/core/bridge/__tests__/codec.test.ts`
Expected: FAIL — les nouveaux types reviennent `unknown`

- [ ] **Step 3: Write the implementation**

Dans `src/core/types.ts`, après `ThemeName` :

```ts
export type HighlightColor = 'yellow' | 'green' | 'blue' | 'red';

export interface SelectionRect { x: number; y: number; width: number; height: number }
```

et après `NewBookmark` :

```ts
export interface Annotation {
  id: string;
  bookId: string;
  cfi: string;
  color: HighlightColor;
  note: string | null;
  excerpt: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export type NewAnnotation = Omit<Annotation, 'id' | 'updatedAt' | 'deletedAt'> & { id?: string };
```

Dans `src/core/bridge/protocol.ts` :

```ts
import type {
  BookFormat, BookMetadata, HighlightColor, OriginalFormat,
  ReaderSettings, SelectionRect, TocItem,
} from '../types';
```

ajouter à `AppToEngine` :

```ts
  | { type: 'addHighlight'; id: string; cfi: string; color: HighlightColor }
  | { type: 'removeHighlight'; id: string }
  | { type: 'copySelection' }
  | { type: 'search'; query: string }
  | { type: 'searchCancel' }
  | { type: 'ttsStart'; cfi: string | null }
  | { type: 'ttsStop' }
  | { type: 'ttsNext' }
```

ajouter à `EngineToApp` :

```ts
  | { type: 'selectionChanged'; text: string | null; rect: SelectionRect | null; cfi: string | null; lang: string | null }
  | { type: 'searchResult'; cfi: string; excerpt: string; fraction: number }
  | { type: 'searchDone'; count: number }
  | { type: 'ttsSentence'; text: string; cfi: string | null }
```

étendre `ENGINE_TO_APP_TYPES` :

```ts
export const ENGINE_TO_APP_TYPES: readonly EngineToApp['type'][] = [
  'engineReady', 'dataAck', 'bookLoaded', 'progress', 'bookmarkCaptured', 'extractResult', 'engineError',
  'selectionChanged', 'searchResult', 'searchDone', 'ttsSentence',
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/core/bridge/__tests__/codec.test.ts && npm run typecheck`
Expected: PASS + 0 erreur typecheck

- [ ] **Step 5: Commit**

```bash
git add src/core/types.ts src/core/bridge/protocol.ts src/core/bridge/__tests__/codec.test.ts
git commit -m "feat(protocol): additive messages for selection, highlights, search and tts"
```

---

### Task 4: ReaderBridge — abonnements + commandes

**Files:**
- Modify: `src/core/reader/bridge.ts`
- Modify: `src/features/reader/useReaderSession.ts` (interface `BridgeLike` uniquement)
- Test: `src/core/reader/__tests__/bridge.test.ts` (tests ajoutés)

**Interfaces:**
- Consumes: Task 3 (types de messages).
- Produces: `ReaderBridge` et `BridgeLike` gagnent — commandes `addHighlight(id: string, cfi: string, color: HighlightColor): void`, `removeHighlight(id: string): void`, `copySelection(): void`, `search(query: string): void`, `searchCancel(): void`, `ttsStart(cfi: string | null): void`, `ttsStop(): void`, `ttsNext(): void` ; abonnements `onSelectionChanged(cb: (s: { text: string | null; rect: SelectionRect | null; cfi: string | null; lang: string | null }) => void): () => void`, `onSearchResult(cb: (r: { cfi: string; excerpt: string; fraction: number }) => void): () => void`, `onSearchDone(cb: (count: number) => void): () => void`, `onTtsSentence(cb: (s: { text: string; cfi: string | null }) => void): () => void` (même pattern Set + retour unsubscribe que `onProgress`).

- [ ] **Step 1: Write the failing tests** — append to `src/core/reader/__tests__/bridge.test.ts` (réutiliser le harnais existant : `new ReaderBridge(sent, transport)` avec `sent` capturant les émissions ; `handleRaw(JSON.stringify(msg))` simule le moteur) :

```ts
describe('v1.x subscriptions and commands', () => {
  const makeBridge = () => {
    const sent: string[] = [];
    const bridge = new ReaderBridge((raw: string) => sent.push(raw), {
      open: async () => {}, read: async () => {}, } as never);
    return { bridge, sent };
  };

  it('notifies selection subscribers until unsubscribed', () => {
    const { bridge } = makeBridge();
    const seen: unknown[] = [];
    const off = bridge.onSelectionChanged((s) => seen.push(s));
    bridge.handleRaw(JSON.stringify({ type: 'selectionChanged', text: 'mot', rect: { x: 1, y: 2, width: 3, height: 4 }, cfi: 'cfi-1', lang: 'fr' }));
    off();
    bridge.handleRaw(JSON.stringify({ type: 'selectionChanged', text: null, rect: null, cfi: null, lang: null }));
    expect(seen).toEqual([{ text: 'mot', rect: { x: 1, y: 2, width: 3, height: 4 }, cfi: 'cfi-1', lang: 'fr' }]);
  });

  it('notifies search and tts subscribers', () => {
    const { bridge } = makeBridge();
    const results: unknown[] = [];
    const done: number[] = [];
    const sentences: unknown[] = [];
    bridge.onSearchResult((r) => results.push(r));
    bridge.onSearchDone((c) => done.push(c));
    bridge.onTtsSentence((s) => sentences.push(s));
    bridge.handleRaw(JSON.stringify({ type: 'searchResult', cfi: 'c1', excerpt: 'x', fraction: 0.1 }));
    bridge.handleRaw(JSON.stringify({ type: 'searchDone', count: 1 }));
    bridge.handleRaw(JSON.stringify({ type: 'ttsSentence', text: 'Phrase.', cfi: 'c2' }));
    expect(results).toEqual([{ cfi: 'c1', excerpt: 'x', fraction: 0.1 }]);
    expect(done).toEqual([1]);
    expect(sentences).toEqual([{ text: 'Phrase.', cfi: 'c2' }]);
  });

  it('emits highlight, search and tts commands', () => {
    const { bridge, sent } = makeBridge();
    bridge.addHighlight('a1', 'cfi-9', 'green');
    bridge.removeHighlight('a1');
    bridge.copySelection();
    bridge.search('mot');
    bridge.searchCancel();
    bridge.ttsStart(null);
    bridge.ttsStop();
    bridge.ttsNext();
    expect(sent.map((s) => JSON.parse(s) as { type: string }).map((m) => m.type)).toEqual([
      'addHighlight', 'removeHighlight', 'copySelection', 'search', 'searchCancel', 'ttsStart', 'ttsStop', 'ttsNext',
    ]);
  });
});
```

Adapter le littéral transport au type exact attendu par le constructeur dans le harnais existant du fichier (voir les tests présents).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/core/reader/__tests__/bridge.test.ts`
Expected: FAIL — `bridge.onSelectionChanged is not a function`

- [ ] **Step 3: Write the implementation**

Dans `ReaderBridge` (même pattern que `progressCbs`) :

```ts
import type { HighlightColor, SelectionRect } from '../bridge/protocol'; // via types.ts si préféré

export interface SelectionPayload { text: string | null; rect: SelectionRect | null; cfi: string | null; lang: string | null }
export interface SearchResultPayload { cfi: string; excerpt: string; fraction: number }
export interface TtsSentencePayload { text: string; cfi: string | null }
```

membres privés :

```ts
private selectionCbs = new Set<(s: SelectionPayload) => void>();
private searchResultCbs = new Set<(r: SearchResultPayload) => void>();
private searchDoneCbs = new Set<(count: number) => void>();
private ttsSentenceCbs = new Set<(s: TtsSentencePayload) => void>();
```

cases dans `handle(msg)` :

```ts
case 'selectionChanged':
  for (const cb of this.selectionCbs) cb({ text: msg.text, rect: msg.rect, cfi: msg.cfi, lang: msg.lang });
  break;
case 'searchResult':
  for (const cb of this.searchResultCbs) cb({ cfi: msg.cfi, excerpt: msg.excerpt, fraction: msg.fraction });
  break;
case 'searchDone':
  for (const cb of this.searchDoneCbs) cb(msg.count);
  break;
case 'ttsSentence':
  for (const cb of this.ttsSentenceCbs) cb({ text: msg.text, cfi: msg.cfi });
  break;
```

commandes + abonnements (après `onEngineError`) :

```ts
addHighlight(id: string, cfi: string, color: HighlightColor): void { this.emit({ type: 'addHighlight', id, cfi, color }); }
removeHighlight(id: string): void { this.emit({ type: 'removeHighlight', id }); }
copySelection(): void { this.emit({ type: 'copySelection' }); }
search(query: string): void { this.emit({ type: 'search', query }); }
searchCancel(): void { this.emit({ type: 'searchCancel' }); }
ttsStart(cfi: string | null): void { this.emit({ type: 'ttsStart', cfi }); }
ttsStop(): void { this.emit({ type: 'ttsStop' }); }
ttsNext(): void { this.emit({ type: 'ttsNext' }); }

onSelectionChanged(cb: (s: SelectionPayload) => void): () => void { this.selectionCbs.add(cb); return () => this.selectionCbs.delete(cb); }
onSearchResult(cb: (r: SearchResultPayload) => void): () => void { this.searchResultCbs.add(cb); return () => this.searchResultCbs.delete(cb); }
onSearchDone(cb: (count: number) => void): () => void { this.searchDoneCbs.add(cb); return () => this.searchDoneCbs.delete(cb); }
onTtsSentence(cb: (s: TtsSentencePayload) => void): () => void { this.ttsSentenceCbs.add(cb); return () => this.ttsSentenceCbs.delete(cb); }
```

Étendre `BridgeLike` dans `useReaderSession.ts` avec ces 11 membres (commandes + abonnements) — le `bridge` rendu reste compatible.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/core/reader/__tests__/bridge.test.ts && npm run typecheck`
Expected: PASS + 0 erreur

- [ ] **Step 5: Commit**

```bash
git add src/core/reader/bridge.ts src/core/reader/__tests__/bridge.test.ts src/features/reader/useReaderSession.ts
git commit -m "feat(bridge): selection/search/tts subscriptions and highlight/search/tts commands"
```

---

### Task 5: Moteur — selectionChanged + copySelection

**Files:**
- Modify: `src/engine/engine.ts`
- Test: aucun nouveau (câblage DOM — cf. contrainte globale) ; portes = typecheck + build

**Interfaces:**
- Consumes: Task 3 (messages), Task 4 (consommateurs RN).
- Produces: le moteur émet `selectionChanged` (debounce ~200 ms, `null` si sélection vide/collapsée), `lang` = `view.book.metadata.language`, `cfi` via `view.getCFI(index, range)` (null si échec) ; `rect` = `range.getBoundingClientRect()` (viewport de l'iframe) ; traite `copySelection` en exécutant `execCommand('copy')` sur le document portant la sélection non collapsée.

- [ ] **Step 1: Verify the load event shape** (déjà documenté dans Interfaces vérifiées ; re-confirmer avant de coder)

Run: `grep -n "addEventListener('load'" node_modules/foliate-js/view.js && grep -n "detail: { doc" node_modules/foliate-js/view.js | head -3`
Expected: le `load` de la vue porte bien `{ doc, index }` (sinon adapter la déstructuration du Step 3, rien d'autre ne change).

- [ ] **Step 2: Implement**

Dans `src/engine/engine.ts`, ajouter près des autres listeners (le handler `load` existant reçoit désormais le détail) :

```ts
let bookLanguage: string | null = null;
let selectionTimer: ReturnType<typeof setTimeout> | null = null;

const sendSelection = (doc: Document, index: number): void => {
  const sel = doc.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed || sel.toString().trim() === '') {
    send({ type: 'selectionChanged', text: null, rect: null, cfi: null, lang: null });
    return;
  }
  const range = sel.getRangeAt(0);
  let cfi: string | null = null;
  try { cfi = view.getCFI(index, range); } catch { cfi = null; }
  const r = range.getBoundingClientRect();
  send({
    type: 'selectionChanged',
    text: sel.toString(),
    rect: { x: r.x, y: r.y, width: r.width, height: r.height },
    cfi,
    lang: bookLanguage,
  });
};

const queueSelection = (doc: Document, index: number): void => {
  if (selectionTimer) clearTimeout(selectionTimer);
  // trailing debounce: la sélection se stabilise pendant le drag duPoignée
  selectionTimer = setTimeout(() => { selectionTimer = null; sendSelection(doc, index); }, 200);
};
```

Modifier le listener `load` existant (signature `() => {...}` → `(e: Event) => {...}`) pour capter le doc et la langue :

```ts
view.addEventListener('load', (e: Event) => {
  documentLoaded = true;
  const detail = (e as CustomEvent).detail as { doc?: Document; index?: number } | undefined;
  bookLanguage = view.book?.metadata?.language ?? null;
  if (detail?.doc) {
    const doc = detail.doc;
    const index = detail.index ?? 0;
    doc.addEventListener('selectionchange', () => queueSelection(doc, index));
  }
  // ... envoi bookLoaded existant inchangé ...
});
```

Dans le switch `receive`, ajouter :

```ts
case 'copySelection': {
  // le presse-papiers système est alimenté par le doc du WebView portant la
  // sélection (pas de expo-clipboard : hors liste des dépendances autorisées)
  for (const { doc } of view.renderer.getContents()) {
    const sel = doc?.getSelection?.();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      try { doc?.execCommand('copy'); } catch { /* best effort */ }
      break;
    }
  }
  break;
}
```

Ajouter `'copySelection'` au `QUIET_UNTIL_LOADED` (un doc est requis).

- [ ] **Step 3: Typecheck + rebuild du bundle moteur**

Run: `npm run typecheck && npm run build:engine && git diff --stat src/engine/engineHtml.ts`
Expected: 0 erreur ; engineHtml.ts régénéré (diff présent)

- [ ] **Step 4: Commit**

```bash
git add src/engine/engine.ts src/engine/engineHtml.ts
git commit -m "feat(engine): emit selectionChanged (debounced) and handle copySelection"
```

---

### Task 6: uiPrefs LibreTranslate + intégration services

**Files:**
- Modify: `src/core/types.ts` (UiPrefs + défauts)
- Modify: `src/core/services.ts` (membre `lookup`)
- Modify: `src/features/settings/SettingsScreen.tsx` (2 lignes de réglages)
- Test: `src/db/__tests__/settingsRepo.db.test.ts` (cas ajouté)

**Interfaces:**
- Consumes: Task 2 (`createLookupService`), Task 1.
- Produces: `UiPrefs { language, defaultTheme, libreTranslateUrl, libreTranslateApiKey }` avec `DEFAULT_UI_PREFS.libreTranslateUrl = 'https://libretranslate.com'`, `libreTranslateApiKey = ''` ; `AppServices.lookup: LookupService` (translateConfig lit les prefs à chaque appel).

- [ ] **Step 1: Write the failing test** — append to `src/db/__tests__/settingsRepo.db.test.ts` (harnais existant) :

```ts
it('merges new libreTranslate defaults into a stored pre-v1.x prefs row', async () => {
  const repo = createSettingsRepo(db);
  await db.run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)', ['uiPrefs', JSON.stringify({ language: 'fr' }), 1]);
  const prefs = await repo.getUiPrefs();
  expect(prefs.language).toBe('fr');
  expect(prefs.libreTranslateUrl).toBe('https://libretranslate.com');
  expect(prefs.libreTranslateApiKey).toBe('');
});
```

Adapter au harnais exact du fichier (la variable `db` / création de repo peut différer — suivre le test « returns defaults when nothing stored » existant).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:db -- settingsRepo`
Expected: FAIL — `prefs.libreTranslateUrl` undefined

- [ ] **Step 3: Write the implementation**

`src/core/types.ts` :

```ts
export interface UiPrefs {
  language: LanguagePref;
  defaultTheme: ThemeName;
  libreTranslateUrl: string;
  libreTranslateApiKey: string;
}

export const DEFAULT_UI_PREFS: UiPrefs = {
  language: 'auto',
  defaultTheme: 'day',
  libreTranslateUrl: 'https://libretranslate.com',
  libreTranslateApiKey: '',
};
```

`src/core/services.ts` :

```ts
import { createLookupService } from './lookup/lookupService';
```

Dans `createServices` (créer le repo settings une fois) :

```ts
const settingsRepo = createSettingsRepo(args.db);
return {
  books: createBooksRepo(args.db, args.newId),
  progress: createProgressRepo(args.db),
  bookmarks: createBookmarksRepo(args.db, args.newId),
  settings: settingsRepo,
  lookup: createLookupService({
    translateConfig: async () => {
      const prefs = await settingsRepo.getUiPrefs();
      return { url: prefs.libreTranslateUrl, apiKey: prefs.libreTranslateApiKey || null };
    },
  }),
  fs: args.fs,
  paths: createStoragePaths(args.root, args.fs),
};
```

et `lookup: ReturnType<typeof createLookupService>;` dans `AppServices`.

`src/features/settings/SettingsScreen.tsx` — après les chips de thème, deux lignes TextInput (styles `styles.textInput` à créer sur le modèle de `styles.search` de LibraryScreen) :

```tsx
<View style={styles.infoRow}>
  <Text style={styles.rowLabel}>{t('settings.libreTranslateUrl')}</Text>
  <TextInput
    style={styles.textInput}
    value={prefs.libreTranslateUrl}
    onChangeText={(v) => { void update({ libreTranslateUrl: v }); }}
    autoCapitalize="none"
    autoCorrect={false}
    keyboardType="url"
    numberOfLines={1}
  />
</View>
<View style={styles.infoRow}>
  <Text style={styles.rowLabel}>{t('settings.libreTranslateApiKey')}</Text>
  <TextInput
    style={styles.textInput}
    value={prefs.libreTranslateApiKey}
    onChangeText={(v) => { void update({ libreTranslateApiKey: v }); }}
    autoCapitalize="none"
    autoCorrect={false}
    secureTextEntry
    numberOfLines={1}
  />
</View>
```

i18n — `settings.libreTranslateUrl` : fr `'URL LibreTranslate'` / en `'LibreTranslate URL'` ; `settings.libreTranslateApiKey` : fr `'Clé API LibreTranslate'` / en `'LibreTranslate API key'` (dans les deux fichiers, même arborescence).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:db && npm run typecheck && npm test -- src/i18n`
Expected: PASS (parité incluse)

- [ ] **Step 5: Commit**

```bash
git add src/core/types.ts src/core/services.ts src/features/settings/SettingsScreen.tsx src/db/__tests__/settingsRepo.db.test.ts src/i18n/fr.ts src/i18n/en.ts
git commit -m "feat(settings): LibreTranslate url + api key in uiPrefs, wired into the lookup service"
```

---

### Task 7: SelectionPopover + DefinitionSheet

**Files:**
- Create: `src/features/reader/SelectionPopover.tsx`
- Create: `src/features/reader/DefinitionSheet.tsx`
- Test: `src/features/reader/__tests__/SelectionPopover.test.tsx`, `src/features/reader/__tests__/DefinitionSheet.test.tsx`

**Interfaces:**
- Consumes: `LookupService` via `useServices().lookup` ; `LookupError`/`DefinitionSense` (Task 2) ; i18n `lookup.*`.
- Produces: `export interface SelectionState { text: string; rect: SelectionRect; cfi: string | null }`; `SelectionPopover({ selection, onDefine, onTranslate, onCopy, onDismiss })` — boutons `lookup.define`/`lookup.translate`/`lookup.copy`, positionné au-dessus du rect clampé aux bords (`useWindowDimensions`) ; `DefinitionSheet({ word, lang, initialMode, onClose })` avec `initialMode: 'define' | 'translate'`, footer « Traduire » en mode define → bascule en translate, états busy/erreurs via `lookup.loading`/`lookup.offline`/`lookup.notFound`/`lookup.serviceError`/`lookup.translating`, source = `lang ?? 'en'`, cible = langue UI (`i18n.language === 'fr' ? 'fr' : 'en'`).

- [ ] **Step 1: Write the failing tests**

```tsx
// SelectionPopover.test.tsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { SelectionPopover, type SelectionState } from '../SelectionPopover';
import { initI18n } from '../../../i18n';

const selection: SelectionState = { text: 'mot', rect: { x: 50, y: 300, width: 60, height: 24 }, cfi: 'cfi-1' };

describe('SelectionPopover', () => {
  beforeAll(async () => { await initI18n('fr'); });

  it('shows the selected text and fires the action callbacks', () => {
    const onDefine = jest.fn(); const onTranslate = jest.fn(); const onCopy = jest.fn();
    render(
      <SelectionPopover selection={selection} onDefine={onDefine} onTranslate={onTranslate} onCopy={onCopy} onDismiss={() => {}} />,
    );
    fireEvent.press(screen.getByText('Définir'));
    fireEvent.press(screen.getByText('Traduire'));
    fireEvent.press(screen.getByText('Copier'));
    expect(onDefine).toHaveBeenCalledTimes(1);
    expect(onTranslate).toHaveBeenCalledTimes(1);
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(screen.getByText('mot')).toBeOnTheScreen();
  });
});
```

```tsx
// DefinitionSheet.test.tsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ServicesProvider } from '../../../core/services';
import { DefinitionSheet } from '../DefinitionSheet';
import { LookupError } from '../../../core/lookup/lookupService';
import { initI18n } from '../../../i18n';

const baseServices = (lookup: unknown) => ({
  settings: { getReaderSettings: async () => ({ fontFamily: 'serif', fontSize: 18, lineHeight: 1.6, margin: 20, theme: 'day', ttsRate: 1, brightness: 0 }), putReaderSettings: async () => {}, getUiPrefs: async () => ({ language: 'fr', defaultTheme: 'day', libreTranslateUrl: 'https://x', libreTranslateApiKey: '' }), putUiPrefs: async () => {} },
  lookup,
}) as never;

describe('DefinitionSheet', () => {
  beforeAll(async () => { await initI18n('fr'); });

  it('lists definitions and switches to translation from the footer', async () => {
    const lookup = {
      define: jest.fn(async () => [{ pos: 'nom', glosses: ['Un objet imprimé'] }]),
      translate: jest.fn(async () => 'libro'),
    };
    render(
      <ServicesProvider value={baseServices(lookup)}>
        <DefinitionSheet word="book" lang="en" initialMode="define" onClose={() => {}} />
      </ServicesProvider>,
    );
    expect(await screen.findByText('Un objet imprimé')).toBeOnTheScreen();
    fireEvent.press(screen.getByText('Traduire'));
    expect(await screen.findByText('libro')).toBeOnTheScreen();
    expect(lookup.translate).toHaveBeenCalledWith('book', 'en', 'fr');
  });

  it('renders the offline error state', async () => {
    const lookup = { define: jest.fn(async () => { throw new LookupError('offline'); }), translate: jest.fn() };
    render(
      <ServicesProvider value={baseServices(lookup)}>
        <DefinitionSheet word="book" lang="en" initialMode="define" onClose={() => {}} />
      </ServicesProvider>,
    );
    expect(await screen.findByText('Recherche en ligne indisponible (hors connexion)')).toBeOnTheScreen();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/features/reader/__tests__/SelectionPopover.test.tsx src/features/reader/__tests__/DefinitionSheet.test.tsx`
Expected: FAIL — modules introuvables

- [ ] **Step 3: Write the implementation**

```tsx
// SelectionPopover.tsx
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { SelectionRect } from '../../core/types';

export interface SelectionState { text: string; rect: SelectionRect; cfi: string | null }

export function SelectionPopover({ selection, onDefine, onTranslate, onCopy, onDismiss }: {
  selection: SelectionState;
  onDefine(): void;
  onTranslate(): void;
  onCopy(): void;
  onDismiss(): void;
}) {
  const { t } = useTranslation();
  const POPOVER_WIDTH = 280;
  const left = Math.max(8, Math.min(selection.rect.x, screenW - POPOVER_WIDTH - 8)); // screenW via useWindowDimensions
  const above = selection.rect.y >= 64;
  const top = above ? selection.rect.y - 56 : selection.rect.y + selection.rect.height + 8;
  return (
    <View style={[styles.root, { left, top, width: POPOVER_WIDTH }]} testID="selection-popover">
      <Pressable onPress={onDismiss} hitSlop={8} accessibilityLabel={t('common.cancel')}>
        <Text style={styles.close}>{'✕'}</Text>
      </Pressable>
      <Text style={styles.text} numberOfLines={2}>{selection.text}</Text>
      <View style={styles.actions}>
        <Pressable style={styles.action} onPress={onDefine}><Text style={styles.actionText}>{t('lookup.define')}</Text></Pressable>
        <Pressable style={styles.action} onPress={onTranslate}><Text style={styles.actionText}>{t('lookup.translate')}</Text></Pressable>
        <Pressable style={styles.action} onPress={onCopy}><Text style={styles.actionText}>{t('lookup.copy')}</Text></Pressable>
      </View>
    </View>
  );
}
```

(compléter `screenW` avec `useWindowDimensions().width` ; styles : carte blanche, ombre, rayon 12, actions en ligne gap 12, `actionText` bleu #2D6CDF.)

```tsx
// DefinitionSheet.tsx
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useServices } from '../../core/services';
import { LookupError, type DefinitionSense, type LookupErrorKind } from '../../core/lookup/lookupService';

export type LookupMode = 'define' | 'translate';

export function DefinitionSheet({ word, lang, initialMode, onClose }: {
  word: string;
  lang: string | null;
  initialMode: LookupMode;
  onClose(): void;
}) {
  const { t, i18n } = useTranslation();
  const { lookup } = useServices();
  const [mode, setMode] = useState<LookupMode>(initialMode);
  const [senses, setSenses] = useState<DefinitionSense[] | null>(null);
  const [translation, setTranslation] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<LookupErrorKind | null>(null);
  const target = i18n.language === 'fr' ? 'fr' : 'en';

  const run = useCallback(async () => {
    setSenses(null); setTranslation(null); setErrorKind(null);
    try {
      if (mode === 'define') setSenses(await lookup.define(word, lang));
      else setTranslation(await lookup.translate(word, lang ?? 'en', target));
    } catch (e) {
      setErrorKind(e instanceof LookupError ? e.kind : 'service_error');
    }
  }, [mode, word, lang, target, lookup]);

  useEffect(() => { void run(); }, [run]);

  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('common.cancel')} />
      <View style={styles.sheet}>
        <Text style={styles.word} numberOfLines={2}>{word}</Text>
        {senses !== null ? (
          senses.length === 0
            ? <Text style={styles.state}>{t('lookup.notFound')}</Text>
            : (
              <ScrollView style={styles.scroll}>
                {senses.map((s, i) => (
                  <View key={i} style={styles.sense}>
                    {s.pos ? <Text style={styles.pos}>{s.pos}</Text> : null}
                    {s.glosses.map((g, j) => <Text key={j} style={styles.gloss}>{`• ${g}`}</Text>)}
                  </View>
                ))}
              </ScrollView>
            )
        ) : null}
        {translation !== null ? <ScrollView style={styles.scroll}><Text style={styles.gloss}>{translation}</Text></ScrollView> : null}
        {errorKind ? <Text style={styles.state}>{t(`lookup.${errorKind === 'offline' ? 'offline' : errorKind === 'not_found' ? 'notFound' : 'serviceError'}`)}</Text> : null}
        {senses === null && translation === null && !errorKind ? (
          <View style={styles.busyRow}><ActivityIndicator /><Text style={styles.state}>{t(mode === 'define' ? 'lookup.loading' : 'lookup.translating')}</Text></View>
        ) : null}
        {errorKind ? (
          <Pressable style={styles.retry} onPress={() => { void run(); }}>
            <Text style={styles.retryText}>{t('common.retry')}</Text>
          </Pressable>
        ) : null}
        <View style={styles.footer}>
          <Pressable style={[styles.footerBtn, mode === 'translate' && styles.footerBtnOn]} onPress={() => setMode('translate')}>
            <Text style={[styles.footerText, mode === 'translate' && styles.footerTextOn]}>{t('lookup.translate')}</Text>
          </Pressable>
          <Pressable style={styles.footerBtn} onPress={onClose}>
            <Text style={styles.footerText}>{t('common.cancel')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
```

(styles : `backdrop` flex 1 + `#00000055`, `sheet` fond blanc, paddingTop 16, radius supérieurs 16, `maxHeight: '70%'` — s'alignera avec le traitement adaptatif des Task 10/12/15 via le même pattern `useWindowLayout` si trivial, sinon bottom sheet partout : enregistre le choix dans le rapport.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/features/reader/__tests__/SelectionPopover.test.tsx src/features/reader/__tests__/DefinitionSheet.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/reader/SelectionPopover.tsx src/features/reader/DefinitionSheet.tsx src/features/reader/__tests__/SelectionPopover.test.tsx src/features/reader/__tests__/DefinitionSheet.test.tsx src/i18n/fr.ts src/i18n/en.ts
git commit -m "feat(reader): selection popover and definition/translation sheet (wiktionary + libretranslate)"
```

Clés i18n Task 7 — fr : `lookup.define` « Définir », `lookup.translate` « Traduire », `lookup.copy` « Copier », `lookup.loading` « Recherche de la définition… », `lookup.translating` « Traduction… », `lookup.offline` « Recherche en ligne indisponible (hors connexion) », `lookup.notFound` « Aucune définition trouvée », `lookup.serviceError` « Le service de définition a échoué » ; en : « Define », « Translate », « Copy », « Looking up… », « Translating… », « Online lookup unavailable (offline) », « No definition found », « The definition service failed ».

---

### Task 8: Migration v2 + annotationsRepo + purge

**Files:**
- Modify: `src/db/migrate.ts` (CURRENT_SCHEMA_VERSION = 2)
- Create: `src/db/annotationsRepo.ts`
- Modify: `src/core/services.ts` (membre `annotations`)
- Modify: `src/core/startup.ts` (purge au démarrage)
- Test: `src/db/__tests__/annotationsRepo.db.test.ts`

**Interfaces:**
- Consumes: Task 3 (`Annotation`, `NewAnnotation`, `HighlightColor`), `DbDriver`.
- Produces: `createAnnotationsRepo(db: DbDriver, newId: () => string)` → `{ add(input: NewAnnotation): Promise<Annotation>; listByBook(bookId: string): Promise<Annotation[]>; setNote(id: string, note: string | null, at: number): Promise<void>; setColor(id: string, color: HighlightColor, at: number): Promise<void>; markDeleted(id: string, at: number): Promise<void>; purgeDeletedBefore(cutoff: number): Promise<void> }` ; `AppServices.annotations` ; purge appelée dans `createAppServices` à la suite de `books.purgeDeletedBefore`.
- Ruling (à ledger): `listByBook` trie par `created_at ASC` (ordre de lecture) — un tri par CFI lexicographique n'est pas fiable.

- [ ] **Step 1: Write the failing test**

```ts
// annotationsRepo.db.test.ts — harnais identique aux autres tests db (node:sqlite, migrate)
import { createAnnotationsRepo } from '../annotationsRepo';
import { migrate } from '../migrate';
import { createNodeSqliteDriver } from '../nodeSqliteDriver';
import { DatabaseSync } from 'node:sqlite';

const seedBook = (db: import('../driver').DbDriver) =>
  db.run('INSERT INTO books (id,title,format,file_name,file_size,added_at,updated_at) VALUES (?,?,?,?,?,?,?)',
    ['b1', 'T', 'epub', 't.epub', 1, 1, 1]);

describe('annotationsRepo', () => {
  const setup = async () => {
    const db = createNodeSqliteDriver(new DatabaseSync(':memory:'));
    await migrate(db);
    await seedBook(db);
    const repo = createAnnotationsRepo(db, (() => { let i = 0; return () => `a-${++i}`; })());
    return { db, repo };
  };

  it('adds, lists by book excluding tombstones, in creation order', async () => {
    const { repo } = await setup();
    await repo.add({ bookId: 'b1', cfi: 'epubcfi(/6/4)', color: 'yellow', note: null, excerpt: 'Premier', createdAt: 100 });
    await repo.add({ bookId: 'b1', cfi: 'epubcfi(/6/6)', color: 'green', note: null, excerpt: 'Second', createdAt: 200 });
    const list = await repo.listByBook('b1');
    expect(list.map((a) => a.excerpt)).toEqual(['Premier', 'Second']);
  });

  it('updates note and color with updatedAt, tombstones, purges after cutoff', async () => {
    const { db, repo } = await setup();
    const a = await repo.add({ bookId: 'b1', cfi: 'cfi', color: 'blue', note: null, excerpt: 'x', createdAt: 100 });
    await repo.setNote(a.id, 'ma note', 150);
    await repo.setColor(a.id, 'red', 160);
    const [updated] = await repo.listByBook('b1');
    expect(updated.note).toBe('ma note');
    expect(updated.color).toBe('red');
    expect(updated.updatedAt).toBe(160);
    await repo.markDeleted(a.id, 200);
    expect(await repo.listByBook('b1')).toEqual([]);
    await repo.purgeDeletedBefore(300);
    const row = await db.get<{ id: string }>('SELECT id FROM annotations');
    expect(row).toBeUndefined();
  });

  it('purges only tombstones older than the cutoff', async () => {
    const { db, repo } = await setup();
    const a = await repo.add({ bookId: 'b1', cfi: 'cfi', color: 'yellow', note: null, excerpt: 'x', createdAt: 100 });
    await repo.markDeleted(a.id, 200);
    await repo.purgeDeletedBefore(150);
    expect(await repo.listByBook('b1')).toEqual([]); // toujours tombstoné, mais présent en base
    const kept = await db.get<{ id: string }>('SELECT id FROM annotations');
    expect(kept?.id).toBe(a.id);
    await repo.purgeDeletedBefore(300);
    const gone = await db.get<{ id: string }>('SELECT id FROM annotations');
    expect(gone).toBeUndefined();
  });

  it('cascades on book delete (FK ON DELETE CASCADE)', async () => {
    const { db, repo } = await setup();
    await repo.add({ bookId: 'b1', cfi: 'cfi', color: 'yellow', note: null, excerpt: 'x', createdAt: 100 });
    await db.run('PRAGMA foreign_keys = ON');
    await db.run('DELETE FROM books WHERE id = ?', ['b1']);
    const row = await db.get<{ id: string }>('SELECT id FROM annotations');
    expect(row).toBeUndefined();
  });
});
```

Adapter `setup` au harnais exact des tests db existants (`progressBookmarks.db.test.ts`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:db -- annotationsRepo`
Expected: FAIL — module/table introuvables

- [ ] **Step 3: Write the implementation**

`src/db/migrate.ts` :

```ts
export const CURRENT_SCHEMA_VERSION = 2;
```

et dans `MIGRATIONS` :

```ts
2: `
    CREATE TABLE annotations (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      cfi TEXT NOT NULL,
      color TEXT NOT NULL,
      note TEXT,
      excerpt TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );
    CREATE INDEX idx_annotations_book ON annotations(book_id, deleted_at);
  `,
```

`src/db/annotationsRepo.ts` (pattern `bookmarksRepo`) :

```ts
import type { DbDriver } from './driver';
import type { Annotation, HighlightColor, NewAnnotation } from '../core/types';

interface AnnotationRow { id: string; book_id: string; cfi: string; color: HighlightColor; note: string | null; excerpt: string; created_at: number; updated_at: number; deleted_at: number | null }
const toAnnotation = (r: AnnotationRow): Annotation => ({ id: r.id, bookId: r.book_id, cfi: r.cfi, color: r.color, note: r.note, excerpt: r.excerpt, createdAt: r.created_at, updatedAt: r.updated_at, deletedAt: r.deleted_at });

export function createAnnotationsRepo(db: DbDriver, newId: () => string) {
  return {
    async add(input: NewAnnotation): Promise<Annotation> {
      const a: Annotation = { ...input, id: input.id ?? newId(), updatedAt: input.createdAt, deletedAt: null };
      await db.run(
        'INSERT INTO annotations (id,book_id,cfi,color,note,excerpt,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?)',
        [a.id, a.bookId, a.cfi, a.color, a.note, a.excerpt, a.createdAt, a.updatedAt, a.deletedAt],
      );
      return a;
    },
    async listByBook(bookId: string): Promise<Annotation[]> {
      const rows = await db.all<AnnotationRow>('SELECT * FROM annotations WHERE book_id = ? AND deleted_at IS NULL ORDER BY created_at ASC', [bookId]);
      return rows.map(toAnnotation);
    },
    async setNote(id: string, note: string | null, at: number): Promise<void> {
      await db.run('UPDATE annotations SET note = ?, updated_at = ? WHERE id = ?', [note, at, id]);
    },
    async setColor(id: string, color: HighlightColor, at: number): Promise<void> {
      await db.run('UPDATE annotations SET color = ?, updated_at = ? WHERE id = ?', [color, at, id]);
    },
    async markDeleted(id: string, at: number): Promise<void> {
      await db.run('UPDATE annotations SET deleted_at = ?, updated_at = ? WHERE id = ?', [at, at, id]);
    },
    async purgeDeletedBefore(cutoff: number): Promise<void> {
      await db.run('DELETE FROM annotations WHERE deleted_at IS NOT NULL AND deleted_at < ?', [cutoff]);
    },
  };
}
```

`src/core/services.ts` : `annotations: createAnnotationsRepo(args.db, args.newId),` + type. `src/core/startup.ts` : après la purge des livres :

```ts
await services.annotations.purgeDeletedBefore(computePurgeCutoff(Date.now()));
```

- [ ] **Step 4: Run tests to verify it passes**

Run: `npm run test:db && npm test -- src/db src/core` 
Expected: PASS — inclut `migrate.db.test.ts` (idempotence toujours verte)

- [ ] **Step 5: Commit**

```bash
git add src/db/migrate.ts src/db/annotationsRepo.ts src/core/services.ts src/core/startup.ts src/db/__tests__/annotationsRepo.db.test.ts
git commit -m "feat(annotations): schema v2, annotations repo with tombstones+purge, cascade FK"
```

---

### Task 9: Moteur — surlignages (overlayer + replay relocate)

**Files:**
- Modify: `src/engine/engine.ts`
- Modify: `src/engine/foliate-js.d.ts` (addAnnotation, deleteAnnotation, getCFI, clearSearch, search — déclarer getCFI/search maintenant pour éviter deux passes)
- Test: aucun nouveau (câblage DOM) ; portes = typecheck + build

**Interfaces:**
- Consumes: Task 3 (addHighlight/removeHighlight).
- Produces: le moteur trace les surlignages (`Map<id, {annotation, color}>`), dessine via `draw-annotation` → `Overlayer.highlight` avec couleur hex (jaune #F7D354, vert #7DCEA0, bleu #85C1E9, rouge #EC7063), re-dessine tous les records sur chaque `relocate` (pattern de la démo foliate : les annotations ne survivent pas au changement de section sans re-add), `addHighlight` avant couleur existante = recoloration.

- [ ] **Step 1: Verify the API surface** (déjà fait — re-confirmer les lignes)

Run: `grep -n "addAnnotation\|draw-annotation" node_modules/foliate-js/view.js | head -6 && grep -n "static highlight" node_modules/foliate-js/overlayer.js`
Expected: `async addAnnotation(annotation, remove)`, `this.#emit('draw-annotation', { draw, annotation, doc, range })`, `static highlight(rects, options = {})`

- [ ] **Step 2: Implement**

```ts
import { Overlayer } from 'foliate-js/overlayer.js';

const HIGHLIGHT_COLORS: Record<HighlightColor, string> = {
  yellow: '#F7D354', green: '#7DCEA0', blue: '#85C1E9', red: '#EC7063',
};

type HighlightRecord = { annotation: { id: string; value: string }; color: HighlightColor };
const highlightRecords = new Map<string, HighlightRecord>();

view.addEventListener('draw-annotation', (e: Event) => {
  const { draw, annotation } = (e as CustomEvent).detail as {
    draw: (func: typeof Overlayer.highlight, opts: { color: string }) => void;
    annotation: { id?: string };
  };
  const rec = annotation.id ? highlightRecords.get(annotation.id) : undefined;
  draw(Overlayer.highlight, { color: HIGHLIGHT_COLORS[rec?.color ?? 'yellow'] });
});

// les overlays ne survivent pas au changement de section : re-add sur chaque relocate
view.addEventListener('relocate', (() => {
  let queued = false;
  return () => {
    if (queued || highlightRecords.size === 0) return;
    queued = true;
    setTimeout(() => {
      queued = false;
      for (const rec of highlightRecords.values()) {
        view.addAnnotation(rec.annotation).catch(() => { /* section absente du viewport */ });
      }
    }, 0);
  };
})());
```

Dans le switch `receive` :

```ts
case 'addHighlight': {
  const existing = highlightRecords.get(msg.id);
  const annotation = existing?.annotation ?? { id: msg.id, value: msg.cfi };
  highlightRecords.set(msg.id, { annotation, color: msg.color });
  view.addAnnotation(annotation).catch((e) => console.log('[engine] addHighlight failed', e));
  break;
}
case 'removeHighlight': {
  const rec = highlightRecords.get(msg.id);
  if (!rec) break;
  highlightRecords.delete(msg.id);
  view.deleteAnnotation(rec.annotation).catch(() => { /* pas affiché */ });
  break;
}
```

Ajouter `'addHighlight'` et `'removeHighlight'` au `QUIET_UNTIL_LOADED`.

`foliate-js.d.ts` — étendre la déclaration `View` :

```ts
    getCFI(index: number, range: unknown): string;
    resolveNavigation(target: string): Promise<{ index: number; anchor?: unknown }>;
    addAnnotation(annotation: { id?: string; value: string }, remove?: boolean): Promise<{ index: number; label?: string }>;
    deleteAnnotation(annotation: { id?: string; value: string }): Promise<{ index: number; label?: string }>;
    clearSearch(): void;
    search(opts: { query: string; index?: number; caseDiacriticsInsensitive?: boolean; caseSensitive?: boolean; defaultLocale?: string }): AsyncGenerator<
      { progress: number } | { label?: string; subitems: { cfi: string; excerpt: string }[] } | { cfi: string; excerpt: string } | 'done',
      void,
      unknown
    >;
    tts?: unknown;
```

et déclarer le module overlayer (requis dès cette tâche — `engine.ts` importe `Overlayer`) :

```ts
declare module 'foliate-js/overlayer.js' {
  export class Overlayer {
    static highlight(rects: unknown, options?: { color?: string }): unknown;
    static underline(rects: unknown, options?: { color?: string }): unknown;
    constructor(doc: Document);
  }
}
```

- [ ] **Step 3: Typecheck + rebuild**

Run: `npm run typecheck && npm run build:engine`
Expected: 0 erreur ; engineHtml.ts régénéré

- [ ] **Step 4: Commit**

```bash
git add src/engine/engine.ts src/engine/foliate-js.d.ts src/engine/engineHtml.ts
git commit -m "feat(engine): highlight overlay draw + replay on relocate, add/removeHighlight"
```

---

### Task 10: Action Surligner + AnnotationsPanel + replay à l'ouverture

**Files:**
- Modify: `src/features/reader/SelectionPopover.tsx` (action Surligner + 4 pastilles couleur)
- Create: `src/features/reader/AnnotationsPanel.tsx`
- Modify: `src/features/reader/ReaderScreen.tsx` (état sélection, popover, panneau `annotations`, replay post-ouverture)
- Test: `src/features/reader/__tests__/AnnotationsPanel.test.tsx`, tests mis à jour SelectionPopover

**Interfaces:**
- Consumes: `AppServices.annotations` (Task 8), `bridge.addHighlight/removeHighlight` (Task 4), `SelectionState.cfi` (Task 7).
- Produces: popover → `onHighlightPress()` → passe en mode couleur (4 pastilles `HighlightColor`) → `onHighlight(color)` ; `AnnotationsPanel({ bookId, bridge, onNavigate })` (pattern BookmarksPanel) : liste (pastille couleur + extrait + icône note), tap → navigate, édition note inline (TextInput + save → `setNote`), changement couleur → `setColor` + `bridge.removeHighlight(id)` + `bridge.addHighlight(id, cfi, color)`, suppression (confirm) → `markDeleted` + `bridge.removeHighlight` ; ReaderScreen : `selectionChanged` → état `selection`, replay des annotations après `state==='ready'` (listByBook → addHighlight chacun), PanelName + bouton chrome.

- [ ] **Step 1: Write the failing test** (SelectionPopover : compléter le test Task 7)

```tsx
it('exposes highlight colors when requested and emits the chosen color', () => {
  const onHighlight = jest.fn();
  const { rerender } = render(
    <SelectionPopover selection={selection} onDefine={() => {}} onTranslate={() => {}} onCopy={() => {}}
      highlightMode onHighlight={onHighlight} onDismiss={() => {}} />,
  );
  fireEvent.press(screen.getByTestId('highlight-yellow'));
  expect(onHighlight).toHaveBeenCalledWith('yellow');
});
```

```tsx
// AnnotationsPanel.test.tsx — harnais services réel (node:sqlite) comme BookmarksPanel.test.tsx
describe('AnnotationsPanel', () => {
  beforeAll(async () => { await initI18n('fr'); });

  it('lists seeded annotations and deletes via the remove action', async () => {
    const services = await makeServices(); // seed livre b1 + une annotation via services.annotations.add
    const addHighlight = jest.fn(); const removeHighlight = jest.fn();
    await render(
      <ServicesProvider value={services}>
        <AnnotationsPanel bookId="b1" bridge={{ addHighlight, removeHighlight } as never} onNavigate={() => {}} />
      </ServicesProvider>,
    );
    expect(await screen.findByText(/Extrait de test/)).toBeOnTheScreen();
    fireEvent.press(await screen.findByLabelText('Supprimer le surlignage'));
    expect(await screen.findByText('Aucun surlignage')).toBeOnTheScreen();
    expect(removeHighlight).toHaveBeenCalledWith('a-1');
  });

  it('saves a note via setNote', async () => {
    const services = await makeServices(); // annotation seedée
    await render(
      <ServicesProvider value={services}>
        <AnnotationsPanel bookId="b1" bridge={{ addHighlight: jest.fn(), removeHighlight: jest.fn() } as never} onNavigate={() => {}} />
      </ServicesProvider>,
    );
    fireEvent.press(await screen.findByText(/Extrait de test/)); // ouvre l'édition
    fireEvent.changeText(screen.getByPlaceholderText('Ajouter une note…'), 'Ma note');
    fireEvent.press(screen.getByText('Enregistrer'));
    expect(await screen.findByText('Ma note')).toBeOnTheScreen();
  });
});
```

Adapter les sélecteurs au rendu réel (accessibilityLabel `annotations.remove`, placeholder `annotations.noteHint`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/features/reader/__tests__/AnnotationsPanel.test.tsx src/features/reader/__tests__/SelectionPopover.test.tsx`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

SelectionPopover : prop optionnelle `highlightMode?: boolean` + `onHighlight?: (color: HighlightColor) => void` ; quand `highlightMode`, remplacer les 3 actions par 4 pastilles (`testID={`highlight-${color}`}`, couleur de fond = hex moteur). ReaderScreen : `const [highlightMode, setHighlightMode] = useState(false)` — Surligner ouvre le mode couleur (déclenché par un 4e bouton du popover, cf. clé `lookup.highlight`).

AnnotationsPanel (pattern BookmarksPanel, ~120 lignes) :

```tsx
export interface HighlightBridge { addHighlight(id: string, cfi: string, color: HighlightColor): void; removeHighlight(id: string): void }

export function AnnotationsPanel({ bookId, bridge, onNavigate }: {
  bookId: string;
  bridge: HighlightBridge;
  onNavigate(target: string): void;
}) {
  const { t } = useTranslation();
  const { annotations } = useServices();
  const [items, setItems] = useState<Annotation[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const reload = useCallback(async () => { setItems(await annotations.listByBook(bookId)); }, [annotations, bookId]);
  useEffect(() => { void (async () => { await reload(); })(); }, [reload]);

  const changeColor = async (a: Annotation, color: HighlightColor) => {
    await annotations.setColor(a.id, color, Date.now());
    bridge.removeHighlight(a.id);
    bridge.addHighlight(a.id, a.cfi, color);
    await reload();
  };
  const remove = async (a: Annotation) => {
    await annotations.markDeleted(a.id, Date.now()).catch(() => {});
    bridge.removeHighlight(a.id);
    await reload();
  };
  const saveNote = async (a: Annotation) => {
    await annotations.setNote(a.id, noteDraft.trim() || null, Date.now());
    setEditing(null);
    await reload();
  };
  // rendu : ligne = pastille (pressable → cycle des 4 couleurs en sous-rang) + extrait (pressable → editing=note) + ✕
  // en édition : TextInput noteDraft + bouton save ; tap extrait sans édition → onNavigate(a.cfi)
}
```

(Simplification assumée : tap = navigate, appui long ou bouton « note » = édition — suivre les labels i18n ci-dessous.)

ReaderScreen :

```tsx
const [selection, setSelection] = useState<SelectionState | null>(null);
const [highlightMode, setHighlightMode] = useState(false);
const [sheet, setSheet] = useState<{ word: string; lang: string | null; mode: 'define' | 'translate' } | null>(null);

useEffect(() => {
  if (!bridge) return;
  return (bridge as ReaderBridge).onSelectionChanged((s) => {
    setSelection(s.text && s.rect ? { text: s.text, rect: s.rect, cfi: s.cfi } : null);
    setHighlightMode(false);
  });
}, [bridge]);

// toute navigation = changement de page → la bulle disparaît
useEffect(() => { setSelection(null); }, [fraction]);

// replay des annotations après ouverture (les overlays ne survivent pas au reload moteur)
useEffect(() => {
  if (state !== 'ready' || !bridge) return;
  let cancelled = false;
  void (async () => {
    const list = await services.annotations.listByBook(bookId);
    if (cancelled) return;
    for (const a of list) (bridge as ReaderBridge).addHighlight(a.id, a.cfi, a.color);
  })();
  return () => { cancelled = true; };
}, [state, bridge, bookId, services]);
```

JSX (après l'overlay des tap zones) :

```tsx
{selection ? (
  <SelectionPopover
    selection={selection}
    highlightMode={highlightMode}
    onHighlight={(color) => {
      const sel = selection;
      if (sel.cfi) {
        const id = uuidV7(); // import depuis src/core/uuid — OK côté RN (expo-crypto)
        void services.annotations.add({ bookId, cfi: sel.cfi, color, note: null, excerpt: sel.text, createdAt: Date.now() })
          .then((a) => { (bridge as ReaderBridge).addHighlight(a.id, a.cfi, color); });
      }
      setSelection(null); setHighlightMode(false);
    }}
    onDefine={() => { setSheet({ word: selection.text, lang: selection.lang ?? null, mode: 'define' }); setSelection(null); }}
    onTranslate={() => { setSheet({ word: selection.text, lang: selection.lang ?? null, mode: 'translate' }); setSelection(null); }}
    onCopy={() => { (bridge as ReaderBridge).copySelection(); setSelection(null); }}
    onDismiss={() => { setSelection(null); setHighlightMode(false); }}
  />
) : null}
```

Le champ `lang` de `SelectionState` : étendre l'interface avec `lang: string | null` (Task 7) — mettre à jour le test SelectionPopover en conséquence.

Chrome : `<PanelName>` gagne `'annotations'` ; bouton barGlyph `'✎'` avec `accessibilityLabel={t('annotations.title')}` ; panneau rendu dans le drawer.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/features/reader && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/reader src/i18n/fr.ts src/i18n/en.ts
git commit -m "feat(reader): highlight action with colors, annotations panel, replay on open"
```

Clés i18n Task 10 — fr : `annotations.title` « Surlignages », `annotations.empty` « Aucun surlignage », `annotations.remove` « Supprimer le surlignage », `annotations.note` « Note », `annotations.noteHint` « Ajouter une note… », `annotations.save` « Enregistrer », `annotations.color` « Couleur », `lookup.highlight` « Surligner » ; en : « Highlights », « No highlights », « Remove highlight », « Note », « Add a note… », « Save », « Color », « Highlight ». (En-tête `annotations: {...}` et `lookup.highlight` ajouté à l'arborescence `lookup` existante.)

---

### Task 11: Moteur — recherche

**Files:**
- Modify: `src/engine/engine.ts`
- Test: aucun nouveau (câblage DOM) ; portes = typecheck + build

**Interfaces:**
- Consumes: Task 3 (search/searchCancel/searchResult/searchDone), déclaration `search`/`clearSearch` (Task 9).
- Produces: `search {query}` → itère `view.search({ query })` (cap 200 résultats, token d'annulation), chaque `subitems`/résultat individuel émis en `searchResult {cfi, excerpt, fraction}` où `fraction ≈ (index + 0.5) / sectionCount` (résolu via `resolveNavigation`, repli 0) ; fin → `searchDone {count}` ; `searchCancel` → `view.clearSearch()` + invalide le token ; `'done'` du générateur = fin. Ruling: le `%` affiché est une fraction de section approximative (foliate n'expose pas de fraction par cfi) — suffisant pour la liste.

- [ ] **Step 1: Verify the generator shape**

Run: `sed -n '529,563p' node_modules/foliate-js/view.js`
Expected: yields observés — `{ progress }`, `{ label, subitems }`, `{ cfi, excerpt }`, `'done'` (adapté en mai 2026 ; si le sha diffère, ajuster le mapping du Step 2)

- [ ] **Step 2: Implement**

```ts
const SEARCH_RESULT_CAP = 200;
let searchToken = 0;

// fraction approximative par section pour la liste de résultats
let sectionCount = 0; // alimenté dans le handler relocate existant : d?.section?.total ?? sectionCount
const fractionForCfi = async (cfi: string): Promise<number> => {
  try {
    const { index } = await view.resolveNavigation(cfi);
    return sectionCount > 0 ? Math.min(1, Math.max(0, (index + 0.5) / sectionCount)) : 0;
  } catch { return 0; }
};
```

(Préciser dans le handler `relocate` existant : `sectionCount = d?.section?.total ?? sectionCount;`)

Dans le switch `receive` :

```ts
case 'search': {
  const token = ++searchToken;
  void (async () => {
    let count = 0;
    try {
      for await (const result of view.search({ query: msg.query })) {
        if (token !== searchToken) return;
        if (result === 'done') break;
        if ('subitems' in result && result.subitems) {
          for (const item of result.subitems) {
            if (count >= SEARCH_RESULT_CAP) break;
            send({ type: 'searchResult', cfi: item.cfi, excerpt: item.excerpt, fraction: await fractionForCfi(item.cfi) });
            count++;
          }
        } else if ('cfi' in result && result.cfi) {
          if (count >= SEARCH_RESULT_CAP) break;
          send({ type: 'searchResult', cfi: result.cfi, excerpt: result.excerpt, fraction: await fractionForCfi(result.cfi) });
          count++;
        }
        if (count >= SEARCH_RESULT_CAP) break;
      }
    } catch (e) { console.log('[engine] search error', e); }
    if (token === searchToken) send({ type: 'searchDone', count });
  })();
  break;
}
case 'searchCancel':
  searchToken++;
  try { view.clearSearch(); } catch { /* pas encore chargé */ }
  break;
```

Ajouter `'search'`, `'searchCancel'` au `QUIET_UNTIL_LOADED`.

- [ ] **Step 3: Typecheck + rebuild**

Run: `npm run typecheck && npm run build:engine`
Expected: 0 erreur

- [ ] **Step 4: Commit**

```bash
git add src/engine/engine.ts src/engine/engineHtml.ts
git commit -m "feat(engine): in-book search over foliate search generator (cap 200, cancellable)"
```

---

### Task 12: SearchPanel

**Files:**
- Create: `src/features/reader/SearchPanel.tsx`
- Modify: `src/features/reader/ReaderScreen.tsx` (PanelName `'search'`, bouton chrome `'⌕'`)
- Test: `src/features/reader/__tests__/SearchPanel.test.tsx`

**Interfaces:**
- Consumes: `bridge.search/searchCancel/onSearchResult/onSearchDone/goTo` (Task 4).
- Produces: `SearchPanel({ bridge, onNavigate })` — champ (submit sur retour clavier), état `searching`, liste `{cfi, excerpt, fraction}[]` plafonnée à 200, footer compteur `search.results`, tap → `onNavigate(cfi)` ; `searchCancel` à l'unmount et avant chaque nouvelle recherche.

- [ ] **Step 1: Write the failing test**

```tsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { SearchPanel, type SearchBridge } from '../SearchPanel';
import { initI18n } from '../../../i18n';

const makeBridge = () => {
  let cb: ((r: { cfi: string; excerpt: string; fraction: number }) => void) | null = null;
  return {
    search: jest.fn(),
    searchCancel: jest.fn(),
    goTo: jest.fn(),
    onSearchResult: jest.fn((f: typeof cb) => { cb = f; return () => { cb = null; }; }),
    onSearchDone: jest.fn(() => () => {}),
    emit: (r: { cfi: string; excerpt: string; fraction: number }) => cb?.(r),
  };
};

describe('SearchPanel', () => {
  beforeAll(async () => { await initI18n('fr'); });

  it('submits the query, lists results and navigates on tap', () => {
    const bridge = makeBridge();
    const onNavigate = jest.fn();
    render(<SearchPanel bridge={bridge as unknown as SearchBridge} onNavigate={onNavigate} />);
    fireEvent.changeText(screen.getByPlaceholderText('Rechercher dans le livre…'), 'mot');
    fireEvent(screen.getByPlaceholderText('Rechercher dans le livre…'), 'submitEditing');
    expect(bridge.search).toHaveBeenCalledWith('mot');
    bridge.emit({ cfi: 'c1', excerpt: '…mot…', fraction: 0.4 });
    const row = screen.getByText(/…mot…/);
    fireEvent.press(row);
    expect(onNavigate).toHaveBeenCalledWith('c1');
  });

  it('cancels the search on unmount', () => {
    const bridge = makeBridge();
    const { unmount } = render(<SearchPanel bridge={bridge as unknown as SearchBridge} onNavigate={() => {}} />);
    unmount();
    expect(bridge.searchCancel).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/features/reader/__tests__/SearchPanel.test.tsx`
Expected: FAIL — module introuvable

- [ ] **Step 3: Write the implementation**

```tsx
import React, { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { SelectionRect } from '../../core/types'; // inutile ici — retirer

export interface SearchBridge {
  search(query: string): void;
  searchCancel(): void;
  goTo(target: string): void;
  onSearchResult(cb: (r: { cfi: string; excerpt: string; fraction: number }) => void): () => void;
  onSearchDone(cb: (count: number) => void): () => void;
}

export function SearchPanel({ bridge, onNavigate }: { bridge: SearchBridge; onNavigate(target: string): void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ cfi: string; excerpt: string; fraction: number }[]>([]);
  const [searching, setSearching] = useState(false);
  const offRef = useRef<(() => void)[]>([]);

  useEffect(() => {
    offRef.current = [
      bridge.onSearchResult((r) => setResults((prev) => [...prev, r])),
      bridge.onSearchDone(() => setSearching(false)),
    ];
    return () => { for (const off of offRef.current) off(); bridge.searchCancel(); };
  }, [bridge]);

  const submit = () => {
    const q = query.trim();
    if (!q) return;
    bridge.searchCancel();
    setResults([]);
    setSearching(true);
    bridge.search(q);
  };

  return (
    <View style={styles.root}>
      <TextInput
        style={styles.input}
        placeholder={t('search.placeholder')}
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={submit}
        autoCorrect={false}
        autoCapitalize="none"
      />
      {searching ? <Text style={styles.state}>{t('search.searching')}</Text> : null}
      {!searching && results.length === 0 ? <Text style={styles.state}>{t('search.empty')}</Text> : null}
      <FlatList
        data={results}
        keyExtractor={(r, i) => `${r.cfi}-${i}`}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => onNavigate(item.cfi)}>
            <Text style={styles.excerpt} numberOfLines={2}>{item.excerpt}</Text>
            <Text style={styles.percent}>{`${Math.round(item.fraction * 100)} %`}</Text>
          </Pressable>
        )}
      />
      {results.length > 0 ? <Text style={styles.count}>{t('search.results', { count: results.length })}</Text> : null}
    </View>
  );
}
```

(styles sobres cohérents avec BookmarksPanel.) Ne pas oublier `selection` reset (cf. Task 10 — fraction change ferme la bulle).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/features/reader/__tests__/SearchPanel.test.tsx && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/reader/SearchPanel.tsx src/features/reader/__tests__/SearchPanel.test.tsx src/features/reader/ReaderScreen.tsx src/i18n/fr.ts src/i18n/en.ts
git commit -m "feat(reader): search panel with cancellable queries and result navigation"
```

Clés i18n Task 12 — fr : `search.title` « Recherche », `search.placeholder` « Rechercher dans le livre… », `search.searching` « Recherche… », `search.empty` « Aucun résultat », `search.results` « {{count}} résultat(s) » ; en : « Search », « Search in the book… », « Searching… », « No results », « {{count}} result(s) ». (i18next : activer `returnObjects` non nécessaire — clé scalaire avec interpolation `count`.)

---

### Task 13: expo-speech + SpeechService + ttsRate

**Files:**
- Modify: `package.json` + lockfile (via `npx expo install expo-speech`)
- Modify: `src/core/types.ts` (ReaderSettings += `ttsRate: number` 0.5–2.0, défaut 1 ; `brightness: number` 0–70, défaut 0 — les deux maintenant pour une seule passe de défauts)
- Create: `src/core/speech/speechService.ts`
- Test: `src/core/speech/__tests__/speechService.test.ts`, cas store existant complété

**Interfaces:**
- Consumes: expo-speech (`speak(text, { language, rate, onDone })`, `stop()`, `pause()`, `resume()`).
- Produces: `export interface SpeechService { speak(text: string, opts: { language: string; rate: number; onDone: () => void }): void; stop(): void; pause(): void; resume(): void; speaking(): Promise<boolean> }`; `createExpoSpeechService(Speech?: typeof import('expo-speech'))` (module injectable pour les tests) ; `DEFAULT_READER_SETTINGS.ttsRate = 1`, `.brightness = 0`.

- [ ] **Step 1: Install the dependency**

Run: `npx expo install expo-speech`
Expected: package.json mis à jour (version SDK 57)

- [ ] **Step 2: Write the failing test**

```ts
import { createExpoSpeechService } from '../speechService';

const makeSpeech = () => ({
  speak: jest.fn(),
  stop: jest.fn(),
  pause: jest.fn(),
  resume: jest.fn(),
  isSpeakingAsync: jest.fn(async () => false),
});

describe('speechService', () => {
  it('speaks with language + rate and forwards onDone', async () => {
    const Speech = makeSpeech();
    const onDone = jest.fn();
    const service = createExpoSpeechService(Speech as never);
    service.speak('Phrase', { language: 'fr', rate: 1.5, onDone });
    expect(Speech.speak).toHaveBeenCalledWith('Phrase', expect.objectContaining({ language: 'fr-FR', rate: 1.5 }));
    (Speech.speak.mock.calls[0] as unknown as [string, { onDone: () => void }])[1].onDone();
    expect(onDone).toHaveBeenCalled();
  });

  it('maps control verbs and speaking()', async () => {
    const Speech = makeSpeech();
    const service = createExpoSpeechService(Speech as never);
    service.stop(); service.pause(); service.resume();
    expect(Speech.stop).toHaveBeenCalled();
    expect(Speech.pause).toHaveBeenCalled();
    expect(Speech.resume).toHaveBeenCalled();
    expect(await service.speaking()).toBe(false);
    expect(Speech.isSpeakingAsync).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest src/core/speech/__tests__/speechService.test.ts`
Expected: FAIL — module introuvable

- [ ] **Step 4: Write the implementation**

```ts
export interface SpeechOptions { language: string; rate: number; onDone: () => void }
export interface SpeechService {
  speak(text: string, opts: SpeechOptions): void;
  stop(): void;
  pause(): void;
  resume(): void;
  speaking(): Promise<boolean>;
}

type ExpoSpeechModule = {
  speak(text: string, options: { language: string; rate: number; onDone: () => void; onError?: () => void }): void;
  stop(): void;
  pause(): void;
  resume(): void;
  isSpeakingAsync(): Promise<boolean>;
};

export function createExpoSpeechService(Speech: ExpoSpeechModule): SpeechService {
  return {
    speak: (text, opts) => Speech.speak(text, { language: opts.language, rate: opts.rate, onDone: opts.onDone, onError: opts.onDone }),
    stop: () => { try { Speech.stop(); } catch { /* nothing playing */ } },
    pause: () => { try { Speech.pause(); } catch { /* unsupported platform */ } },
    resume: () => { try { Speech.resume(); } catch { /* unsupported platform */ } },
    speaking: () => Speech.isSpeakingAsync().catch(() => false),
  };
}
```

Ruling : mapping `fr` → `fr-FR`/`en` → `en-US` pour la voix (expo-speech attend un tag BCP-47 ; seul fr/en sont des langues d'interface — la langue du livre peut être tout code ISO : passer `${lang}-${lang.toUpperCase()}` quand 2 lettres, sinon le code brut).

`src/core/types.ts` :

```ts
export interface ReaderSettings {
  fontFamily: FontFamilyOption;
  fontSize: number;
  lineHeight: number;
  margin: number;
  theme: ThemeName;
  ttsRate: number; // 0.5–2.0
  brightness: number; // 0–70 (% d'assombrissement)
}

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  fontFamily: 'serif',
  fontSize: 18,
  lineHeight: 1.6,
  margin: 20,
  theme: 'day',
  ttsRate: 1,
  brightness: 0,
};
```

Note : le moteur reçoit `applySettings` avec ces champs et les ignore (il lit ses propres champs) — aucun changement moteur requis ici.

- [ ] **Step 5: Run test to verify it passes + gates**

Run: `npx jest src/core/speech && npm test -- src/features/settings && npm run typecheck`
Expected: PASS — le test store existant (« hydrates defaults then persists updates ») reste vert grâce à la fusion des défauts

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/core/types.ts src/core/speech src/core/speech/__tests__
git commit -m "feat(speech): expo-speech service (injectable) and ttsRate+brightness reader settings"
```

---

### Task 14: Moteur — TTS (ttsStart/ttsSentence/ttsNext/ttsStop)

**Files:**
- Modify: `src/engine/engine.ts`
- Modify: `src/engine/foliate-js.d.ts` (TTS + textWalker si besoin)
- Test: aucun nouveau (câblage DOM) ; portes = typecheck + build

**Interfaces:**
- Consumes: Task 3 (ttsStart/ttsStop/ttsNext/ttsSentence), `TTS` + `textWalker` (foliate-js, vérifiés).
- Produces: `ttsStart {cfi}` → (optionnel) `goTo(cfi)`, construit `new TTS(docCourant, textWalker, range → ttsRange, 'sentence')`, émet la 1ʳᵉ phrase ; `ttsNext` → `tts.next(true)` (highlight callback capte la range → cfi), parse le SSML → texte brut → `ttsSentence {text, cfi}` ; `ttsSentence {text: '', cfi: null}` = fin de flux ; `ttsStop` → détruit l'état TTS. Ruling : le TTS couvre la section courante (document chargé) — le passage automatique à la section suivante est hors périmètre V1.x (documenté dans la PR).

- [ ] **Step 1: Verify the TTS API** (déjà fait — re-confirmer)

Run: `sed -n '226,330p' node_modules/foliate-js/tts.js && grep -n "export" node_modules/foliate-js/text-walker.js`
Expected: `start()/resume()/next(paused)/prev(paused)` → SSML `string | undefined` ; `next(true)` appelle `highlight(range.cloneRange())` ; `textWalker` exporté.

- [ ] **Step 2: Implement**

```ts
import { TTS } from 'foliate-js/tts.js';
import { textWalker } from 'foliate-js/text-walker.js';

let tts: InstanceType<typeof TTS> | null = null;
let ttsRange: Range | null = null;
let ttsEmitting = false;

const ssmlToText = (ssml: string): string => {
  const doc = new DOMParser().parseFromString(ssml, 'text/xml');
  return (doc.documentElement.textContent ?? '').replace(/\s+/g, ' ').trim();
};

const ttsCurrentCfi = (): string | null => {
  if (!ttsRange) return null;
  const contents = view.renderer.getContents();
  const first = contents[0];
  if (!first) return null;
  try { return view.getCFI(first.index, ttsRange); } catch { return null; }
};

const ttsEmit = (step: 'start' | 'next'): void => {
  if (!tts || ttsEmitting) return;
  ttsEmitting = true;
  try {
    const ssml = step === 'start' ? tts.start() : tts.next(true);
    if (ssml == null) {
      tts = null; ttsRange = null;
      send({ type: 'ttsSentence', text: '', cfi: null }); // fin de flux
    } else {
      send({ type: 'ttsSentence', text: ssmlToText(ssml), cfi: ttsCurrentCfi() });
    }
  } finally {
    ttsEmitting = false;
  }
};
```

Dans le switch `receive` :

```ts
case 'ttsStart': {
  void (async () => {
    if (msg.cfi) { try { await view.goTo(msg.cfi); } catch { /* position par défaut */ } }
    const contents = view.renderer.getContents();
    const first = contents[0];
    if (!first?.doc) { send({ type: 'ttsSentence', text: '', cfi: null }); return; }
    ttsRange = null;
    tts = new TTS(first.doc, textWalker, (range: Range) => { ttsRange = range.cloneRange(); }, 'sentence');
    ttsEmit('start');
  })();
  break;
}
case 'ttsNext': ttsEmit('next'); break;
case 'ttsStop': tts = null; ttsRange = null; break;
```

Ajouter `'ttsStart'`, `'ttsNext'` au `QUIET_UNTIL_LOADED` (`ttsStop` peut passer hors chargement sans risque — ne pas l'ajouter).

`foliate-js.d.ts` — modules additionnels :

```ts
declare module 'foliate-js/tts.js' {
  export class TTS {
    constructor(doc: Document, textWalker: unknown, highlight: (range: Range) => void, granularity: string);
    start(): string | undefined;
    resume(): string | undefined;
    next(paused: boolean): string | undefined;
    prev(paused: boolean): string | undefined;
    doc?: Document;
  }
}
declare module 'foliate-js/text-walker.js' {
  export const textWalker: unknown;
}
```

(Le module `overlayer.js` est déjà déclaré depuis la Task 9 — ne pas le redéclarer.)

- [ ] **Step 3: Typecheck + rebuild**

Run: `npm run typecheck && npm run build:engine`
Expected: 0 erreur

- [ ] **Step 4: Commit**

```bash
git add src/engine/engine.ts src/engine/foliate-js.d.ts src/engine/engineHtml.ts
git commit -m "feat(engine): tts pipeline — sentence stream with native-side flow control"
```

---

### Task 15: TtsBar + intégration ReaderScreen

**Files:**
- Create: `src/features/reader/TtsBar.tsx`
- Modify: `src/features/reader/ReaderScreen.tsx` (barre + bouton chrome lecture/arrêt)
- Test: `src/features/reader/__tests__/TtsBar.test.tsx`

**Interfaces:**
- Consumes: `createExpoSpeechService` (Task 13), `bridge.ttsStart/ttsStop/ttsNext/onTtsSentence/goTo` (Task 4), `readerSettingsStore` (`ttsRate`).
- Produces: `TtsBar({ bridge, speech, rate, onRateChange, bookLang })` — boutons `tts.start` (→ `ttsStart(currentCfi)`, géré par ReaderScreen via prop `onStart`), pause/resume, stop, slider vitesse 0.5–2.0 pas 0.1, toggle « suivre la lecture » (goTo(cfi) à chaque phrase, désactivé par défaut) ; flux : `onTtsSentence` → `speech.speak(text, { language, rate, onDone: () => bridge.ttsNext() })` ; `text === ''` = fin → stop.

- [ ] **Step 1: Write the failing test**

```tsx
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react-native';
import { TtsBar, type TtsBridge } from '../TtsBar';
import { initI18n } from '../../../i18n';

const makeBridge = () => {
  let cb: ((s: { text: string; cfi: string | null }) => void) | null = null;
  return {
    ttsStart: jest.fn(),
    ttsStop: jest.fn(),
    ttsNext: jest.fn(),
    goTo: jest.fn(),
    onTtsSentence: jest.fn((f: typeof cb) => { cb = f; return () => { cb = null; }; }),
    emit: (s: { text: string; cfi: string | null }) => cb?.(s),
  };
};
const speech = () => ({ speak: jest.fn(), stop: jest.fn(), pause: jest.fn(), resume: jest.fn(), speaking: async () => false });

describe('TtsBar', () => {
  beforeAll(async () => { await initI18n('fr'); });

  const makeDeps = () => {
    const bridge = makeBridge();
    const sp = speech();
    const ttsBridge = bridge as unknown as TtsBridge;
    render(<TtsBar bridge={ttsBridge} speech={sp as never} rate={1} onRateChange={() => {}} bookLang="fr" currentCfi={() => 'c0'} onStart={() => bridge.ttsStart('c0')} follow={false} onFollowChange={() => {}} />);
    return { bridge, sp };
  };

  it('starts playback, speaks the sentence, chains ttsNext on done', () => {
    const { bridge, sp } = makeDeps();
    fireEvent.press(screen.getByLabelText('Lire à voix haute'));
    expect(bridge.ttsStart).toHaveBeenCalledWith('c0');
    act(() => bridge.emit({ text: 'Phrase une.', cfi: 'c1' }));
    expect(sp.speak).toHaveBeenCalledWith('Phrase une.', expect.objectContaining({ language: 'fr-FR', rate: 1 }));
    const onDone = (sp.speak.mock.calls[0] as unknown as [string, { onDone: () => void }])[1].onDone;
    act(() => onDone());
    expect(bridge.ttsNext).toHaveBeenCalled();
  });

  it('treats an empty sentence as end of stream and stops', () => {
    const { bridge, sp } = makeDeps();
    act(() => bridge.emit({ text: '', cfi: null }));
    expect(sp.stop).toHaveBeenCalled();
    expect(bridge.ttsStop).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/features/reader/__tests__/TtsBar.test.tsx`
Expected: FAIL — module introuvable

- [ ] **Step 3: Write the implementation**

```tsx
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { SpeechService } from '../../core/speech/speechService';
import type { HighlightColor } from '../../core/types'; // retirer si inutilisé

export interface TtsBridge {
  ttsStart(cfi: string | null): void;
  ttsStop(): void;
  ttsNext(): void;
  onTtsSentence(cb: (s: { text: string; cfi: string | null }) => void): () => void;
}

export function TtsBar({ bridge, speech, rate, onRateChange, bookLang, currentCfi, onStart, follow, onFollowChange }: {
  bridge: TtsBridge;
  speech: SpeechService;
  rate: number;
  onRateChange(rate: number): void;
  bookLang: string | null;
  currentCfi(): string | null;
  onStart(): void;
  follow: boolean;
  onFollowChange(follow: boolean): void;
}) {
  const { t } = useTranslation();
  const [playing, setPlaying] = useState(false);
  const followRef = useRef(follow);
  followRef.current = follow;
  const rateRef = useRef(rate);
  rateRef.current = rate;

  useEffect(() => {
    const bcp = (l: string | null): string => (!l ? 'en-US' : l.length === 2 ? `${l}-${l.toUpperCase()}` : l);
    const off = bridge.onTtsSentence((s) => {
      if (s.text === '') {
        speech.stop();
        bridge.ttsStop();
        setPlaying(false);
        return;
      }
      if (followRef.current && s.cfi) bridge.goTo(s.cfi);
      speech.speak(s.text, { language: bcp(bookLang), rate: rateRef.current, onDone: () => bridge.ttsNext() });
    });
    return off;
  }, [bridge, speech, bookLang]);

  return (
    <View style={styles.root}>
      <Pressable
        accessibilityLabel={playing ? t('tts.pause') : t('tts.start')}
        onPress={() => {
          if (playing) { speech.pause(); return; }
          setPlaying(true);
          onStart();
        }}
      >
        <Text style={styles.glyph}>{playing ? '⏸' : '▶'}</Text>
      </Pressable>
      <Pressable accessibilityLabel={t('tts.stop')} onPress={() => { speech.stop(); bridge.ttsStop(); setPlaying(false); }}>
        <Text style={styles.glyph}>{'⏹'}</Text>
      </Pressable>
      <Text style={styles.rateLabel}>{t('tts.rate')}</Text>
      <Pressable accessibilityLabel="rate-" onPress={() => onRateChange(Math.max(0.5, Math.round((rate - 0.1) * 10) / 10))}>
        <Text>{'−'}</Text>
      </Pressable>
      <Text style={styles.rateValue}>{`${rate.toFixed(1)}×`}</Text>
      <Pressable accessibilityLabel="rate+" onPress={() => onRateChange(Math.min(2, Math.round((rate + 0.1) * 10) / 10))}>
        <Text>{'+'}</Text>
      </Pressable>
      <Pressable accessibilityLabel={t('tts.follow')} onPress={() => onFollowChange(!follow)}>
        <Text style={[styles.follow, follow && styles.followOn]}>{'⇥'}</Text>
      </Pressable>
    </View>
  );
}
```

ReaderScreen : bouton chrome `'♪'` → `ttsActive` ; quand actif, rendre `TtsBar` au-dessus de `bottomBar` avec `speech={speechService}` (instance module-level créée une fois : `const speechService = createExpoSpeechService(require('expo-speech'))` — ou import direct), `rate={settings.ttsRate}`, `onRateChange={(r) => { void update({ ttsRate: r }); }}`, `bookLang` = langue du livre (métadonnées — si absente des états ReaderScreen, passer `null`), `currentCfi` = dernier cfi connu (ReaderScreen n'a pas le cfi brut : utiliser `bridge.captureBookmark()` serait lourd — Ruling: passer `null` au `ttsStart` initial = lecture depuis la position courante de la vue ; `currentCfi` ne sert qu'au démarrage, `onStart={() => (bridge as ReaderBridge).ttsStart(null)}`), `follow` state local.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/features/reader/__tests__/TtsBar.test.tsx && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/reader/TtsBar.tsx src/features/reader/__tests__/TtsBar.test.tsx src/features/reader/ReaderScreen.tsx src/i18n/fr.ts src/i18n/en.ts
git commit -m "feat(reader): tts bar with native speech queue, rate control and follow toggle"
```

Clés i18n Task 15 — fr : `tts.start` « Lire à voix haute », `tts.stop` « Arrêter la lecture », `tts.pause` « Pause », `tts.resume` « Reprendre », `tts.rate` « Vitesse », `tts.follow` « Suivre la lecture » ; en : « Read aloud », « Stop reading », « Pause », « Resume », « Speed », « Follow along ».

---

### Task 16: Thème auto + luminosité

**Files:**
- Modify: `src/core/types.ts` (`ThemeName` += `'auto'`, `resolveTheme`)
- Modify: `src/features/settings/SettingsScreen.tsx` (chip Auto)
- Modify: `src/features/reader/TypographyPanel.tsx` (segment 4 positions + slider luminosité)
- Modify: `src/features/reader/ReaderScreen.tsx` (résolution thème à l'application + overlay luminosité)
- Modify: `src/features/reader/useReaderSession.ts` (applySettings résolu à l'ouverture)
- Test: `src/core/__tests__/resolveTheme.test.ts` (nouveau), TypographyPanel test complété

**Interfaces:**
- Consumes: `useColorScheme` (react-native), `ReaderSettings.brightness` (Task 13).
- Produces: `export type ThemeName = 'day' | 'sepia' | 'night' | 'auto'`; `export function resolveTheme(theme: ThemeName, system: 'light' | 'dark' | null): 'day' | 'sepia' | 'night'` (`auto` → dark ? night : day) ; ReaderScreen : overlay `View` noir plein écran `opacity={brightness / 100}` `pointerEvents="none"` au-dessus du WebView/sous le chrome ; `applySettings` re-émis quand `scheme` change ; TypographyPanel : segment `settings.theme.auto` (labelKey `settings.theme.auto`) + slider luminosité 0–70.

- [ ] **Step 1: Write the failing tests**

```ts
// src/core/__tests__/resolveTheme.test.ts
import { resolveTheme } from '../types';

describe('resolveTheme', () => {
  it('passes concrete themes through', () => {
    expect(resolveTheme('day', 'dark')).toBe('day');
    expect(resolveTheme('sepia', 'dark')).toBe('sepia');
    expect(resolveTheme('night', 'light')).toBe('night');
  });

  it('resolves auto from the system scheme', () => {
    expect(resolveTheme('auto', 'dark')).toBe('night');
    expect(resolveTheme('auto', 'light')).toBe('day');
    expect(resolveTheme('auto', null)).toBe('day');
  });
});
```

Compléter `TypographyPanel.test.tsx` :

```ts
it('emits brightness updates within the 0-70 range', async () => {
  // suivre le pattern du test existant « emits updated settings on theme change »
  // presser les pressables accessibilityLabel 'brightness+' jusqu'à la borne :
  // brightness 70 → nouveau press bloqué (valeur inchangée)
});

it('offers the auto theme segment', async () => {
  // presser 'settings.theme.auto' → onSettingsChange reçu avec theme: 'auto'
});
```

(Écrire les deux tests complets sur le modèle exact du test existant du fichier — mêmes helpers, mêmes assertions.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/core/__tests__/resolveTheme.test.ts src/features/reader/__tests__/TypographyPanel.test.tsx`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

`src/core/types.ts` :

```ts
export type ThemeName = 'day' | 'sepia' | 'night' | 'auto';

export function resolveTheme(theme: ThemeName, system: 'light' | 'dark' | null): 'day' | 'sepia' | 'night' {
  if (theme !== 'auto') return theme;
  return system === 'dark' ? 'night' : 'day';
}
```

`TypographyPanel` : `THEME_OPTIONS` += `{ value: 'auto', labelKey: 'settings.theme.auto' }` ; bloc luminosité après les marges (pattern `Stepper` existant : `Stepper label={t('reader.brightness')} value={settings.brightness} min={0} max={70} step={5} decimals={0} onChange={(v) => patch({ brightness: v })}`).

`SettingsScreen` : `THEMES` += `{ value: 'auto', labelKey: 'settings.theme.auto' }` (les onPress existants propagent `theme: 'auto'` tels quels aux deux stores — la résolution se fait au rendu).

`useReaderSession.ts` (ouverture) :

```ts
import { useColorScheme } from 'react-native';
import { resolveTheme } from '../../core/types';
// dans le hook :
const scheme = useColorScheme();
// ligne existante :
bridge.applySettings({ ...useReaderSettingsStore.getState().settings, theme: resolveTheme(useReaderSettingsStore.getState().settings.theme, scheme) });
```

(si `scheme` n'est pas accessible proprement à cet endroit, exposer un paramètre ou résoudre dans ReaderScreen via un effet — voir ci-dessous.)

`ReaderScreen.tsx` :

```tsx
import { useColorScheme } from 'react-native';
import { resolveTheme } from '../../core/types';

const scheme = useColorScheme();
// re-application quand le système bascule (auto)
useEffect(() => {
  if (state !== 'ready' || !bridge) return;
  (bridge as ReaderBridge).applySettings({ ...settings, theme: resolveTheme(settings.theme, scheme) });
}, [state, bridge, settings, scheme]);

// overlay luminosité : après EngineWebView, avant l'overlay des tap zones
{settings.brightness > 0 ? (
  <View pointerEvents="none" style={[styles.brightness, { opacity: settings.brightness / 100 }]} />
) : null}
// styles.brightness: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000' }
```

(thème du chrome : `themeTokens(settings.theme)` → `themeTokens(resolveTheme(settings.theme, scheme))` aux deux occurrences.)

- [ ] **Step 4: Run tests to verify it passes**

Run: `npx jest src/core/__tests__/resolveTheme.test.ts src/features/reader/__tests__/TypographyPanel.test.tsx && npm run typecheck`
Expected: PASS — le moteur garde son repli `theme: 'auto' → day` si jamais il recevait 'auto' directement (défensif) : le `cssFor` existant indexe `themes[s.theme]` — ajuster : `const t = themes[s.theme === 'auto' ? 'day' : s.theme];` et le mapping `Object.assign(container.style…)` pareil.

- [ ] **Step 5: Commit**

```bash
git add src/core/types.ts src/core/__tests__/resolveTheme.test.ts src/features/settings/SettingsScreen.tsx src/features/reader/TypographyPanel.tsx src/features/reader/ReaderScreen.tsx src/features/reader/useReaderSession.ts src/i18n/fr.ts src/i18n/en.ts
git commit -m "feat(reader): auto theme via system scheme and brightness overlay (0-70%)"
```

Clés i18n Task 16 — fr : `settings.theme.auto` « Auto », `reader.brightness` « Luminosité » ; en : « Auto », « Brightness ».

---

## Self-Review Summary

- **Spec coverage:** A (Tasks 1, 2, 5, 6, 7 + popover ReaderScreen 10), B (8, 9, 10 — signets V1 intacts), C (11, 12), D (13, 14, 15), E (13 [brightness setting], 16) — tout mappé ; hors-périmètre respecté (pas d'export, pas de dicos hors ligne, pas de PDF).
- **Deviations justifiées (à ledger):** (1) « Copier » via `execCommand('copy')` moteur — expo-clipboard interdit par les contraintes ; (2) traduction toujours dans la feuille (pas de traduction courte inline dans la bulle) — même capacité, UX simplifiée ; (3) `listByBook` trié par `created_at` — le tri CFI lexicographique n'est pas fiable ; (4) `%` de recherche = fraction de section approximative ; (5) TTS = section courante (pas de franchissement de section) ; (6) replay des surlignages piloté app (listByBook → addHighlight) + re-add relocate côté moteur.
- **APIs vérifiées** (node_modules, 2026-10-13) : `getCFI(index, range)`, `addAnnotation(annotation, remove?)` + `draw-annotation {draw, annotation, doc, range}`, `Overlayer.highlight`, `async *search({query})` yields `{progress}/{label, subitems}/{cfi, excerpt}/'done'`, `clearSearch()`, `TTS(doc, textWalker, highlight, granularity)` avec `next(paused)` → SSML|undefined + highlight(range), `textWalker` exporté, `load` porte `{doc, index}` — toutes les tâches moteur partent de ces signatures réelles, pas d'hypothèses.
- **Type consistency:** `SelectionRect`/`HighlightColor`/`Annotation` dans types.ts consommés par protocol/bridge/repos/panels ; `SelectionPayload`/`SearchResultPayload`/`TtsSentencePayload` alignés sur les unions protocole ; `LookupService` tel que consommé par DefinitionSheet via `useServices().lookup` ; `HighlightBridge`/`SearchBridge`/`TtsBridge` tranches structurelles du ReaderBridge réel (pattern `BookmarkCaptureBridge` V1).
- **Dépendances:** exactement une nouvelle (`expo-speech`, T13) — conforme aux contraintes globales.
