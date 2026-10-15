# Library Manager Reader

*Lire en [anglais (English)](README.md)*

Liseuse de livres numériques pour Android et iOS, construite avec [Expo](https://expo.dev) et React Native. La bibliothèque et la lecture fonctionnent entièrement hors ligne ; une liaison facultative avec [library-manager.com](https://library-manager.com) et KOReader synchronise la position de lecture entre appareils.

**Version actuelle : 0.6.0** · paquet / bundle ID `com.librarymanager.reader` · licence GPL-3.0

## Sommaire

- [Fonctionnalités](#fonctionnalités)
- [Synchronisation de la lecture](#synchronisation-de-la-lecture)
- [Confidentialité et sécurité](#confidentialité-et-sécurité)
- [Historique des versions](#historique-des-versions)
- [Stack technique](#stack-technique)
- [Développement](#développement)
- [Stockage des données](#stockage-des-données)
- [Licence](#licence)

## Fonctionnalités

### Bibliothèque
- **Import** par le sélecteur de documents du système :
  - Formats : EPUB, MOBI, AZW3, CBZ et CBR. Le CBR est converti en CBZ à l'import ; les fichiers d'origine ne sont jamais modifiés.
  - Progression fichier par fichier, et une feuille de résultats qui explique chaque échec (non pris en charge, espace insuffisant, illisible, doublon…).
  - L'espace libre est vérifié avant l'import.
- **Détection des doublons** : par l'identifiant du livre, sinon par titre et auteur.
- **Grille de couvertures** :
  - Couvertures extraites à l'import.
  - **Barre d'avancement avec le pourcentage** en bas de chaque couverture ; elle passe au vert une fois le livre terminé.
  - Badge de tome pour les livres d'une série.
- **Tri** : récents, ajoutés récemment, titre, série (par numéro de tome). **Recherche** par titre ou auteur.
- **Séries** : lues dans les métadonnées EPUB 3 et calibre. Une feuille liste chaque série avec son nombre de livres et filtre la grille.
- **Édition des métadonnées** :
  - Champs : titre, auteur, série (avec autocomplétion) et tome.
  - Les modifications sont **écrites dans le fichier** (OPF de l'EPUB, `ComicInfo.xml` du CBZ).
- **Sélection multiple** : export ZIP ou suppression des livres sélectionnés.
- **Corbeille** : les livres supprimés sont conservés 30 jours, puis peuvent être restaurés ou purgés.
- **Export** :
  - Un livre seul, renommé `Auteur - Titre.ext`.
  - Une sélection ou toute la bibliothèque en ZIP, avec les sidecars KOReader (`.sdr/metadata.*.lua`).
  - Le dossier de destination se choisit via le Storage Access Framework d'Android.

### Lecteur
- **Moteur** : [foliate-js](https://github.com/johnfactotum/foliate-js) dans une WebView. Affiche EPUB, MOBI, AZW3 et CBZ, avec une mise en page refluable.
- **Reprise** : rouvre à la dernière position exacte ; la progression est sauvegardée automatiquement.
- **Zones de tap** :
  - Tiers gauche et droit : page précédente et suivante.
  - Centre : affiche ou masque les commandes (mode immersif).
  - Bande en haut au centre : ouvre les réglages de lecture.
- **Navigation** : table des matières, curseur de progression, signets avec extraits.
- **Typographie** :
  - 6 polices, toutes embarquées : Serif, Sans, Literata, Lexend, Atkinson Hyperlegible, OpenDyslexic.
  - Taille de 10 à 40 px, interligne de 1,2 à 2,2, marges de 0 à 64 px.
  - Atténuation de la luminosité.
  - **Mode concentration** (lecture « bionique »).
- **Thèmes** : jour, sépia, nuit et **automatique** (suit le mode sombre du système, y compris pendant la lecture).
- **Surlignages et notes** : 4 couleurs, liste des annotations, accès direct à chacune.
- **Menu de sélection** :
  - **Définition** Wiktionary, en 45 langues.
  - **Traduction** via LibreTranslate, vers 8 langues cibles.
  - Copier et surligner.
- **Recherche dans le livre** : résultats au fil de l'eau, avec extrait et position.
- **Lecture à voix haute** :
  - Phrase par phrase, dans la langue du livre.
  - Vitesse de 0,5 à 2×, la page suit la lecture.
- **Mises en page adaptatives** : téléphones, pliables (écran externe et interne) et tablettes, en portrait comme en paysage.

### Cloud et interopérabilité
- **library-manager.com** :
  - Connexion OAuth (PKCE S256, client public).
  - Parcours des espaces et de leur catalogue, avec recherche côté serveur et filtre par série.
  - **Téléchargement** de livres (y compris en lot) via des URL signées, vérifiés par SHA-256.
  - **Envoi** de livres EPUB, MOBI et AZW3.
  - Couvertures des versions mises en cache (ETag conditionnel).
  - **Synchronisation de la lecture dans les deux sens** (voir plus bas).
- **KOReader** :
  - Synchronisation avec un serveur kosync (`sync.koreader.rocks` ou auto-hébergé), avec la clé de document « partial MD5 » de KOReader.
  - Import et export des sidecars `.sdr`.

### Interface
- Français et anglais, langue automatique ou imposée.
- Dialogues et notifications aux couleurs du thème.
- Libellés, rôles et états d'accessibilité sur les commandes.

## Synchronisation de la lecture

L'application suit le format de position **KOReader**, commun au web, au mobile et à kosync chez Library Manager.

- **Format de position** :
  - `progress` est un **XPointer** CREngine/KOReader, par exemple `/body/DocFragment[2]/body/p[3]/text()[1].42`.
  - `percentage` est une fraction comprise entre 0 et 1.
  - Les décalages comptent les points de code Unicode du texte après normalisation des espaces par CREngine ; la conversion a été vérifiée sur les sources `koreader/crengine`.
  - Aucune position n'est déduite du seul pourcentage.
- **Copies exactes uniquement** :
  - L'XPointer n'est échangé que si le fichier local est identique octet pour octet à la version serveur : téléchargement vérifié par SHA-256, ou envoi dont la version prête est ce même fichier.
  - Un livre seulement rapproché par titre et auteur ne partage que le pourcentage.
- **Journal durable** :
  - Chaque opération est enregistrée dans SQLite avant l'envoi, puis figée au premier envoi.
  - Après une réponse perdue, la **même** opération est renvoyée et le serveur rend son reçu.
  - Une seule opération par livre est en cours d'envoi à la fois.
  - Au-delà de la fenêtre de rejeu de 30 jours, l'opération attend une réconciliation explicite.
- **Réconciliation par révision**, à l'ouverture, au retour au premier plan et lors de la synchro en lot :

  | Qui a bougé ? | Résultat |
  |---|---|
  | Seulement le serveur | Avance jusqu'à la position du serveur |
  | Seulement cet appareil | Envoi de la position locale |
  | Les deux | **Choix explicite** |

  Ni l'horloge du téléphone ni un « pourcentage maximal » ne décident. Revenir en arrière est une position valide.
- **Dialogue de conflit** :
  - Affiche les deux positions avec leur version et leur date.
  - **Serveur** : la position du serveur est appliquée.
  - **Local** : une nouvelle opération est envoyée sur la révision relue ; la question revient si un autre appareil a écrit entre-temps.
  - **Plus tard** : la synchro de ce livre reste en pause.
- **kosync** : les positions divergentes passent aussi par un choix explicite.

## Confidentialité et sécurité

- **La bibliothèque et la lecture fonctionnent entièrement hors ligne.** Le réseau ne sert qu'à :
  - **Wiktionary** : le mot recherché est envoyé.
  - **Traduction** : le texte sélectionné est envoyé au serveur LibreTranslate configuré (par défaut `translate.rlconseil.net`).
  - **library-manager.com** et **KOReader** : uniquement si vous êtes connecté.
- Les jetons Library Manager et les secrets PKCE sont stockés uniquement dans le Trousseau / Keystore (`expo-secure-store`) et ne sont jamais écrits dans les journaux.
- Les URL de transfert signées ne reçoivent jamais le jeton du compte.
- Pour kosync, seul le MD5 du mot de passe est conservé, comme le fait KOReader.
- Les livres du cloud ne sont jamais ouverts à distance : ils sont copiés, vérifiés, puis lus depuis le fichier local.

## Historique des versions

Le dépôt n'a pas encore de tags. Les versions correspondent aux fusions `release/*` et aux changements de version dans `app.config.ts`.

| Version | versionCode | Principaux ajouts |
|---|---|---|
| **Non publiée** | — | Format de lecture **KOReader** (XPointer CREngine + pourcentage) ; journal à rejeu exact et conflits explicites (DB v6) ; relecture à l'ouverture et au retour au premier plan ; kosync avec choix explicite ; barre d'avancement sur les couvertures ; confirmation de la copie locale après un envoi identique |
| après 0.6.0 | 60 | Autocomplétion des séries fournie par le serveur, sélection multiple dans le catalogue cloud, correctif du filtre par série et compteur chargés/total |
| **0.6.0** | 60 | Synchro de lecture en direct dans les deux sens avec journal hors ligne ; dialogues et notifications harmonisés partout ; outils de la feuille cloud ; réglages repensés |
| **0.5.0** | 50 | API mobile Library Manager (PKCE, espaces, révisions, transferts), jetons dans le Trousseau, connexion dans l'application, grille des livres distants, téléchargements et envois, couvertures cloud |
| 0.2.x | 20–23 | Icônes et identité visuelle ; KOReader (sidecars, partial MD5, kosync) ; avancement dans la grille ; métadonnées écrites dans les fichiers ; export ZIP avec sidecars ; réglages réorganisés |
| **0.1.0** | 10 | Mises en page adaptatives ; recherche, lecture à voix haute, thème automatique, luminosité, surlignages et notes, dictionnaire et traduction ; 6 polices et mode concentration ; séries ; corbeille ; détection des doublons |
| MVP | — | Import, bibliothèque, lecteur, signets, typographie, thèmes, i18n, SQLite |

## Stack technique

| Couche | Technologie |
|---|---|
| Framework | Expo SDK 57, React Native 0.86, React 19.2, TypeScript 6 (strict) |
| Navigation | expo-router (routes typées) |
| Moteur de lecture | foliate-js 1.0.1 (patché) dans une WebView, empaqueté avec esbuild |
| Formats | fflate (ZIP), node-unrar-js (WASM, CBR) |
| Stockage | expo-sqlite, expo-file-system, expo-secure-store |
| État | zustand |
| i18n | i18next / react-i18next (fr / en) |
| Synthèse vocale | expo-speech |
| Tests | Jest (jest-expo), Testing Library, node:sqlite, Maestro (smoke E2E) |
| CI | GitHub Actions : fraîcheur du bundle moteur, typecheck, lint, tests, expo-doctor |
| Builds | EAS : `development`, `preview`, `production` (AAB), `production-apk` |

`patches/foliate-js+1.0.1.patch` retire l'attribut `sandbox` des iframes, qui fait planter les moteurs de rendu WebView Android lorsqu'il est intégré dans un document d'origine opaque.

## Développement

```bash
npm install          # applique aussi patch-package
npm start            # serveur Expo (dev client)
npm test             # tests unitaires et de composants
npm run test:db      # tests d'intégration SQLite (node:sqlite)
npm run typecheck    # TypeScript strict
npm run lint         # ESLint
npm run build:engine # régénère src/engine/engineHtml.ts (committé, vérifié en CI)
```

- Toute modification sous `src/engine/` exige `npm run build:engine`. Le bundle généré est committé et la CI vérifie qu'il est à jour.
- Dans un build de développement, un appui long sur le message de bibliothèque vide importe les livres d'exemple fournis.

## Stockage des données

- **SQLite** (schéma v6, migrations transactionnelles). Tables : `books`, `reading_progress` (cfi, XPointer, fraction), `bookmarks`, `annotations`, `settings`, `remote_books` (identité cloud, révision, copie exacte), `progress_journal` (journal de synchro).
- **Fichiers** : `books/<id>.<ext>`, `covers/<id>.jpg`, plus un cache des couvertures cloud.
- **Secrets** : Trousseau / Keystore.

## Licence

Ce projet est distribué sous la [licence publique générale GNU v3.0](LICENSE). Les polices embarquées sont sous licence SIL Open Font License.
