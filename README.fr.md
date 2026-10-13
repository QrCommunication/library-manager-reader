# Library Manager Reader

*Lisez ceci en [anglais (English)](README.md)*

Liseuse de livres numériques hors ligne pour Android et iOS, construite avec [Expo](https://expo.dev) et React Native.

## À propos

Library Manager Reader vous permet d'importer, d'organiser et de lire vos livres électroniques partout, sans aucune connexion réseau. La version 1 est 100 % hors ligne ; une version ultérieure synchronisera votre bibliothèque et votre progression de lecture avec le cloud [library-manager.com](https://library-manager.com).

## Fonctionnalités

- **Formats** : EPUB, MOBI / AZW3, CBZ / CBR (le CBR est converti en CBZ à l'import ; les fichiers originaux ne sont jamais modifiés)
- **Bibliothèque** : grille avec couvertures, recherche, tri, import via le sélecteur de documents du système, résultats d'import détaillés par fichier
- **Lecture** : rendu fluide, zones de tap pour tourner les pages, reprise à la dernière position, sauvegarde automatique de la progression
- **Navigation** : table des matières, marque-pages avec extraits
- **Typographie** : police (dont Literata), taille, interligne, marges
- **Thèmes** : jour / sépia / nuit, appliqués à l'interface et au contenu des livres
- **Langues** : interface en français et en anglais
- **Stockage respectueux de la vie privée** : base SQLite locale, suppression par jetons (tombstones) purgés après 30 jours

## Stack technique

| Couche | Technologie |
|---|---|
| Framework | Expo SDK 57, React Native, TypeScript (strict) |
| Moteur de rendu | [foliate-js](https://github.com/johnfactotum/foliate-js) dans une WebView |
| Stockage | expo-sqlite, expo-file-system |
| État UI | zustand |
| i18n | i18next (fr / en) |

## Développement

```bash
npm install
npm start          # serveur de développement Expo
npm test           # tests unitaires et composants
npm run test:db    # tests d'intégration base de données (node:sqlite)
npm run typecheck  # TypeScript strict
npm run lint       # ESLint
```

Un jeu de données de développement est disponible dans les builds dev : appuyez longuement sur le message « bibliothèque vide » pour importer des livres d'exemple fournis.

## Feuille de route

- **V1 (cette version)** — expérience de lecture entièrement hors ligne
- **V2** — synchronisation avec le cloud library-manager.com

## Licence

Ce projet est sous licence [GNU General Public License v3.0](LICENSE).
