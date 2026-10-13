# Features lecteur V1.x — Design (spécification)

Date : 2026-10-13 · Statut : validé par l'utilisateur (autonomie complète accordée) · Base : `docs/superpowers/specs/2026-10-13-library-manager-reader-design.md` (V1, mergée)

**Objectif :** porter l'application au niveau des fonctions indispensables d'un lecteur mobile : sélection de texte avec dictionnaire/traduction en ligne, surlignages et notes, recherche dans le livre, synthèse vocale, luminosité et thème automatique.

## Contraintes globales (héritées de la V1, amendées)

- Expo SDK 57, TypeScript strict (`strict` + `noUncheckedIndexedAccess`), i18next fr/en (parité testée, aucun texte en dur), epoch ms, UUID v7, tombstones purgés à 30 jours, commits conventionnels, PROTOCOL_VERSION inchangé (évolutions purement additives — moteur et app sont livrés ensemble).
- Dépendances natives autorisées : celles de la V1 **plus `expo-speech`** (Expo-official, nécessaire pour la TTS robuste — `speechSynthesis` n'est pas fiable dans l'Android WebView). Aucune autre nouveauté ; pas de dépendance JS nouvelle non plus.
- Les livres ne sont jamais modifiés ; la V1 reste hors ligne à l'exception des fonctions de lookup (A) qui dégradent proprement hors connexion.

---

## A — Sélection de texte + Dictionnaire / Traduction

**Parcours :** l'utilisateur sélectionne un mot ou un passage dans le lecteur → une bulle flottante native apparaît près de la sélection : le texte sélectionné + les actions **Définir · Traduire · Copier**. « Définir » ouvre une feuille inférieure avec les définitions (Wiktionary) ; « Traduire » affiche la traduction (LibreTranslate) — courte dans la bulle, longue dans la feuille ; « Copier » copie dans le presse-papiers système.

### Protocole (additif)

- Nouveau message app-ward `selectionChanged` : `{ text: string | null, rect: { x, y, width, height } | null, cfi: string | null, lang: string | null }`. Émis côté moteur sur `selectionchange` (debounce ~200 ms) ; sélection vide → `text: null`. `lang` = langue des métadonnées du livre ; `cfi` = position de la sélection (consommé par le surlignage, spec B).
- Côté RN : `bridge.onSelectionChanged(cb): () => void` (même pattern que `onProgress`).

### LookupService (`src/core/lookup/lookupService.ts`, fetch injectable)

- `define(word, lang): Promise<{ pos: string | null; glosses: string[] }[]>` — API REST Wiktionary `https://{édition}.wiktionary.org/api/rest_v1/page/definition/{mot}` ; chaîne d'éditions `[lang, 'en', 'fr']` dédupliquée ; sens du texte HTML nettoyé, tronqués à ~300 caractères.
- `translate(text, source, target): Promise<string>` — POST `{url}/translate` JSON `{ q, source, target, format: 'text', api_key? }` → `translatedText`.
- Erreurs typées `LookupError { kind: 'offline' | 'not_found' | 'service_error' }` : rejet réseau → `offline` ; 404 → `not_found` ; autre → `service_error`.

### Langues (`src/core/lookup/languages.ts`)

Carte des ~45 langues souveraines européennes : code ISO 639-1 ↔ sous-domaine Wiktionary ↔ libellés fr/en. Source de traduction = langue du livre (métadonnées), repli `'en'` si absente ; cible = langue de l'interface.

### UI

- `SelectionPopover` (vue RN absolue dans l'overlay du ReaderScreen) positionnée sur le rect converti en coordonnées écran, clampé aux bords ; disparaît sur sélection vide, changement de page, toggle du chrome.
- `DefinitionSheet` (pattern ImportResultsSheet) : liste des sens, bouton « Traduire » en pied, états chargement / `lookup.offline` / `lookup.notFound` / `lookup.serviceError` via i18n.

### Réglages

Deux lignes : **URL du service LibreTranslate** (défaut `https://libretranslate.com`) et **clé API optionnelle**, persistées dans `uiPrefs` (JSON avec défauts — pas de migration).

---

## B — Surlignages et notes

**Parcours :** depuis la bulle de sélection, action **Surligner** + choix d'une couleur (jaune, vert, bleu, rouge) → le passage est surligné dans le contenu et persisté. Les annotations se listent dans un panneau (même mécanique que les signets) : tap → navigation au surlignage, édition de note, changement de couleur, suppression (tombstone).

- **Overlayer :** foliate-js dessine les surlignages ; messages additifs app→moteur `addHighlight { id, cfi, color }` et `removeHighlight { id }` ; le moteur les rejoue à l'ouverture du livre. Le CFI de l'annotation est fourni par le moteur dans `selectionChanged` (champ `cfi` ajouté).
- **DB — migration v2 :** table `annotations` (id UUID v7 PK, book_id FK ON DELETE CASCADE, cfi TEXT NOT NULL, color TEXT NOT NULL, note TEXT, excerpt TEXT NOT NULL, created_at/updated_at INTEGER, deleted_at INTEGER NULL, tombstone).
- **Repo :** `annotationsRepo` — `add`, `listByBook` (hors tombstones, tri par position), `setNote`, `setColor`, `markDeleted`, `purgeDeletedBefore` (30 jours, appelé au démarrage comme les livres).
- **UI :** `AnnotationsPanel` (bottom drawer du haut du lecteur) ; édition de note dans la feuille de l'annotation.
- **Signets :** la fonction existante (BookmarksPanel V1) est conservée telle quelle — aucun travail nouveau.

## C — Recherche dans le livre

- Protocole : app→moteur `search { query }` / `searchCancel {}` ; moteur→app `searchResult { cfi, excerpt, fraction }` (itératif, plafonné à 200 résultats) puis `searchDone { count }`.
- UI : champ de recherche dans un panneau du lecteur ; liste de résultats (extrait + %) ; tap → navigation.
- La recherche utilise le module `search` de foliate-js ; requête annulable (nouvelle recherche ou fermeture du panneau).

## D — Synthèse vocale (TTS)

- Dépendance ajoutée : `expo-speech` (npx expo install).
- Protocole : app→moteur `ttsStart { cfi? }` / `ttsStop {}` ; moteur→app `ttsSentence { text, cfi }` (découpage par phrase via le module `tts` de foliate-js), émis séquentiellement ; le moteur attend `ttsNext` du RN pour émettre la phrase suivante (contrôle du rythme côté natif).
- RN : file d'attente `expo-speech` (voix alignée sur la langue du livre, débit réglable 0,5–2,0), barre mini-contrôle en bas du lecteur (lecture/pause/stop + vitesse), surbrillance optionnelle de la phrase courante via `goTo(cfi)`.

## E — Luminosité et thème automatique

- **Luminosité :** overlay noir transparent dans le lecteur, curseur 0–70 % dans le panneau typographie (réglage lecteur persisté).
- **Thème auto :** `readerSettings.theme` accepte `'auto'` en plus de `day/sepia/night` → résolu au rendu selon le mode système (`useColorScheme`) : sombre → night, clair → day. Segmented control à 4 positions.

---

## Hors périmètre (YAGNI)

Export d'annotations, sous-linguistiques (dialectes), dictionnaires hors ligne, modèles de traduction embarqués, PDF, synchronisation cloud (V2), lecture en position paysage dédiée.

## Tests

TDD sur chaque couche : parsing Wiktionary + mapping d'erreurs + chaîne d'éditions (fetch mocké), traduction (happy path + clé API + erreurs), abonnement bridge `selectionChanged`, repo annotations (node:sqlite, tombstones, purge, cascade), composants (bulle, feuille de définitions, panneau d'annotations avec services injectés, panneau recherche, barre TTS avec service vocal injecté), réglages (persistance des nouvelles lignes), parité i18n étendue. Bundle moteur reconstruit après chaque changement moteur (le CI vérifie la fraîcheur).

## Vérification finale

Portes automatisées (typecheck, lint, tests, test:db, expo-doctor) + revue de branche complète + recette manuelle documentée dans la PR (sélection réelle dans le WebView, rendu des surlignages, voix TTS, instances publiques Wiktionary/LibreTranslate).
