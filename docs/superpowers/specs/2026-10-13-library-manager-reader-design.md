# Library Manager Reader — Spécification de design (V1)

Date : 2026-10-13
Statut : validé avec le produit (design approuvé section par section)

## 1. Contexte et objectifs

Application mobile de lecture de livres électroniques (**e-reader**) pour **Android et iOS**, construite avec **Expo** (dernière version stable). La V1 est **100 % hors ligne**. À terme (V2), l'application se synchronisera avec le cloud de **library-manager.com** (domaine appartenant au produit, backend à créer) afin de : synchroniser ses livres, les retirer de l'appareil tout en conservant la possibilité de les re-télécharger à volonté.

Décisions structurantes validées :

| Décision | Choix |
|---|---|
| Formats supportés | EPUB, MOBI, AZW3, CBZ natifs ; CBR converti en CBZ à l'import (pas de PDF en V1) |
| Import V1 | Sélecteur de fichiers + dépôt par câble USB (copie vers Téléchargements puis import) |
| Fonctions de lecture V1 | Progression, sommaire, personnalisation typographique, marque-pages |
| Moteur de rendu | foliate-js dans une WebView (approche A) |
| Public | Grand public, distribution via stores, i18n fr/en dès la V1 |

## 2. Périmètre V1

### 2.1 Fonctionnalités

1. **Bibliothèque locale** : grille de couvertures, tri (récence de lecture, date d'ajout, titre), recherche locale (titre/auteur), métadonnées extraites automatiquement (titre, auteur, couverture, langue, éditeur, identifiant).
2. **Import** : sélecteur de fichiers multi-sélection (`.epub`, `.mobi`, `.azw3`, `.cbz`, `.cbr`). Le flux « câble USB » = l'utilisateur copie ses fichiers vers un dossier accessible (Téléchargements) puis les importe via le sélecteur. **CBR** : foliate-js ne lit pas RAR ; à l'import, un CBR est converti en CBZ (décompression via unrar-WASM dans la WebView headless, re-zip des mêmes images — sans perte) et le CBZ devient le fichier canonique ; le format d'origine est conservé dans `books.original_format`.
3. **Lecture** : rendu reflow (texte réadapté à l'écran) pour EPUB/MOBI/AZW3 ; rendu image pour CBZ/CBR. Navigation page à page, tap zones latérales, slider de progression.
4. **Progression** : position exacte (CFI) + fraction 0–1 sauvegardée en continu (throttlée) ; reprise automatique à l'ouverture ; pourcentage affiché.
5. **Sommaire** : table des matières native du livre, navigation directe par chapitre.
6. **Marque-pages** : poser/retirer des signets, liste avec extrait de texte, navigation vers un signet.
7. **Personnalisation de lecture** : taille de police, famille de police (2–4 choix), interligne, marges, thème clair / sépia / sombre. Appliquée au livre en cours et mémorisée globalement.
8. **Réglages** : langue d'interface (auto/fr/en), thème par défaut, stockage utilisé, à propos.
9. **Suppression** : suppression logique (tombstone) + suppression des fichiers.

### 2.2 Hors périmètre V1 (validé, à ne pas construire)

Synchro cloud et comptes library-manager.com, annotations/surlignages, recherche dans le livre, TTS, catalogues OPDS, PDF, DRM, dictionnaire/traduction, widgets, notifications. La V1 garantit seulement que ses choix d'architecture ne bloqueront pas ces évolutions (voir §10).

## 3. Stack technique

| Élément | Choix | Version |
|---|---|---|
| Framework | Expo (managed workflow, `expo prebuild` pour les builds) | SDK 57 stable (React Native 0.86, React 19.2) |
| Langage | TypeScript, mode strict | — |
| Navigation | Expo Router | incluse SDK 57 |
| Base locale | expo-sqlite | — |
| Fichiers | expo-file-system (API File/Directory) | — |
| Import | expo-document-picker | — |
| WebView | react-native-webview | — |
| Moteur de rendu | foliate-js (EPUB, MOBI, KF8/AZW3, FB2, CBZ) | dernière publiée |
| État UI | zustand | — |
| i18n | i18next + react-i18next + expo-localization | — |
| Tests | Jest + @testing-library/react-native ; Maestro (E2E smoke) | — |

Règle : pas de dépendance native supplémentaire en V1. Toute idée nécessitant du natif est soit retirée, soit encapsulée derrière une interface remplaçable.

## 4. Architecture générale

```
┌────────────────────────── Application Expo (SDK 57) ──────────────────────────┐
│                                                                               │
│  UI (React Native + Expo Router)          Moteur de rendu                     │
│  ├─ Bibliothèque (grille)                 ┌─────────────────────────┐         │
│  ├─ Lecteur (chrome superposé)            │  WebView                │         │
│  └─ Réglages                              │  └─ foliate-js          │         │
│            ▲                              │   EPUB/MOBI/AZW3/CBZ    │         │
│            │ pont JS (postMessage JSON)   └─────────────────────────┘         │
│  ┌─────────┴──────────┐                        ▲                               │
│  │ Cœur applicatif    │  octets du livre via BookTransport (base64 par lots) │
│  │ ├─ Dépôt SQLite    │                                                      │
│  │ ├─ Import/métadonnées                                                     │
│  │ ├─ Progression/signets                                                    │
│  │ └─ i18n fr/en                                                             │
│  └────────────────────┘                                                      │
│            │                                                                  │
│  expo-file-system : books/<uuid>.<ext> (originaux intacts),                   │
│                     covers/<uuid>.jpg (couvertures extraites)                 │
└───────────────────────────────────────────────────────────────────────────────┘
```

**Couches et responsabilités :**

- **UI** : écrans Expo Router, aucun accès direct SQLite/disque — passe par le cœur applicatif.
- **Cœur applicatif** : dépôts (repository) SQLite, service d'import, service de lecture, service i18n. C'est la seule couche qui connaît le schéma de données et le système de fichiers.
- **Moteur de rendu** : bundle JS (foliate-js + adaptateur) chargé dans une WebView. Ne connaît ni SQLite ni le système de fichiers natif : il reçoit les octets du livre et des ordres (ouvrir, naviguer, thèmes), émet des événements (progression, sommaire, signets, erreurs).
- **Pont** : protocole JSON `postMessage` bidirectionnel typé (union discriminée), versionné (`protocolVersion` dans le handshake) pour permettre l'évolution du moteur sans casser l'app.

### 4.1 BookTransport (transfert livre → WebView)

Interface unique :

```ts
interface BookTransport {
  send(book: { path: string; size: number }, onProgress: (p: number) => void): Promise<void>;
}
```

- **Implémentation V1** : lecture par morceaux (expo-file-system), encodage base64, envoi en lots via `postMessage`, réassemblage en `ArrayBuffer` côté WebView.
- Seuil : au-delà de ~100 Mo, avertissement à l'utilisateur (mémoire). Si la réalité des usages dépasse, remplacer l'implémentation par un serveur HTTP local natif — l'interface et le moteur ne changent pas.
- **Extraction de métadonnées** : WebView « headless » (non affichée) exécutant foliate-js sur le fichier importé → métadonnées + couverture, pour tous les formats via le même chemin de code.

## 5. Modèle de données (SQLite)

Conçu **sync-ready** : UUID en clé primaire, `updated_at` partout, `deleted_at` en tombstone. La V2 synchronisera par comparaison de timestamps sans migration destructrice.

```sql
CREATE TABLE books (
  id TEXT PRIMARY KEY,             -- UUID v7
  title TEXT NOT NULL,
  author TEXT,
  format TEXT NOT NULL,            -- format du fichier stocké : 'epub' | 'mobi' | 'azw3' | 'cbz'
  original_format TEXT,            -- format d'origine si converti à l'import (ex. 'cbr' → 'cbz')
  file_name TEXT NOT NULL,         -- nom dans books/, ex. 01HXX....epub
  file_size INTEGER NOT NULL,
  language TEXT,
  publisher TEXT,
  drm_identifier TEXT,             -- identifiant natif du livre (dc:identifier / MOBI)
  added_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,              -- tombstone
  last_read_at INTEGER
);

CREATE TABLE reading_progress (
  book_id TEXT PRIMARY KEY REFERENCES books(id),
  cfi TEXT,                        -- position exacte ; ancre image pour CBZ
  fraction REAL NOT NULL,          -- 0.0–1.0
  section_index INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE bookmarks (
  id TEXT PRIMARY KEY,             -- UUID v7
  book_id TEXT NOT NULL REFERENCES books(id),
  cfi TEXT NOT NULL,
  fraction REAL NOT NULL,
  preview_text TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,             -- JSON
  updated_at INTEGER NOT NULL
);
```

- Réglages de lecture (police, taille, interligne, marges, thème) stockés dans `settings` → synchronisables en V2.
- V1 : aucune référence à un compte serveur. La V2 ajoutera ses tables d'état de synchro par **migration additive** uniquement.
- Purge V1 : les lignes `deleted_at` de plus de 30 jours sont physiquement supprimées à l'allumage de l'app (les fichiers le sont déjà à la suppression).

## 6. Stockage des fichiers

```
<DocumentDirectory>/
  books/<uuid>.<ext>      ← fichier original conservé à l'identique (jamais modifié)
  covers/<uuid>.jpg       ← couverture extraite (JPEG, ~512 px max)
```

Le fichier original n'est jamais réécrit : condition nécessaire pour que la V2 synchronise des fichiers identiques à ceux de la liseuse/library-manager.com. Suppression d'un livre = suppression des deux fichiers + tombstone en base.

## 7. Flux détaillés

### 7.1 Import
1. Sélecteur multi-fichiers (types MIME/extensions V1).
2. Vérification espace libre ≥ taille du fichier + marge → sinon rejet avec message.
3. Copie → `books/<uuid>.<ext>` ; si `.cbr` : conversion en CBZ (unrar-WASM + re-zip, dans la WebView headless) puis stockage en `books/<uuid>.cbz` avec `original_format='cbr'`.
4. Extraction métadonnées + couverture via WebView headless → `covers/<uuid>.jpg`.
5. Insertion SQLite (`books`).
6. Échec à toute étape ⇒ fichiers créés supprimés, aucune ligne insérée, raison affichée ; les autres fichiers de la sélection continuent.

### 7.2 Lecture et progression
1. Ouverture : lecture `reading_progress` → envoi octets (BookTransport) → `open({ format, lastLocation: cfi, settings })` au moteur.
2. À chaque changement de page : événement moteur `{ type: 'progress', cfi, fraction, section }` → mise à jour `reading_progress` (throttle 1 s) + `books.last_read_at`.
3. Réglages typographiques : événement `{ type: 'settings', ... }` → CSS injecté, persistance immédiate dans `settings`.
4. Sommaire : émis par le moteur à l'ouverture, rendu par l'UI ; sélection = ordre `goTo(cfi)`.
5. Signets : ajout = `{ type: 'addBookmark' }` → le moteur renvoie cfi/fraction/extrait → insertion `bookmarks`. Suppression = tombstone + retrait de la liste.

### 7.3 Suppression
Confirmation UI → `books.deleted_at` + `bookmarks.deleted_at` (en masse) → suppression fichiers → la ligne reste en base (purge à 30 jours).

### 7.4 Erreurs

| Cas | Comportement |
|---|---|
| Format non reconnu / fichier corrompu à l'import | Rejet unitaire avec raison, import des autres fichiers poursuivi |
| Espace insuffisant | Rejet avant copie, message explicite |
| CBR non lisible (archive RAR exotic/protégée) à la conversion | Rejet unitaire avec raison, import des autres fichiers poursuivi |
| Fichier manquant à l'ouverture | Livre marqué « fichier manquant » (badge en bibliothèque), écran d'erreur avec Réessayer / Supprimer |
| Crash de la WebView | Rechargement automatique à la dernière position persistée |
| Pont : message inconnu | Ignoré + log (tolérance de version) |

## 8. Écrans (Expo Router)

| Route | Écran | Détails |
|---|---|---|
| `/(tabs)/library` | Bibliothèque (accueil) | Grille de couvertures ; tri (récence, ajout, titre) ; recherche titre/auteur ; bouton « Ajouter » ; menu long-pression : ouvrir, signets, informations, supprimer ; badge « fichier manquant » |
| `/book/[id]` | Lecteur | Plein écran ; tap centre ⇒ chrome (haut : titre/retour ; bas : % + slider) ; tap zones latérales ⇒ page ± ; panneaux : sommaire, signets, typographie |
| `/(tabs)/settings` | Réglages | Langue (auto/fr/en), thème par défaut, stockage utilisé, à propos |

Thèmes clair/sépia/sombre appliqués à l'UI ET au contenu (CSS injecté). Respect des zones sûres (notches).

## 9. i18n et accessibilité

- Langues V1 : **français, anglais**. Détection via expo-localization, repli anglais, changement manuel dans les réglages.
- Chaînes externalisées dès le premier écran (aucune chaîne codée en dur).
- Base accessibilité : cibles tactiles ≥ 44 pt, libellés d'accessibilité sur les icônes, contrastes des thèmes vérifiés.

## 10. Compatibilité V2 (contrat de conception, pas de code)

1. Fichiers originaux intacts + UUID v7 + `updated_at` + tombstones ⇒ la synchro library-manager.com pourra être « delta par timestamps » sans migration destructrice.
2. Le protocole du pont WebView est versionné ⇒ le moteur peut évoluer (recherche, TTS, annotations) indépendamment de l'app.
3. `reading_progress.cfi` est déjà la représentation portable de position utilisée par foliate-js ⇒ annotations V2 appuieront sur le même socle.
4. Toute dépendance native future (serveur local, TTS) s'insère derrière une interface (pattern BookTransport), jamais en dur dans les écrans.

## 11. Tests et recette

- **Unitaires (Jest)** : migrations/dépôts SQLite (création, tombstones, purge 30 j), modèle de progression (throttle, reprise), mapping réglages → CSS.
- **Intégration** : pont WebView simulé (handshake, progression, sommaire, signets, messages inconnus ignorés) ; import des fixtures EPUB/CBZ/CBR embarquées (petits fichiers de test générés, CBR vérifiant la conversion).
- **E2E (Maestro, smoke)** : importer → ouvrir → tourner 3 pages → poser un signet → fermer → rouvrir à la position.
- **Recette manuelle** : EPUB 2, EPUB 3, MOBI, AZW3, CBZ, CBR (via sa conversion CBZ) sur appareils réels Android + iOS ; les 3 thèmes ; rotation ; interruption/reprise.

## 12. Décisions ouvertes (à trancher avant les stores, non bloquantes pour le développement)

- Nom public de l'app et icône (proposition de travail : « Library Reader », bundle id `com.librarymanager.reader`).
- Comptes développeur Apple/Google, EAS Build pour les artefacts finaux.
- Choix précis des polices embarquées (2–4 familles libres : ex. Inter, Literata, OpenDyslexic).
