# Avidité — Notes pour Claude

Roguelike "push your luck" en 3D première personne (Three.js). Dé du Jugement
qui rétrécit chaque tour, salles procédurales avec 8 chemins/portes, 3 PNJ
marchands, 8 zones visuelles distinctes.

**Séparé du monorepo JulGame le 2026-08-29** (voir git history du dépôt
`ruine` pour tout l'historique de développement d'origine) précisément pour
pouvoir sortir de la contrainte "scripts classiques uniquement, compatible
`file://`" que respectent les autres jeux JulGame. **Ce projet-ci n'a plus
cette contrainte** : il tourne toujours via le serveur local
(`preview_start` avec la config `avidite` de `.claude/launch.json`, port
5507), jamais via `file://` — donc les modules ES, `examples/jsm/*` de
Three.js (GLTFLoader, EffectComposer, RGBELoader...) et un vrai chargement
d'assets externes (une fois validés avec l'utilisateur) sont désormais
possibles.

## Objectif en cours : réalisme visuel

L'utilisateur souhaite un rendu nettement plus réaliste ("niveau Elden Ring,
ou un peu moins" — étant entendu, et explicitement discuté avec lui, qu'une
vraie parité AAA est hors de portée : ça vient d'assets sculptés/scannés par
des artistes professionnels et d'un moteur avec ray tracing, pas d'un
prototype procédural en navigateur, quel que soit le format). L'approche
retenue :
- Matériaux PBR (`MeshStandardMaterial`), ombres temps réel, tonemapping
  filmique, textures procédurales (bosses/rugosité, générées via canvas —
  toujours aucun fichier externe pour ça), reflets d'environnement
  (`PMREMGenerator`, cœur de Three.js) — tout ça ne nécessite PAS de modules
  ES, disponible même en scripts classiques.
- En plus, éventuellement, de vrais modèles 3D (glTF) si l'utilisateur valide
  une source gratuite/bien licenciée proposée — **ne jamais télécharger un
  fichier sans son accord explicite au préalable, et ne jamais deviner une
  URL d'asset au hasard**.

**Fait le 2026-08-29** : 7 fichiers CC0 Poly Haven téléchargés après validation
explicite de l'utilisateur, dans `assets/` — textures PBR `castle_brick_broken_06`
(murs+plafond) et `cobblestone_floor_08` (sol) toujours utilisées (voir
`loadPbrTextureSet()` dans `js/scene3d.js`), et une HDRI
`castle_zavelstein_cellar_1k.hdr` qui ne l'est PLUS : elle nécessitait
RGBELoader (module ES) chargé via un import map, donc une DEUXIÈME instance
de Three.js à côté du build classique ("Multiple instances of Three.js"),
et un lag sévère est apparu juste après — retirée par précaution (voir le
commentaire de `buildEnvironmentMap()`, qui utilise maintenant un dégradé
procédural à la place, une seule instance de Three.js, plus aucun module ES
dans le projet). Le fichier `.hdr` reste sur disque au cas où. Toute future
demande de nouveaux assets suit la même règle : proposer des pistes précises
(fichier + taille + licence), attendre l'accord, puis télécharger directement
(aucun besoin que l'utilisateur télécharge quoi que ce soit lui-même).

## Application de bureau (Electron) — vue vers Steam

**Demandé le 2026-09-02** : l'utilisateur veut à terme vendre Avidité sur
Steam, donc une vraie application à lancer (pas un onglet de navigateur),
avec un bouton pour quitter. Mis en place :
- `package.json` (racine) + `electron/main.js` + `electron/preload.js`.
  Node.js/npm installés sur la machine (`winget install OpenJS.NodeJS.LTS`),
  `electron` en devDependency (`npm install`, script `npm start`).
- `electron/main.js` fait tourner un petit serveur HTTP local (module `http`
  intégré à Node, port 5510 — distinct du 5507 du serveur de dev navigateur)
  qui sert `index.html`/`js/`/`assets/`/`style.css` **tels quels, sans
  aucune modification** ; la fenêtre Electron charge ce serveur via
  `http://127.0.0.1:5510/`, PAS via `file://` — évite tout écart de
  comportement (CORS, chargement d'assets) entre navigateur et appli
  empaquetée. Le jeu ne sait même pas qu'il tourne dans Electron, sauf pour
  le bouton Quitter ci-dessous.
- Bouton "Quitter le jeu" dans les Paramètres (`#btnQuit`, `js/game.js`) :
  cablé sur `window.electronAPI.quit()`, exposé par `electron/preload.js`
  via `contextBridge` (jamais d'accès Node direct depuis le jeu —
  `contextIsolation:true`). Ce global n'existe QUE dans l'appli Electron :
  le bouton reste caché dans un navigateur normal, sans aucun effet.
- `node_modules/` et `dist/` sont dans `.gitignore` — jamais commités.
  Après un clone frais : `npm install` (l'exécutable Electron lui-même se
  télécharge automatiquement au premier install, ~190 Mo).
- Testé : `npm start` ouvre bien une fenêtre native titrée "Avidité — Le Dé
  du Jugement", le contenu chargé (vérifié directement via le serveur
  127.0.0.1:5510) est identique au jeu navigateur, aucune erreur console.
  Le bouton Quitter lui-même n'a pas pu être testé par un clic réel dans
  cette session (fenêtre native hors de portée des outils de test
  disponibles) — son câblage suit un pattern Electron standard et éprouvé,
  mais un vrai clic par l'utilisateur reste la vérification ultime.
- **Pas encore fait** (étapes suivantes vers Steam, si/quand demandé) :
  icône d'application, configuration `electron-builder`/`electron-forge`
  pour produire un vrai `.exe` installable, page Steamworks, achievements
  Steam éventuels, etc. — tout ça n'a pas été abordé, seule l'étape "faire
  tourner le jeu dans une fenêtre native avec un bouton Quitter" l'a été.

## Fichiers

- `index.html` — page unique, tout le HTML/overlays.
- `style.css` — tout le style.
- `js/audio.js` — effets sonores synthétisés (Web Audio API, aucun fichier
  audio externe).
- `js/game.js` — économie, PNJ, zones, sauvegarde (`localStorage`).
- `js/scene3d.js` — rendu 3D, contrôles, collisions, portes, décor.

`game.js`/`scene3d.js`/`audio.js` restent des scripts classiques partageant
un scope global (`meta`/`run` accessibles comme identifiants bruts entre
fichiers, pas comme propriétés de `window` — sauf les quelques ponts
explicites `window.X = X`). Si de nouveaux modules ES sont ajoutés (loaders
Three.js), les faire cohabiter proprement avec ce scope classique plutôt que
de tout réécrire d'un coup.
