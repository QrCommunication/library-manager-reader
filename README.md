# Library Manager Reader

*Read this in [French (Français)](README.fr.md)*

E-book reader for Android and iOS, built with [Expo](https://expo.dev) and React Native. The library and reading work entirely offline, and an optional link to [library-manager.com](https://library-manager.com) and KOReader keeps positions in sync across devices.

**Current version: 0.6.5** · package / bundle ID `com.librarymanager.reader` · license GPL-3.0

## Contents

- [Features](#features)
- [Reading-progress synchronization](#reading-progress-synchronization)
- [Privacy and security](#privacy-and-security)
- [Version history](#version-history)
- [Tech stack](#tech-stack)
- [Development](#development)
- [Data storage](#data-storage)
- [License](#license)

## Features

### Library
- **Import** through the system document picker:
  - Formats: EPUB, MOBI, AZW3, CBZ and CBR. CBR is converted to CBZ at import; original files are never modified.
  - Per-file progress, and a results sheet that explains each failure (unsupported, not enough space, unreadable, duplicate…).
  - Free space is checked before the import starts.
- **Duplicate detection**: matches on the book identifier, otherwise on title and author.
- **Cover grid**:
  - Covers are extracted at import.
  - A **reading-progress bar with the percentage** sits at the bottom of each cover; it turns green once the book is finished.
  - Series books show a volume badge.
- **Sorting**: recent, recently added, title, series (by volume number). **Search** by title or author.
- **Series**: read from EPUB 3 and calibre metadata. A series sheet lists every series with its book count and filters the grid.
- **Metadata editing**:
  - Fields: title, author, series (with autocomplete) and volume.
  - Changes are **written back into the file** (EPUB OPF, CBZ `ComicInfo.xml`).
- **Bulk selection**: ZIP export or deletion of the selected books.
- **Trash**: deleted books are kept for 30 days and can be restored or purged.
- **Export**:
  - A single book, renamed `Author - Title.ext`.
  - A selection or the whole library as a ZIP that includes KOReader sidecars (`.sdr/metadata.*.lua`).
  - The destination folder is picked through the Android Storage Access Framework.

### Reader
- **Engine**: [foliate-js](https://github.com/johnfactotum/foliate-js) in a WebView. Renders EPUB, MOBI, AZW3 and CBZ, with reflow pagination.
- **Resume**: reopens at the exact last position; progress is saved automatically.
- **Tap zones**:
  - Left and right thirds: previous and next page.
  - Center: shows or hides the controls (immersive mode).
  - Top-center strip: opens the reading settings.
- **Navigation**: table of contents, progress slider, bookmarks with excerpts.
- **Typography**:
  - 6 fonts, all embedded: Serif, Sans, Literata, Lexend, Atkinson Hyperlegible, OpenDyslexic.
  - Size 10–40 px, line height 1.2–2.2, margins 0–64 px.
  - Brightness dimming.
  - **Concentration mode** (bionic reading).
- **Themes**: day, sepia, night, and **auto** (follows the system dark mode, even while reading).
- **Highlights and notes**: 4 colors, an annotations list, jump to each one.
- **Selection menu**:
  - Wiktionary **definition**, in 45 languages.
  - **Translation** through LibreTranslate, into 8 target languages.
  - Copy and highlight.
- **In-book search**: streamed results with excerpts and position.
- **Text-to-speech**:
  - Reads sentence by sentence, in the book's language.
  - Speed 0.5–2×, with "follow along" page tracking.
- **Adaptive layouts**: phones, foldables (cover and inner screens) and tablets, in portrait and landscape.

### Cloud and interoperability
- **library-manager.com**:
  - OAuth sign-in (PKCE S256, public client).
  - Browse spaces and their catalogue, with server-side search and a series filter.
  - **Download** books (bulk downloads supported) through signed URLs, verified by SHA-256.
  - **Upload** EPUB, MOBI and AZW3 books.
  - Cached version covers (conditional ETag).
  - **Two-way reading-progress sync** (see below).
- **KOReader**:
  - Sync with a kosync server (`sync.koreader.rocks` or self-hosted), using the KOReader partial-MD5 document key.
  - Import and export of `.sdr` sidecars.

### Interface
- French and English, with automatic or forced language.
- Themed dialogs and notifications.
- Accessibility labels, roles and states on the controls.

## Reading-progress synchronization

The app follows the **KOReader** position contract shared with Library Manager (web, mobile, kosync).

- **Position format**:
  - `progress` is a CREngine/KOReader **XPointer**, such as `/body/DocFragment[2]/body/p[3]/text()[1].42`.
  - `percentage` is a fraction from 0 to 1.
  - Offsets count Unicode code points of the text after CREngine's whitespace normalization; the conversion was checked against the `koreader/crengine` sources.
  - The app never derives a position from the percentage alone.
- **Byte-exact copies only**:
  - An XPointer is exchanged only when the local file is byte-identical to the server version: a SHA-256-verified download, or an upload whose ready version is that same file.
  - A book matched only by title and author shares just the percentage.
- **Durable journal**:
  - Each operation is saved in SQLite before it is sent, then frozen at its first send.
  - After a lost response, the **same** operation is sent again, and the server returns its stored receipt.
  - Only one operation per book is in flight at a time.
  - Operations older than the 30-day replay window are held for explicit reconciliation.
- **Revision-based reconciliation**, at open, on return to the foreground and during bulk sync:

  | Who moved? | What happens |
  |---|---|
  | Only the server | Fast-forward to the server position |
  | Only this device | Push the local position |
  | Both | **Explicit choice** |

  Neither a phone clock nor a "maximum percentage" ever decides. Moving backward is a valid position.
- **Conflict dialog**:
  - Shows both positions with their versions and dates.
  - **Server**: the server position is applied.
  - **Local**: a new operation is sent on the re-read revision, and the question comes back if another device wrote in the meantime.
  - **Later**: sync for that book stays paused.
- **kosync**: diverging positions are also resolved by an explicit choice.

## Privacy and security

- **Library and reading work fully offline.** The network is used only for:
  - **Wiktionary**: the word being looked up is sent.
  - **Translation**: the selected text is sent to the configured LibreTranslate server (default `translate.rlconseil.net`).
  - **library-manager.com** and **KOReader**: only when signed in.
- Library Manager tokens and PKCE secrets are stored only in the Keychain / Keystore (`expo-secure-store`) and never written to logs.
- Signed transfer URLs never receive the account bearer token.
- For kosync, only the MD5 of the password is stored, as KOReader does.
- Cloud books are never opened remotely: they are copied, verified, then read from the local file.

## Version history

Each version is tagged `vX.Y.Z` and published as a [GitHub release](https://github.com/QrCommunication/library-manager-reader/releases) with the EAS builds (`.apk` for direct install, `.aab` for Google Play).

| Version | versionCode | Highlights |
|---|---|---|
| **0.6.5** | 65 | **KOReader** reading contract (CREngine XPointer + percentage); exact-replay journal and explicit conflicts (DB v6); re-read at open and on return to the foreground; kosync with explicit choice; progress bar on covers; local-copy confirmation after an exact upload |
| 0.6.0+ | 60 | Server-fed series autocomplete, bulk selection in the cloud catalogue, series filter fix and loaded/total count |
| **0.6.0** | 60 | Live two-way progress sync with an offline journal; themed dialogs and notifications everywhere; cloud sheet tools; redesigned settings |
| **0.5.0** | 50 | Library Manager mobile API (PKCE, spaces, revisions, transfers), tokens in the Keychain, in-app sign-in, remote book grid, downloads and uploads, cloud covers |
| 0.2.x | 20–23 | App icons and identity; KOReader (sidecars, partial MD5, kosync); progress in the grid; metadata written into files; ZIP export with sidecars; reorganized settings |
| **0.1.0** | 10 | Adaptive layouts; search, TTS, auto theme, brightness, highlights and notes, dictionary and translation; 6 fonts and concentration mode; series; trash; duplicate detection |
| MVP | — | Import, library, reader, bookmarks, typography, themes, i18n, SQLite |

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Expo SDK 57, React Native 0.86, React 19.2, TypeScript 6 (strict) |
| Navigation | expo-router (typed routes) |
| Reading engine | foliate-js 1.0.1 (patched) in a WebView, bundled with esbuild |
| Formats | fflate (ZIP), node-unrar-js (WASM, CBR) |
| Storage | expo-sqlite, expo-file-system, expo-secure-store |
| State | zustand |
| i18n | i18next / react-i18next (fr / en) |
| Text-to-speech | expo-speech |
| Tests | Jest (jest-expo), Testing Library, node:sqlite, Maestro (E2E smoke) |
| CI | GitHub Actions: engine bundle freshness, typecheck, lint, tests, expo-doctor |
| Builds | EAS: `development`, `preview`, `production` (AAB), `production-apk` |

`patches/foliate-js+1.0.1.patch` removes the iframe `sandbox` attribute, which crashes Android WebView renderers when it is embedded in an opaque-origin document.

## Development

```bash
npm install          # also applies patch-package
npm start            # Expo dev server (dev client)
npm test             # unit and component tests
npm run test:db      # SQLite integration tests (node:sqlite)
npm run typecheck    # strict TypeScript
npm run lint         # ESLint
npm run build:engine # rebuild src/engine/engineHtml.ts (committed, checked in CI)
```

- Any change under `src/engine/` requires `npm run build:engine`. The generated bundle is committed and CI checks that it is up to date.
- In a dev build, long-pressing the empty-library message imports the bundled sample books.

## Data storage

- **SQLite** (schema v6, transactional migrations). Tables: `books`, `reading_progress` (cfi, XPointer, fraction), `bookmarks`, `annotations`, `settings`, `remote_books` (cloud identity, revision, exact copy), `progress_journal` (sync journal).
- **Files**: `books/<id>.<ext>`, `covers/<id>.jpg`, plus a cache of cloud covers.
- **Secrets**: Keychain / Keystore.

## License

This project is licensed under the [GNU General Public License v3.0](LICENSE). The bundled fonts are under the SIL Open Font License.
