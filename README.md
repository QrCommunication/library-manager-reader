# Library Manager Reader

*Read this in [French (Français)](README.fr.md)*

Offline e-book reader for Android and iOS, built with [Expo](https://expo.dev) and React Native.

## About

Library Manager Reader lets you import, organize and read your e-books anywhere, with no network connection required. Version 1 is 100% offline; a later version will synchronize your library and reading progress with the [library-manager.com](https://library-manager.com) cloud.

## Features

- **Formats**: EPUB, MOBI / AZW3, CBZ / CBR (CBR is converted to CBZ at import; original files are never modified)
- **Library**: cover grid, search, sorting, import through the system document picker, per-file import results
- **Reading**: reflow rendering, tap zones for page turns, resume at last position, automatic progress saving
- **Navigation**: table of contents, bookmarks with excerpts
- **Typography**: font family (including Literata), size, line height, margins
- **Themes**: day / sepia / night, applied to the interface and book content
- **Languages**: French and English interface
- **Privacy-first storage**: local SQLite database, tombstone deletion with 30-day purge

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Expo SDK 57, React Native, TypeScript (strict) |
| Rendering engine | [foliate-js](https://github.com/johnfactotum/foliate-js) in a WebView |
| Storage | expo-sqlite, expo-file-system |
| UI state | zustand |
| i18n | i18next (fr / en) |

## Development

```bash
npm install
npm start          # Expo dev server
npm test           # unit + component tests
npm run test:db    # database integration tests (node:sqlite)
npm run typecheck  # TypeScript strict
npm run lint       # ESLint
```

A development seed is available in dev builds: long-press the empty-library message to import bundled sample books.

## Roadmap

- **V1 (this version)** — fully offline reading experience
- **V2** — synchronization with the library-manager.com cloud

## License

This project is licensed under the [GNU General Public License v3.0](LICENSE).
