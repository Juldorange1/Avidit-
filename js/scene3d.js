'use strict';

/* Scène 3D en script classique (pas de "type=module") : les modules ES ne se
   chargent pas de manière fiable en file://, donc tout ici — y compris les
   contrôles souris/clavier et les étiquettes — est écrit à la main avec le
   seul objet global THREE (chargé juste avant ce fichier).

   ---- PERFORMANCE ----
   Pas d'antialiasing, résolution de rendu plafonnée, géométries et matériaux
   PARTAGÉS (créés une fois, réutilisés partout — la salle est reconstruite à
   chaque tour), aucune allocation d'objet dans la boucle de déplacement,
   aucun décor/prop (voir plus bas — supprimé). Les ombres temps réel ont été
   ESSAYÉES puis ABANDONNÉES (2026-08-29) : même limitées à une lumière par
   salle, elles causaient un lag sévère (signalé explicitement par
   l'utilisateur), en grande partie parce que salle courante ET salle
   préchargée ont chacune leur propre lumière/géométrie en permanence — ça
   double tout coût par-salle. `renderer.shadowMap` reste désactivé ; ne pas
   le réactiver sans un vrai budget de perf (mesurer le FPS avant/après,
   pas seulement "aucune erreur console").

   ---- RÉALISME (2026-08-29, revu le même jour après un retour de lag) ----
   Matériaux PBR (`MeshStandardMaterial`, rugosité/métallique) partout au lieu
   de Lambert plat — ça, ce n'était PAS la cause du lag, gardé tel quel. Murs
   et plafond utilisent une vraie texture PBR (diffuse + normal + rugosité)
   téléchargée depuis Poly Haven (CC0, validée explicitement par l'utilisateur
   avant téléchargement — voir assets/textures/castle_brick_broken_06) ; le
   sol utilise une texture de dallage dédiée (cobblestone_floor_08) — léger
   écart assumé par rapport à la règle d'origine "murs/plafond/sol = même
   texture", plus réaliste maintenant que ce sont de vraies matières. Les 8
   zones restent distinctes en teintant ces mêmes textures avec la couleur de
   la zone (`MeshStandardMaterial.color` multiplie la texture). Reflets
   d'environnement PROCÉDURAUX (voir buildEnvironmentMap(), un simple
   dégradé de ciel passé au PMREMGenerator — cœur de Three.js, une seule
   instance de la librairie) plutôt que la vraie HDRI téléchargée : cette
   dernière nécessitait RGBELoader (module ES, donc une DEUXIÈME instance de
   Three.js à côté du build classique) et un lag sévère est apparu juste
   après son intégration — voir le commentaire détaillé sur
   buildEnvironmentMap() pour l'enquête. Tonemapping filmique (ACES) sur le
   renderer. Salles volontairement
   VIDES (plus de décor/props — jugés moches par l'utilisateur ET ils
   alourdissaient inutilement le rendu). Portes : voir buildDoor(), lattes +
   ferrures en relief pour un aspect plus travaillé, toujours sans texture
   dédiée (aucun fichier "bois" validé pour l'instant). Une vraie fidélité
   "Elden Ring" (assets scannés/sculptés par une équipe pro, ray tracing)
   reste hors de portée d'un prototype en navigateur — voir la conversation
   pour le détail de cet arbitrage, discuté avec l'utilisateur avant cette
   passe. */

/* ---- disposition des 8 portes : resserrées dans un arc de 160° (pas 360°),
   pour qu'on puisse toutes les voir en tournant la tête sans faire le tour. ---- */
const DOOR_ARC_HALF = 80;         // ± 80° = 160° au total
const DOOR_HALF_WIDTH = 8;        // tolérance angulaire pour "être devant cette porte"
const WALL_R = 4.4;               // rayon auquel un mur/porte fermée bloque le joueur
const DOOR_R = WALL_R + 0.25;     // portes et murs sur LE MÊME rayon : aucun écart radial entre eux
const DOOR_WIDTH = 1.0;
const DOOR_HEIGHT = 2.0;
const DOOR_THICKNESS = 0.12;
const DOOR_BAY_HALF_ANGLE = 9;    // demi-largeur angulaire réservée à chaque porte (battant + chambranle) ; le mur comble tout le reste, sans écart
const SWING_DURATION = 0.35;
const SWING_ANGLE = Math.PI * 0.55;
const DOOR_SWING_SPEED = SWING_ANGLE / SWING_DURATION; // rad/s — vitesse constante, ouverture ET fermeture

const ROOM_GAP = 3.5;              // distance porte -> centre de la salle suivante (pas de couloir : espace ouvert)
const HOLD_BACK = 0.8;             // marge de sécurité si la salle suivante n'est pas encore prête

// hauteur de plafond : TIRÉE AU HASARD une fois par salle (voir
// buildRoomInto()) entre ces deux bornes, pour une vraie variété d'une salle
// à l'autre ("il peut y avoir un plafond plus haut" — demandé explicitement)
// plutôt qu'une hauteur fixe partout. La valeur réellement utilisée par la
// salle courante/préchargée est suivie dans roomWallHeight/pendingWallHeight
// (déclarées plus bas), lue par tout ce qui construit une salle et par
// updateJump() pour le clamp de saut.
const WALL_HEIGHT_MIN = 3.0;       // assez haut pour qu'un saut à pleine détente (~0.99 unité) reste sous le plafond avec de la marge
const WALL_HEIGHT_MAX = 4.6;
const WALL_SEG_MAX_ANGLE = 26;     // subdivision max d'un pan de mur, pour suivre la courbe de la salle
const CEILING_R = 12;              // généreux : les plafonds de deux salles voisines se recouvrent toujours
const FLOOR_R = WALL_R + 0.3;      // sol intérieur, légèrement plus large que le rayon de collision

const MOVE_SPEED = 6.2;
const LOOK_SENS = 0.0022;
const TOUCH_LOOK_SENS = 0.0034; // glisser-pour-regarder tactile : deltas en px comme la souris, un peu plus sensible (pas de vrai accélérateur physique)
const PITCH_LIMIT = Math.PI / 2 - 0.02;
const EYE_HEIGHT = 1.65;
const GRAVITY = -20;
const JUMP_SPEED = 6.3;

// Pointer Lock (souris) n'existe pas sur la plupart des navigateurs mobiles
// (aucun support iOS Safari) — sur un appareil tactile, on ne DOIT jamais
// tenter requestPointerLock() (échouerait silencieusement ou pire) et on
// utilise un contrôle entièrement différent (joystick + glisser-regarder +
// boutons, voir setupTouchControls()). Détection au chargement, ne change
// jamais en cours de partie.
const isTouchDevice = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches)
  || (navigator.maxTouchPoints || 0) > 0
  || 'ontouchstart' in window;

const WORLD_R = 40; // rayon du sol extérieur visible brièvement pendant la traversée entre deux salles (aucun décor dessus)

const PATH_ORDER = ['mine', 'canal', 'anti', 'rejet', 'rajeun', 'skip', 'double', 'cashout'];
const DOOR_SLOTS = PATH_ORDER.map((id, i) => ({ id, angle: -DOOR_ARC_HALF + i * (2 * DOOR_ARC_HALF / (PATH_ORDER.length - 1)) }));

// exactement à l'opposé de "forward" (0°) : la porte par laquelle on vient
// d'entrer dans une salle est TOUJOURS ici, par construction (voir
// commitDoor : pendingRoomForward = la direction qu'on vient de suivre —
// donc "d'où on vient" est toujours à 180° de cette direction, dans la
// nouvelle salle). Voir buildEntryDoor()/buildBoundary().
const ENTRY_ANGLE = 180;

/* Emplacements fixes des 3 PNJ possibles, dans l'arc ARRIÈRE (hors de celui
   des 8 portes, ±DOOR_ARC_HALF) — jamais sur le chemin d'une porte. Seuls
   ceux effectivement présents cette salle (window.getCurrentNpcs()) sont
   construits. */
const NPC_SLOTS = [
  { id: 'npc1', angle: 140 },
  { id: 'npc2', angle: 180 },
  { id: 'npc3', angle: 220 },
];
const NPC_STAND_R = 2.2;
const DOOR_PREOPEN_DIST = 2.0; // le battant s'ouvre (son + animation) cette distance avant DOOR_R, pour qu'on le VOIE s'ouvrir devant soi au lieu de derrière la tête
const DOOR_CLOSE_HYSTERESIS = 0.5; // marge avant de refermer un battant qu'on vient de quitter, pour éviter un battement au pas de la frontière
const PLAYER_RADIUS = 0.3;     // rayon de collision du joueur contre le décor/les PNJ
const WALL_CLEARANCE = 0.25;   // marge entre la caméra et la surface intérieure du mur (le plan proche de la caméra est à 0.1 — sans cette marge, collé au mur, il pouvait passer DANS le mur et on voyait au travers)

/* ---- 8 zones : même géométrie de salle partout, mais palette de matériaux
   et ambiance (fond/brouillard) différentes. On change de zone (au hasard,
   jamais la même deux fois de suite) toutes les ROOMS_PER_ZONE salles — voir
   game.js. Les couleurs "wall" s'appliquent aux murs, au plafond ET à
   l'encadrement des portes (même matériau partout — plus de teinte
   "doorFrame" distincte, supprimée le 2026-08-29 : le mur autour des portes
   doit être identique au reste du mur, pas plus clair), "fog"/"bg" à
   l'ambiance générale de la salle. */
const ZONE_DEFS = [
  { wall: 0x6e6c64, fog: 0x2c2a26, bg: 0x201e1b },
  { wall: 0x8a5a34, fog: 0x4a3320, bg: 0x2e2015 },
  { wall: 0xe8dcb8, fog: 0x8a7548, bg: 0x6b5a38 },
  { wall: 0x453a5c, fog: 0x201a30, bg: 0x150f22 },
  { wall: 0x5a6b4a, fog: 0x2a3520, bg: 0x1c2416 },
  { wall: 0x2e6b6b, fog: 0x123030, bg: 0x0c2222 },
  { wall: 0x3a2622, fog: 0x200e0a, bg: 0x160907 },
  { wall: 0xd6ecf2, fog: 0xa9cdd9, bg: 0x8fb6c4 },
];

let renderer, scene, camera, clock;
const npcRaycaster = new THREE.Raycaster(); // clic direct sur un PNJ (viseur au centre de l'écran) — voir initThree()
let started = false;

let roomGroup, nextRoomGroup;
let labels = [];
let nextLabels = [];
let closedSlots = new Set();
let pendingClosedSlots = new Set();
let roomNpcSlots = [];      // [{id, worldPos}] pour la salle courante
let pendingNpcSlots = [];   // idem pour la salle préchargée
let roomObstacles = [];     // [{x,z,radius}] décor + PNJ de la salle courante (collision)
let pendingObstacles = [];  // idem pour la salle préchargée
// battants en cours d'animation dans la salle courante : slotId -> { hinge, target }
// target = -SWING_ANGLE (ouvert) ou 0 (fermé) ; updateDoorSwing() fait tendre
// hinge.rotation.y vers `target` à vitesse constante, dans les deux sens —
// permet à un battant de se refermer si le joueur s'en éloigne avant de le
// franchir (voir updateRoomMovement()).
let doorSwingTargets = new Map();
// coquille de salle (voir buildDoorStub) affichée derrière une porte pendant
// qu'elle est ouverte : slotId -> Object3D, créée/détruite avec l'entrée
// correspondante de doorSwingTargets (voir maybeTriggerDoorSwing/
// updateDoorSwing) — JAMAIS une par porte franchissable en même temps
// (bug corrigé le 2026-08-29 : construire une coquille — grande comme une
// vraie salle — pour CHAQUE porte franchissable en même temps en empilait
// plusieurs les unes sur les autres, largement chevauchantes vu leur taille
// face à l'écart angulaire entre portes ; on ne construit maintenant QUE
// celle de la porte réellement ouverte, au plus une à la fois).
let doorStubs = new Map();
// passe à true dès le premier commitDoor() réussi (une vraie porte
// franchie) — reste false tant qu'on est encore dans la toute première
// salle de la partie (voir buildRoomInto : seule cette salle-là n'a pas de
// porte d'entrée à afficher, même si elle est reconstruite sur place par une
// action qui ne fait pas changer de salle, ex. "ne rien faire").
let hasEnteredViaDoor = false;
let pendingZoneIdx = 0; // zone de la salle préchargée — appliqué (fond/brouillard) seulement à l'arrivée

// repère (origine + orientation) de la salle où se trouve le joueur
let roomOrigin, roomForward, roomRight;
// repère de la prochaine salle, précalculé dès qu'on pousse une porte
let pendingRoomOrigin, pendingRoomForward, pendingRoomRight;
// hauteur de plafond de la salle courante/préchargée — tirée au hasard une
// fois par salle dans buildRoomInto() (voir WALL_HEIGHT_MIN/MAX), suivie ici
// pour que updateJump() sache où est le VRAI plafond de la salle où on se
// trouve (le clamp de saut ne peut pas utiliser une constante fixe).
let roomWallHeight = WALL_HEIGHT_MIN;
let pendingWallHeight = WALL_HEIGHT_MIN;

let transitioning = false;
let transitionDir = null;
let doorPoint = null; // position (au sol) de la porte qu'on vient de pousser
let nextRoomReady = false;

let yaw = 0, pitch = 0;
let locked = false;
const heldCodes = new Set();

let velocityY = 0;
let heightOffset = 0;
let wasAirborne = false;    // pour ne jouer le son d'atterrissage qu'après un vrai saut/une vraie chute
let footstepTimer = 0;      // accumulateur : un pas toutes les FOOTSTEP_INTERVAL secondes en marchant
const FOOTSTEP_INTERVAL = 0.36;

// vecteurs "scratch" réutilisés chaque frame pour ne rien allouer dans la boucle
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _rel = new THREE.Vector3();
const _dir = new THREE.Vector3();

// géométries et matériaux partagés (créés une seule fois, jamais par salle)
let GEO = null;
let MAT = null;
// modèles 3D réels (glTF, CC0 Kenney — voir assets/models/), remplis par
// loadModels() une fois chargés. Reste `null` tant qu'ils ne le sont pas :
// tout le code qui les utilise (buildDoor/buildNpc/buildProps) a un repli
// procédural, pour ne jamais bloquer le jeu sur un chargement réseau.
let MODELS = null;

function initThree() {
  if (started) return;
  started = true;

  const container = document.getElementById('threeContainer');

  roomOrigin = new THREE.Vector3(0, 0, 0);
  roomForward = new THREE.Vector3(0, 0, -1);
  roomRight = rightFromForward(roomForward);
  pendingRoomOrigin = new THREE.Vector3();
  pendingRoomForward = new THREE.Vector3();
  pendingRoomRight = new THREE.Vector3();
  transitionDir = new THREE.Vector3();
  doorPoint = new THREE.Vector3();

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 220);
  camera.rotation.order = 'YXZ';
  camera.position.set(0, EYE_HEIGHT, 0);

  renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1));
  renderer.setSize(window.innerWidth, window.innerHeight);
  // ombres temps réel désactivées : testées en vrai (une lumière ombrée par
  // salle), résultat = lag sévère signalé par l'utilisateur — deux salles
  // (courante + préchargée) avaient chacune leur propre lumière ombrée en
  // permanence, en plus du coût des nombreux petits segments de mur
  // individuels à projeter. Le reste du travail "réalisme" (textures PBR,
  // reflets d'environnement, tonemapping) ne coûtait pas cher et reste actif.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('pointerlockchange', onPointerLockChange);
  document.addEventListener('pointerlockerror', onPointerLockError);

  container.addEventListener('click', () => {
    if (window.SFX) SFX.init(); // filet de sécurité : débloque l'audio même si le 1er clic (bouton "Entrer") n'a pas suffi
    const playArea = document.getElementById('playArea');
    if (playArea.hidden) return;
    if (isTouchDevice) {
      // pas de Pointer Lock sur tactile (voir isTouchDevice) : le premier
      // "tap" engage directement les contrôles tactiles, sans passer par le
      // navigateur — voir setupTouchControls()/updateTouchUIVisibility().
      engageTouchControls();
      return;
    }
    if (document.pointerLockElement !== renderer.domElement) {
      const p = renderer.domElement.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
    // un clic, une fois déjà verrouillé, ne fait plus rien d'autre : parler à
    // un PNJ ne se fait plus QUE par la touche dédiée (voir INTERACT_KEY) —
    // demandé explicitement ("le SEUL moyen d'interagir avec un PNJ est de
    // mettre la touche qui y est dédiée"), ni au clic, ni automatiquement en
    // s'approchant (voir INTERACT_KEY / le retrait de queueRoomNpcs()).
  });

  if (isTouchDevice) {
    const lockTitle = document.getElementById('lockPromptTitle');
    const lockHint = document.getElementById('lockPromptHint');
    if (lockTitle) lockTitle.textContent = (typeof t === 'function') ? t('lock.title.touch') : 'Touchez pour commencer';
    if (lockHint) lockHint.textContent = (typeof t === 'function') ? t('lock.hint.touch') : '';
    setupTouchControls(container);
  }

  buildSharedAssets();
  buildStaticScene();
  buildEnvironmentMap();
  loadModels();

  roomGroup = new THREE.Group();
  nextRoomGroup = new THREE.Group();
  scene.add(roomGroup, nextRoomGroup);

  clock = new THREE.Clock();
  renderer.setAnimationLoop(tick);
}

function onResize() {
  if (!renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function onPointerLockChange() {
  locked = document.pointerLockElement === renderer.domElement;
  const lockPrompt = document.getElementById('lockPrompt');
  const playArea = document.getElementById('playArea');
  if (lockPrompt) lockPrompt.hidden = locked || (playArea && playArea.hidden);
  if (!locked) heldCodes.clear();
}

function onPointerLockError() {
  locked = false;
}

function onMouseMove(e) {
  if (!locked) return;
  yaw -= e.movementX * LOOK_SENS;
  pitch -= e.movementY * LOOK_SENS;
  if (pitch > PITCH_LIMIT) pitch = PITCH_LIMIT;
  if (pitch < -PITCH_LIMIT) pitch = -PITCH_LIMIT;
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;
}

const INTERACT_KEY = 'KeyE'; // touche dédiée à l'interaction PNJ — voir tryInteractWithNpcUnderCrosshair()

function onKeyDown(e) {
  heldCodes.add(e.code);
  if (e.code === INTERACT_KEY && locked) tryInteractWithNpcUnderCrosshair();
}
function onKeyUp(e) { heldCodes.delete(e.code); }

/* Vise le centre de l'écran (le viseur) — si un PNJ s'y trouve, l'aborde.
   Seul déclencheur possible d'une interaction PNJ (voir INTERACT_KEY dans
   onKeyDown) : ni le clic, ni l'approche automatique — demandé
   explicitement. Peut être appelé autant de fois qu'on veut sur le même PNJ
   dans la même salle (talkToNpc() ne pose aucune limite ; seule l'offre
   gratuite d'un PNJ donné peut s'épuiser, gérée séparément côté game.js). */
function tryInteractWithNpcUnderCrosshair() {
  npcRaycaster.setFromCamera({ x: 0, y: 0 }, camera);
  const hits = npcRaycaster.intersectObjects(roomGroup.children, true);
  if (!hits.length) return;
  // seul le PREMIER objet touché compte (pas d'interaction "à travers" un
  // mur/une porte pour atteindre un PNJ derrière) — on remonte ses parents
  // jusqu'au groupe racine du PNJ (voir buildNpc) ; si ce n'en est pas un,
  // rien ne se passe.
  let o = hits[0].object;
  while (o && !o.userData.npcId) o = o.parent;
  if (o && typeof window.talkToNpc === 'function') window.talkToNpc(o.userData.npcId);
}

function isDown(dir) {
  // "meta" est déclarée avec `let` en haut de game.js : accessible ici en tant
  // qu'identifiant global partagé, mais PAS comme propriété de `window`.
  const bound = (typeof meta !== 'undefined' && meta.moveKeys) ? meta.moveKeys[dir] : null;
  if (bound && heldCodes.has(bound)) return true;
  // secours toujours actifs : flèches directionnelles + WASD/Espace physiques
  const fallback = {
    forward: ['ArrowUp', 'KeyW'],
    back: ['ArrowDown', 'KeyS'],
    left: ['ArrowLeft', 'KeyA'],
    right: ['ArrowRight', 'KeyD'],
    jump: ['Space'],
  }[dir] || [];
  return fallback.some(c => heldCodes.has(c));
}

/* ============================= CONTRÔLES TACTILES (téléphone/tablette) ============================= */
/* Aucun Pointer Lock sur tactile (voir isTouchDevice) : `locked` est piloté
   à la main ici (jamais via onPointerLockChange, qui ne se déclenchera
   jamais puisqu'on ne demande jamais le Pointer Lock sur ces appareils).
   Le mouvement RÉUTILISE `heldCodes` avec les mêmes codes de secours que le
   clavier (ArrowUp/Down/Left/Right, Space — voir isDown() ci-dessus) : zéro
   changement nécessaire dans updateRoomMovement()/updateGapMovement()/
   updateJump(), le joystick "appuie sur des touches virtuelles". */

const TOUCH_MOVE_CODES = { forward: 'ArrowUp', back: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
const OVERLAY_IDS = ['npcOverlay', 'rulesOverlay', 'settingsOverlay', 'statsOverlay'];

function anyOverlayVisible() {
  return OVERLAY_IDS.some(id => {
    const el = document.getElementById(id);
    return el && !el.hidden;
  });
}

function engageTouchControls() {
  if (locked) return;
  locked = true;
  const lockPrompt = document.getElementById('lockPrompt');
  if (lockPrompt) lockPrompt.hidden = true;
}

/* Referme les contrôles tactiles quand un overlay s'ouvre (PNJ/règles/
   paramètres/succès) — équivalent tactile de document.exitPointerLock()
   (appelé explicitement par talkToNpc() côté game.js pour le clavier/souris,
   voir onPointerLockChange). Sans ça, le joueur continuerait à marcher/
   regarder sous un panneau plein écran. Rappelée chaque frame depuis tick()
   via updateTouchUIVisibility(), pas seulement à l'ouverture, pour aussi
   réafficher les contrôles/relancer `locked` à la fermeture d'un overlay. */
function updateTouchUIVisibility() {
  if (!isTouchDevice) return;
  const overlayOpen = anyOverlayVisible();
  if (overlayOpen && locked) {
    locked = false;
    heldCodes.clear();
  }
  const el = document.getElementById('touchControls');
  if (!el) return;
  const shouldShow = locked && !overlayOpen;
  if (el.hidden === shouldShow) el.hidden = !shouldShow;
  const lockPrompt = document.getElementById('lockPrompt');
  if (lockPrompt) {
    const playArea = document.getElementById('playArea');
    lockPrompt.hidden = locked || overlayOpen || (playArea && playArea.hidden);
  }
}

/* Glisser-pour-regarder (tout le conteneur SAUF le joystick/les boutons, qui
   sont des FRÈRES du conteneur — pas des enfants — donc leurs propres
   gestionnaires tactiles ci-dessous ne remontent jamais jusqu'ici) + un
   joystick virtuel bas-gauche (mouvement) + deux boutons bas-droite (Sauter/
   Interagir). Un seul doigt suivi par zone à la fois (identifiant de
   `Touch.identifier`), pour rester correct si le joueur regarde ET marche en
   même temps avec deux doigts. */
function setupTouchControls(container) {
  let lookTouchId = null, lookLastX = 0, lookLastY = 0;
  container.addEventListener('touchstart', e => {
    if (!locked) return;
    const t0 = e.changedTouches[0];
    if (lookTouchId === null) {
      lookTouchId = t0.identifier;
      lookLastX = t0.clientX; lookLastY = t0.clientY;
    }
  }, { passive: true });
  container.addEventListener('touchmove', e => {
    if (lookTouchId === null) return;
    for (const touch of e.changedTouches) {
      if (touch.identifier !== lookTouchId) continue;
      const dx = touch.clientX - lookLastX, dy = touch.clientY - lookLastY;
      lookLastX = touch.clientX; lookLastY = touch.clientY;
      yaw -= dx * TOUCH_LOOK_SENS;
      pitch -= dy * TOUCH_LOOK_SENS;
      if (pitch > PITCH_LIMIT) pitch = PITCH_LIMIT;
      if (pitch < -PITCH_LIMIT) pitch = -PITCH_LIMIT;
      camera.rotation.y = yaw;
      camera.rotation.x = pitch;
    }
  }, { passive: true });
  const releaseLook = e => {
    for (const touch of e.changedTouches) if (touch.identifier === lookTouchId) lookTouchId = null;
  };
  container.addEventListener('touchend', releaseLook);
  container.addEventListener('touchcancel', releaseLook);

  const joystick = document.getElementById('touchJoystick');
  const knob = document.getElementById('touchJoystickKnob');
  let joyTouchId = null;

  function setMoveCode(dir, active) {
    if (active) heldCodes.add(TOUCH_MOVE_CODES[dir]);
    else heldCodes.delete(TOUCH_MOVE_CODES[dir]);
  }
  function updateJoystick(touch) {
    const rect = joystick.getBoundingClientRect();
    const maxR = rect.width / 2;
    let dx = touch.clientX - (rect.left + rect.width / 2);
    let dy = touch.clientY - (rect.top + rect.height / 2);
    const dist = Math.hypot(dx, dy);
    if (dist > maxR) { dx = (dx / dist) * maxR; dy = (dy / dist) * maxR; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const DEAD = 0.25;
    const nx = dx / maxR, ny = dy / maxR;
    setMoveCode('forward', ny < -DEAD);
    setMoveCode('back', ny > DEAD);
    setMoveCode('left', nx < -DEAD);
    setMoveCode('right', nx > DEAD);
  }
  function resetJoystick() {
    knob.style.transform = 'translate(0,0)';
    setMoveCode('forward', false); setMoveCode('back', false);
    setMoveCode('left', false); setMoveCode('right', false);
  }
  joystick.addEventListener('touchstart', e => {
    const touch = e.changedTouches[0];
    joyTouchId = touch.identifier;
    updateJoystick(touch);
  }, { passive: true });
  joystick.addEventListener('touchmove', e => {
    for (const touch of e.changedTouches) if (touch.identifier === joyTouchId) updateJoystick(touch);
  }, { passive: true });
  const releaseJoystick = e => {
    for (const touch of e.changedTouches) {
      if (touch.identifier === joyTouchId) { joyTouchId = null; resetJoystick(); }
    }
  };
  joystick.addEventListener('touchend', releaseJoystick);
  joystick.addEventListener('touchcancel', releaseJoystick);

  const jumpBtn = document.getElementById('touchJumpBtn');
  jumpBtn.addEventListener('touchstart', e => { e.preventDefault(); heldCodes.add('Space'); }, { passive: false });
  jumpBtn.addEventListener('touchend', () => heldCodes.delete('Space'));
  jumpBtn.addEventListener('touchcancel', () => heldCodes.delete('Space'));

  const interactBtn = document.getElementById('touchInteractBtn');
  interactBtn.addEventListener('touchstart', e => {
    e.preventDefault();
    if (locked) tryInteractWithNpcUnderCrosshair();
  }, { passive: false });
}

/* ============================= GÉOMÉTRIE UTILITAIRE ============================= */

function rightFromForward(forward) {
  // rotation de 90° (vers la droite) dans le plan XZ
  return new THREE.Vector3(-forward.z, 0, forward.x);
}

function dirFromLocalAngle(deg, forward, right) {
  const rad = (deg * Math.PI) / 180;
  return forward.clone().multiplyScalar(Math.cos(rad)).addScaledVector(right, Math.sin(rad));
}

function angleDiff(a, b) {
  return ((a - b) % 360 + 540) % 360 - 180;
}

function nearestDoorSlot(localAngle) {
  let best = null, bestDiff = Infinity;
  for (const slot of DOOR_SLOTS) {
    const diff = angleDiff(localAngle, slot.angle);
    if (Math.abs(diff) < Math.abs(bestDiff)) { bestDiff = diff; best = slot; }
  }
  return { slot: best, diff: bestDiff };
}

/* Groupe positionné au sol (y=0) et orienté vers `dir` : comme la cible du
   lookAt a elle aussi y=0, la rotation obtenue est TOUJOURS parfaitement
   verticale (aucun tilt), quelle que soit la hauteur des enfants qu'on y
   attache ensuite en coordonnées locales — plus robuste que positionner un
   mesh en hauteur puis appeler lookAt() dessus (source du bug de mur incliné). */
function orientedGroup(p, dir) {
  const g = new THREE.Group();
  g.position.set(p.x, 0, p.z);
  g.lookAt(g.position.clone().add(dir));
  return g;
}

const WALL_TEX_U_SIZE = 1.6; // largeur (en unités monde) d'une répétition de la texture de mur
const WALL_TEX_V_SIZE = 1.8; // hauteur idem

/* BoxGeometry mappe chaque face sur [0,1]×[0,1] quelle que soit sa taille
   réelle : en réutilisant GEO.unitBox (juste mis à l'échelle) pour des
   panneaux de mur de largeurs différentes, chaque panneau affiche la MÊME
   texture étirée/compressée différemment selon sa largeur — d'où l'effet
   "briques mal recollées" signalé (densité de motif incohérente d'un
   panneau à l'autre). Cette géométrie DÉDIÉE ré-échelonne les UV pour que la
   densité de texture reste constante quelle que soit la taille du panneau —
   au prix d'une géométrie par panneau (pas partagée) : marquée `disposable`
   pour que clearGroup() la libère à chaque salle plutôt que de fuir de la
   mémoire GPU au fil des transitions. */
function wallSegGeometry(width, height, depth) {
  const geo = new THREE.BoxGeometry(width, height, depth);
  const uv = geo.attributes.uv.array;
  for (let i = 0; i < uv.length; i += 2) {
    uv[i] *= width / WALL_TEX_U_SIZE;
    uv[i + 1] *= height / WALL_TEX_V_SIZE;
  }
  geo.attributes.uv.needsUpdate = true;
  geo.userData.disposable = true;
  return geo;
}

/* ============================= RESSOURCES PARTAGÉES (créées 1 seule fois) ============================= */

const TEX_LOADER = new THREE.TextureLoader();

/* Charge un jeu de textures PBR (diffuse/normal/rugosité, convention Poly
   Haven : diff_1k.jpg / nor_gl_1k.jpg / rough_1k.jpg) depuis un dossier local
   — API cœur de Three.js, aucun module ES requis pour ça. Répétée
   (RepeatWrapping) pour couvrir des murs/sols de taille variable. */
function loadPbrTextureSet(dir, repeatX, repeatY) {
  const map = TEX_LOADER.load(`${dir}/diff_1k.jpg`);
  const normalMap = TEX_LOADER.load(`${dir}/nor_gl_1k.jpg`);
  const roughnessMap = TEX_LOADER.load(`${dir}/rough_1k.jpg`);
  if ('colorSpace' in map) map.colorSpace = THREE.SRGBColorSpace; // seule la diffuse est en sRGB, pas les cartes normal/rugosité
  [map, normalMap, roughnessMap].forEach(t => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeatX, repeatY);
  });
  return { map, normalMap, roughnessMap };
}

/* Carte d'environnement PROCÉDURALE (dégradé de ciel simple) pour donner aux
   matériaux métalliques/dorés un reflet crédible, via PMREMGenerator — API
   cœur de Three.js, une seule instance de Three.js impliquée.
   ---- Pourquoi pas la vraie HDRI téléchargée (assets/hdri/) ----
   Une première version chargeait cette HDRI via RGBELoader — le seul module
   ES du projet (examples/jsm, résolu via un import map "three" pointant vers
   three.module.js, une DEUXIÈME instance de Three.js à côté du build
   classique déjà chargé). Ça affichait bien un warning "Multiple instances
   of Three.js being imported", et un lag sévère est apparu juste après cette
   passe (boucle de rendu qui s'arrête presque totalement, confirmé en testant
   le compteur `renderer.info.render.frame` : quasi figé sur plusieurs
   secondes, alors que la scène ne fait que ~4000 triangles/130 appels de
   dessin — aucune raison GPU à ça). Fortement suspecté : les deux instances
   de Three.js se marchent dessus quelque part dans le pipeline de textures/
   render targets du PMREMGenerator. Ça n'a jamais été prouvé formellement,
   mais vu le risque et que ce n'est qu'un aplat de reflets (pas essentiel au
   jeu), le plus sûr est d'éliminer l'unique point de mélange entre les deux
   builds plutôt que de continuer à enquêter dessus. Le fichier .hdr reste
   dans assets/ au cas où on voudrait retenter ça proprement plus tard
   (ex: en convertissant tout le projet en modules ES d'un coup, pas en
   mélangeant les deux). */
function buildEnvironmentMap() {
  const envScene = new THREE.Scene();
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      topColor: { value: new THREE.Color(0x9aa8b8) },
      bottomColor: { value: new THREE.Color(0x1a1512) },
    },
    vertexShader: `varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 vPos; uniform vec3 topColor; uniform vec3 bottomColor; void main(){ float h = normalize(vPos).y * 0.5 + 0.5; gl_FragColor = vec4(mix(bottomColor, topColor, h), 1.0); }`,
  });
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(40, 12, 12), skyMat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, 0.03).texture;
  pmrem.dispose();
  skyMat.dispose();
}

// noms de fichiers → clé dans MODELS (voir loadModels()). Regroupés par
// pack d'origine (town/dungeon/chars, chacun dans son propre sous-dossier) :
// chaque .glb Kenney référence sa texture via un chemin RELATIF
// (Textures/colormap.png) partagé par tout le pack — les mélanger dans un
// seul dossier aurait fait collisionner 3 colormap.png différents. Même
// principe pour les 3 PNJ Sketchfab (voir assets/models/sketchfab/
// LICENSE-sketchfab.txt, CC-BY-4.0, téléchargés par l'utilisateur — les
// anciens modèles Kenney jugés trop stylisés, pas assez distincts entre eux
// ni fidèles au rôle de chaque PNJ, remplacés) : un sous-dossier par PNJ.
const MODEL_FILES = {
  door: 'assets/models/town/door.glb',
  // npc1 ("gambler", assets/models/sketchfab/gambler/) VOLONTAIREMENT absent
  // d'ici : son squelette exporté est cassé (bind pose incohérente — testé en
  // détail : géométrie/textures/scale tous corrects, aucune erreur GL, mais
  // le maillage rigué se déforme hors de toute position sensée et reste
  // occulté par le décor). buildNpc() a déjà un repli procédural quand
  // MODELS[id] est absent (voir plus bas) — utilisé ici plutôt que
  // d'afficher un PNJ invisible/cassé. Les fichiers restent sur disque en
  // attendant un modèle de remplacement.
  npc2: 'assets/models/sketchfab/smith/scene.gltf',
  npc3: 'assets/models/sketchfab/noble/scene.gltf',
  // décor : Poly Haven (CC0, mêmes assets que les textures de murs/sol —
  // vrai PBR photoscanné, pas du low-poly stylisé) plutôt que Kenney, pour
  // rester visuellement cohérent avec les murs/sol ET pour un rendu bien
  // plus réaliste — signalé explicitement par l'utilisateur (l'ancien coffre
  // et le lampadaire Kenney, en plus d'être hors-sujet dans une pièce
  // fermée, juraient aussi avec le reste du rendu).
  propTable: 'assets/models/polyhaven/WoodenTable_01/WoodenTable_01_1k.gltf',
  propCabinet: 'assets/models/polyhaven/GothicCabinet_01/GothicCabinet_01_1k.gltf',
  propChandelier: 'assets/models/polyhaven/Chandelier_01/Chandelier_01_1k.gltf',
  // plante décorative (Poly Haven, CC0) — ambiance jugée trop austère/
  // "angoissante" avant, demandé explicitement d'ajouter des plantes/lianes.
  propPlant: 'assets/models/polyhaven/anthurium_botany_01/anthurium_botany_01_1k.gltf',
};

/* Charge les modèles 3D réels (glTF/.glb, CC0 Kenney — voir assets/models/ et
   LICENSE-kenney.txt — validés par l'utilisateur avant téléchargement). Même
   mécanisme que RGBELoader plus tôt dans le projet (module ES chargé
   dynamiquement via `import()`, voir l'import map "three" dans index.html) :
   le seul autre module ES du projet. Non bloquant — remplit MODELS quand
   c'est prêt ; tant que c'est `null`, portes/PNJ utilisent leur repli
   procédural (voir buildDoor()/buildNpc()) et le décor reste absent (voir
   buildProps()) — le jeu ne dépend donc jamais d'un temps de chargement
   réseau pour rester jouable, il s'améliore progressivement. */
let cloneSkeleton = null; // SkeletonUtils.clone, une fois chargé — voir loadModels()/buildNpc()

async function loadModels() {
  try {
    const [{ GLTFLoader }, SkeletonUtils] = await Promise.all([
      import('https://unpkg.com/three@0.155.0/examples/jsm/loaders/GLTFLoader.js'),
      import('https://unpkg.com/three@0.155.0/examples/jsm/utils/SkeletonUtils.js'),
    ]);
    cloneSkeleton = SkeletonUtils.clone;
    const loader = new GLTFLoader();
    const entries = await Promise.all(
      Object.entries(MODEL_FILES).map(([key, url]) => loader.loadAsync(url).then(gltf => [key, gltf.scene]))
    );
    MODELS = Object.fromEntries(entries);
  } catch (err) {
    console.warn('[avidite] modèles 3D non chargés, repli procédural :', err);
  }
}

function buildSharedAssets() {
  GEO = {
    door: new THREE.BoxGeometry(DOOR_WIDTH, DOOR_HEIGHT, DOOR_THICKNESS),
    ceiling: new THREE.CircleGeometry(CEILING_R, 20),
    floor: new THREE.CircleGeometry(FLOOR_R, 24),
    unitBox: new THREE.BoxGeometry(1, 1, 1),
    knob: new THREE.SphereGeometry(0.06, 8, 6),
    plantPot: new THREE.CylinderGeometry(0.16, 0.13, 0.22, 12), // pot en terre cuite, procédural — sous la plupart des plantes (voir buildProps)
    // ---- PNJ (personnage articulé : jambes/bras/torse/tête + accessoires) ----
    npcLimb: new THREE.CylinderGeometry(0.09, 0.11, 1, 6),
    npcTorso: new THREE.CylinderGeometry(0.24, 0.3, 0.75, 8),
    npcHead: new THREE.SphereGeometry(0.22, 12, 10),
    npcCone: new THREE.ConeGeometry(1, 1, 10),
    propSphereSmall: new THREE.SphereGeometry(0.2, 8, 6), // réutilisé par la bourse du PNJ3 (buildNpc)
    // ---- lueur des portes bonus (PNJ 2 / PNJ 3) ----
    glowOrb: new THREE.SphereGeometry(0.09, 8, 6),
  };

  // ---- textures PBR (Poly Haven, CC0, validées par l'utilisateur avant
  // téléchargement — voir assets/). Chargées une seule fois, réutilisées par
  // TOUTES les zones (chaque zone les teinte via `color`, voir plus bas). ----
  // repeat=(1,1) pour les murs : la densité de texture est désormais encodée
  // directement dans les UV de chaque panneau (voir wallSegGeometry), pas
  // dans un facteur de répétition global — sinon double application.
  const wallTex = loadPbrTextureSet('assets/textures/castle_brick_broken_06', 1, 1);
  const floorTex = loadPbrTextureSet('assets/textures/cobblestone_floor_08', 5, 5);
  // le plafond (CircleGeometry, UV en éventail radial — pas de panneaux
  // individuels à ré-échelonner comme les murs) a besoin de SON PROPRE
  // facteur de répétition ; comme `repeat` est une propriété de la TEXTURE
  // (partagée par tout ce qui l'utilise), on clone les 3 cartes plutôt que de
  // réutiliser directement celles des murs (sinon le plafond retéinterait la
  // répétition des murs, ou l'inverse). `.clone()` partage les données image
  // déjà décodées (pas de second téléchargement), coût négligeable.
  const ceilingTex = {
    map: wallTex.map.clone(),
    normalMap: wallTex.normalMap.clone(),
    roughnessMap: wallTex.roughnessMap.clone(),
  };
  Object.values(ceilingTex).forEach(t => { t.repeat.set(9, 9); t.needsUpdate = true; });

  // vraie texture PBR de porte en bois (Poly Haven, CC0 — même source que
  // murs/sol) : une photo de porte, pas un motif à répéter, donc repeat=(1,1)
  // pour la voir en entier sur un battant plutôt que morcelée.
  const doorTex = loadPbrTextureSet('assets/textures/rough_pine_door', 1, 1);

  MAT = {
    // couleur = teinte multipliée sur la texture (comme les murs/sol) : le
    // bois reste reconnaissable, la teinte encode toujours l'état du chemin.
    doorAction: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, map: doorTex.map, normalMap: doorTex.normalMap, roughnessMap: doorTex.roughnessMap }),
    doorSpecial: new THREE.MeshStandardMaterial({ color: 0xe8c168, roughness: 0.6, metalness: 0.2, map: doorTex.map, normalMap: doorTex.normalMap, roughnessMap: doorTex.roughnessMap }),
    doorBlocked: new THREE.MeshStandardMaterial({ color: 0xb35a45, roughness: 0.9, metalness: 0, map: doorTex.map, normalMap: doorTex.normalMap, roughnessMap: doorTex.roughnessMap }),
    doorSealed: new THREE.MeshStandardMaterial({ color: 0x6b6459, roughness: 0.95, metalness: 0, map: doorTex.map, normalMap: doorTex.normalMap, roughnessMap: doorTex.roughnessMap }),
    doorInset: new THREE.MeshStandardMaterial({ color: 0x2c2015, roughness: 0.88, metalness: 0 }),
    doorStrap: new THREE.MeshStandardMaterial({ color: 0x24211d, roughness: 0.4, metalness: 0.85 }),      // ferrures/renforts en fer, plus sombres et plus métalliques que le bois
    knob: new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.3, metalness: 0.9 }),
    plantPot: new THREE.MeshStandardMaterial({ color: 0xa8623f, roughness: 0.9, metalness: 0 }), // terre cuite
    ground: new THREE.MeshStandardMaterial({ color: 0x5c9a44, roughness: 1, metalness: 0 }),
    // portes à bonus PNJ (coût énergie réduit / or offert) : couleurs vives et
    // ÉMISSIVES (MeshBasicMaterial, non éclairées : elles restent lumineuses
    // même dans une zone sombre) pour être immédiatement reconnaissables.
    doorBonusEnergy: new THREE.MeshBasicMaterial({ color: 0x5be86a }),
    doorBonusGold: new THREE.MeshBasicMaterial({ color: 0xffd54a }),
    glowEnergy: new THREE.MeshBasicMaterial({ color: 0x8dffa0 }),
    glowGold: new THREE.MeshBasicMaterial({ color: 0xffe98a }),
    // ---- PNJ : couleur d'identité (vêtements) + accessoire propre à chacun ----
    npc1: new THREE.MeshStandardMaterial({ color: 0x5b3a86, roughness: 0.85, metalness: 0 }),        // Le Parieur : redingote violette
    npc1Accent: new THREE.MeshStandardMaterial({ color: 0x241a33, roughness: 0.85, metalness: 0 }),  // chapeau sombre
    npc2: new THREE.MeshStandardMaterial({ color: 0xb5502a, roughness: 0.6, metalness: 0.3 }),        // Le Forgeron : tenue cuivrée
    npc2Accent: new THREE.MeshStandardMaterial({ color: 0x3a2018, roughness: 0.9, metalness: 0 }),  // tablier de cuir sombre
    npc3: new THREE.MeshStandardMaterial({ color: 0xd6a63a, roughness: 0.5, metalness: 0.3 }),        // Le Changeur d'Or : robe dorée
    npc3Accent: new THREE.MeshStandardMaterial({ color: 0xf1e6a8, roughness: 0.7, metalness: 0 }),  // col/bourse crème
    npcSkin: new THREE.MeshStandardMaterial({ color: 0xdba871, roughness: 0.6, metalness: 0 }),
    // ---- zones : {wall (murs+plafond+encadrement de porte : même matériau
    // partout, voir le commentaire de ZONE_DEFS), floor}, une seule fois ----
    // les 8 zones partagent les MÊMES textures (wallTex/floorTex) : seule la
    // teinte (`color`) change, pour rester léger (aucune texture par zone).
    zones: ZONE_DEFS.map(z => ({
      wall: new THREE.MeshStandardMaterial({ color: z.wall, roughness: 0.9, metalness: 0, map: wallTex.map, normalMap: wallTex.normalMap, roughnessMap: wallTex.roughnessMap }),
      floor: new THREE.MeshStandardMaterial({ color: z.wall, roughness: 0.95, metalness: 0, map: floorTex.map, normalMap: floorTex.normalMap, roughnessMap: floorTex.roughnessMap }),
      ceiling: new THREE.MeshStandardMaterial({ color: z.wall, roughness: 0.9, metalness: 0, map: ceilingTex.map, normalMap: ceilingTex.normalMap, roughnessMap: ceilingTex.roughnessMap }),
    })),
  };

}

/* ============================= FOND (juste pour le bref passage à ciel ouvert entre deux portes) ============================= */

/* On reste toujours dans des pièces totalement closes (murs/plafond opaques,
   sans fenêtre) : aucun décor extérieur (végétation, arbres) n'est donc plus
   jamais visible — seul un sol nu sert de base pendant la courte traversée à
   l'air libre entre la porte et la salle suivante (voir ROOM_GAP). Couleur de
   fond/brouillard neutre au départ, immédiatement remplacée par celle de la
   zone de la toute première salle (voir applyZoneAtmosphere()). */
function buildStaticScene() {
  scene.background = new THREE.Color(0x201e1b);
  scene.fog = new THREE.Fog(0x201e1b, 8, 46);

  // ambiance douce : la vraie lumière de contraste vient de buildRoomLight()
  // (une lumière ombrée par salle) — une hémisphère trop forte l'écraserait.
  // salles plus lumineuses/agréables (signalé : "l'ambiance est trop
  // angoissante") — intensités relevées par rapport à la passe précédente.
  scene.add(new THREE.HemisphereLight(0xdcefff, 0x4c7a3a, 0.9));
  const sun = new THREE.DirectionalLight(0xfff3d6, 0.75);
  sun.position.set(18, 26, 10);
  scene.add(sun);

  const ground = new THREE.Mesh(new THREE.CircleGeometry(WORLD_R, 32), MAT.ground);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
}

/* Applique l'ambiance (fond + brouillard) de la zone donnée — appelé
   UNIQUEMENT quand une salle devient réellement la salle courante (jamais
   pour la salle préchargée, encore invisible) : sinon on verrait la salle où
   se trouve encore le joueur changer de couleur avant même d'y être arrivé. */
function applyZoneAtmosphere(zoneIdx) {
  const def = ZONE_DEFS[zoneIdx];
  if (!def || !scene) return;
  scene.background.set(def.bg);
  if (scene.fog) scene.fog.color.set(def.fog);
}

/* ============================= SALLES / PORTES ============================= */

function makeLabel(html, worldPos, extraClass, targetArr) {
  const el = document.createElement('div');
  el.className = 'portal-label' + (extraClass ? ' ' + extraClass : '');
  el.innerHTML = html;
  el.style.position = 'fixed';
  el.style.left = '0px';
  el.style.top = '0px';
  document.getElementById('threeContainer').appendChild(el);
  targetArr.push({ el, pos: worldPos });
}

function clearGroup(group, labelArr) {
  labelArr.forEach(l => l.el.remove());
  labelArr.length = 0;
  while (group.children.length) {
    const child = group.children[0];
    group.remove(child);
    // seules les géométries marquées `disposable` (voir wallSegGeometry) sont
    // à nous : tout le reste vient de GEO (partagé, jamais recréé, jamais
    // libéré) — les disposer aussi casserait le rendu des salles suivantes.
    child.traverse(o => {
      if (o.isMesh && o.geometry && o.geometry.userData.disposable) o.geometry.dispose();
    });
  }
}

/* Encadrement de la porte : referme ENTIÈREMENT sa baie (réservée sur
   ±DOOR_BAY_HALF_ANGLE, voir buildBoundary) sauf l'ouverture du battant
   lui-même — deux montants qui vont du sol au plafond et rejoignent
   exactement le bord de la baie (même rayon, même angle que les murs
   voisins : aucun écart), plus un linteau plein au-dessus du battant
   jusqu'au plafond. Sans ça il restait un interstice au-dessus de la porte
   et sur ses côtés par lequel on voyait au travers. */
function buildDoorFrame(localAngle, origin, forward, right, zoneIdx, wallHeight = WALL_HEIGHT_MIN) {
  const dir = dirFromLocalAngle(localAngle, forward, right);
  const p = origin.clone().addScaledVector(dir, DOOR_R);
  const group = orientedGroup(p, dir);
  const depth = 0.3;
  const frameMat = MAT.zones[zoneIdx].wall; // même matériau que le reste du mur — signalé trop clair/distinct autour des portes

  const bayHalfLinear = DOOR_R * Math.tan((DOOR_BAY_HALF_ANGLE * Math.PI) / 180);
  const sideWidth = bayHalfLinear - DOOR_WIDTH / 2;
  const sideCenter = (DOOR_WIDTH / 2 + bayHalfLinear) / 2;

  [1, -1].forEach(s => {
    const side = new THREE.Mesh(wallSegGeometry(sideWidth, wallHeight, depth), frameMat);
    side.position.set(sideCenter * s, wallHeight / 2, 0);
    group.add(side);
  });

  const lintel = new THREE.Mesh(wallSegGeometry(bayHalfLinear * 2, wallHeight - DOOR_HEIGHT, depth), frameMat);
  lintel.position.set(0, DOOR_HEIGHT + (wallHeight - DOOR_HEIGHT) / 2, 0);
  group.add(lintel);

  return group;
}

let doorModelDims = null; // {width, height, thickness} du battant du modèle réel — calculé une seule fois

/* Le battant réel ("door", sous-nœud de assets/models/door.glb — voir
   MODEL_FILES) est fourni dans SA taille naturelle arbitraire, avec sa
   propre convention d'axes (largeur le long de son Z local, pas X). On
   dérive sa taille de sa vraie boîte englobante (jamais devinée à la main),
   puis on le recale sur (DOOR_WIDTH, DOOR_HEIGHT, DOOR_THICKNESS) via une
   échelle non uniforme APPLIQUÉE AVANT la rotation qui réoriente son axe
   "largeur" (Z) sur l'axe de balayage du gond (X) — l'ordre matriciel de
   Three.js (échelle puis rotation) garantit que ce recalage reste correct
   après réorientation. Son origine locale est déjà au bord (le gond) et au
   sol (voir l'inspection de la structure du fichier avant téléchargement),
   donc aucun décalage de position n'est nécessaire, contrairement au panneau
   procédural (BoxGeometry centrée). */
function getDoorModelDims() {
  if (doorModelDims) return doorModelDims;
  const src = MODELS.door.getObjectByName('door');
  const size = new THREE.Box3().setFromObject(src).getSize(new THREE.Vector3());
  doorModelDims = { width: size.z, height: size.y, thickness: size.x };
  return doorModelDims;
}

function doorModelPanel(mat) {
  const src = MODELS.door.getObjectByName('door');
  if (!src) return null;
  const dims = getDoorModelDims();
  const model = src.clone(true);
  model.scale.set(
    dims.thickness > 0.001 ? DOOR_THICKNESS / dims.thickness : 1,
    dims.height > 0.001 ? DOOR_HEIGHT / dims.height : 1,
    dims.width > 0.001 ? DOOR_WIDTH / dims.width : 1,
  );
  model.rotation.y = Math.PI / 2; // réoriente l'axe "largeur" naturel (Z) sur l'axe de balayage du gond (X) — vérifié empiriquement
  model.position.set(0, 0, 0);
  model.traverse(o => { if (o.isMesh) o.material = mat; }); // recolore avec le matériau d'état (action/spécial/bloqué/bonus) — remplace la texture bois d'origine pour garder le code couleur du jeu lisible

  // le modèle a un sommet arrondi (arche) : il ne remplit pas les coins
  // supérieurs du cadre rectangulaire (DOOR_WIDTH×DOOR_HEIGHT) — sans ce
  // fond, on voyait le ciel/fond de scène À TRAVERS ces coins. Un simple
  // panneau plein de la même couleur, légèrement en retrait, comble
  // exactement ces coins sans qu'aucune coupure ne se voie (même teinte).
  const group = new THREE.Group();
  const backing = new THREE.Mesh(GEO.door, mat);
  backing.position.set(DOOR_WIDTH / 2, DOOR_HEIGHT / 2, -DOOR_THICKNESS * 0.3);
  group.add(backing);
  group.add(model);
  return group;
}

/* Une porte est un panneau OPAQUE, plus étroit qu'avant, monté sur un gond :
   fermée elle bloque complètement le passage (aucun mur superflu autour
   d'elle n'est nécessaire) ; en la poussant (on marche jusqu'à elle), elle
   bat doucement vers l'intérieur — voir animateDoorSwing(). Un petit panneau
   en relief + une poignée (des deux côtés) habillent le battant. */
function buildDoor(path, localAngle, origin, forward, right, labelArr) {
  const dir = dirFromLocalAngle(localAngle, forward, right);
  const side = new THREE.Vector3(dir.z, 0, -dir.x); // perpendiculaire, pour placer le gond sur un bord

  const open = path.affordable;
  // portes bonus PNJ (coût réduit / or offert) : couleur émissive dédiée,
  // prioritaire sur la couleur normale — voir le petit halo lumineux
  // supplémentaire ajouté dans buildRoomInto() pour qu'on les repère de loin.
  let mat = !open ? MAT.doorBlocked : (path.kind === 'special' ? MAT.doorSpecial : MAT.doorAction);
  if (open && path.bonusEnergy) mat = MAT.doorBonusEnergy;
  else if (open && path.bonusGold) mat = MAT.doorBonusGold;

  const hinge = new THREE.Group();
  hinge.position.copy(origin).addScaledVector(dir, DOOR_R).addScaledVector(side, -DOOR_WIDTH / 2);
  hinge.lookAt(hinge.position.clone().add(dir));

  const modelPanel = (MODELS && MODELS.door) ? doorModelPanel(mat) : null;
  if (modelPanel) {
    hinge.add(modelPanel);
    // poignée : le modèle n'en a pas de séparée (juste le panneau plein) —
    // rattachée à `hinge` (pas au panneau, dont l'échelle non uniforme
    // compliquerait le placement) sur les deux faces, à hauteur réaliste.
    [1, -1].forEach(s => {
      const knob = new THREE.Mesh(GEO.knob, MAT.knob);
      knob.position.set(DOOR_WIDTH - 0.12, 0.95, (DOOR_THICKNESS / 2 + 0.03) * s);
      hinge.add(knob);
    });
  } else {
    const panel = new THREE.Mesh(GEO.door, mat);
    panel.position.set(DOOR_WIDTH / 2, DOOR_HEIGHT / 2, 0);
    hinge.add(panel);

    // deux panneaux en creux empilés (haut/bas, comme une vraie porte à
    // caissons) + deux ferrures horizontales en fer + rivets à leurs
    // extrémités + une plaque sous la poignée — sur les deux faces du
    // battant. Uniquement pour le repli procédural : le vrai modèle a déjà
    // ces détails sculptés dedans.
    const insetOffset = DOOR_THICKNESS / 2 + 0.015;
    const strapOffset = DOOR_THICKNESS / 2 + 0.02;
    [1, -1].forEach(s => {
      [0.27, -0.27].forEach(cy => {
        const inset = new THREE.Mesh(GEO.unitBox, MAT.doorInset);
        inset.scale.set(DOOR_WIDTH * 0.6, DOOR_HEIGHT * 0.34, 0.03);
        inset.position.set(0, cy, insetOffset * s);
        panel.add(inset);
      });

      [0.62, -0.62].forEach(cy => {
        const strap = new THREE.Mesh(GEO.unitBox, MAT.doorStrap);
        strap.scale.set(DOOR_WIDTH * 0.86, 0.06, 0.025);
        strap.position.set(0, cy, strapOffset * s);
        panel.add(strap);
        [-1, 1].forEach(sx => {
          const rivet = new THREE.Mesh(GEO.knob, MAT.doorStrap);
          rivet.scale.set(0.7, 0.7, 0.7);
          rivet.position.set(sx * DOOR_WIDTH * 0.38, cy, strapOffset * s + 0.02 * s);
          panel.add(rivet);
        });
      });

      const backplate = new THREE.Mesh(GEO.unitBox, MAT.doorStrap);
      backplate.scale.set(0.1, 0.22, 0.02);
      backplate.position.set(DOOR_WIDTH / 2 - 0.12, -0.05, insetOffset * s);
      panel.add(backplate);

      const knob = new THREE.Mesh(GEO.knob, MAT.knob);
      knob.position.set(DOOR_WIDTH / 2 - 0.12, -0.05, insetOffset * s + 0.03 * s);
      panel.add(knob);
    });
  }

  const costText = path.kind === 'action' ? `${path.cost} ${path.currency}` : path.desc;
  // "mode assisté" (Paramètres, activé par défaut, se désactive tout seul
  // au premier reset du dé — voir endTurn() dans game.js) : affiche l'effet
  // complet de CHAQUE porte, pas juste son coût — demandé explicitement
  // ("toutes les portes ont une indication bien plus détaillée de leur
  // effet"). Uniquement utile pour les chemins d'action : les chemins
  // spéciaux affichent déjà leur description complète comme `costText`.
  const showDetail = path.kind === 'action' && typeof meta !== 'undefined' && meta.assistMode;
  const detailHtml = showDetail ? `<span class="pl-desc">${path.desc}</span>` : '';
  const html = `<span class="pl-name">${path.name}</span><span class="pl-cost">${costText}</span>${detailHtml}`;
  const labelPos = origin.clone().addScaledVector(dir, DOOR_R);
  labelPos.y = DOOR_HEIGHT + 0.5;
  const bonusClass = path.bonusEnergy ? ' bonus-energy' : (path.bonusGold ? ' bonus-gold' : '');
  makeLabel(html, labelPos, (!open ? 'blocked' : '') + (path.kind === 'special' ? ' special' : '') + bonusClass + (showDetail ? ' detailed' : ''), labelArr);

  return { object: hinge, hinge };
}

// < ROOM_GAP : garantit que le mur le plus proche de cette coquille reste
// TOUJOURS au-delà de la porte (jamais "dans" la salle courante — voir le
// commentaire de buildDoorStub, bug corrigé le 2026-08-29).
const STUB_RADIUS = 2.6;
// demi-largeur du trou laissé dans l'anneau de mur, du côté qui fait face à
// la salle courante — sans lui, l'anneau est plein à 360° et son mur le plus
// proche (bien que maintenant correctement positionné AU-DELÀ de la porte)
// se contente de faire face au joueur : on ne voit qu'un mur de plus, pas
// une salle qu'on peut voir DEDANS. Signalé explicitement : "on doit voir
// directement la salle, actuellement on voit un mur".
const STUB_GAP_HALF_ANGLE = 40;

/* Avant : l'espace derrière une porte n'était construit QUE si on la
   franchissait réellement (voir commitDoor/nextRoomGroup) — ouvrir une porte
   sans y entrer laissait d'abord voir le sol extérieur (vert), puis un petit
   volume fermé qui se lisait comme "un mur" plutôt que "une salle", puis
   (2026-08-29, cette version) une coquille à la taille EXACTE d'une vraie
   salle (buildBoundary+buildCeiling+buildFloor, rayon WALL_R) positionnée à
   DOOR_R+ROOM_GAP — sauf que WALL_R (4.4) > ROOM_GAP (3.5), donc son mur le
   plus proche (à DOOR_R+ROOM_GAP-WALL_R = 3.75) se retrouvait géométriquement
   PLUS PRÈS du centre de la salle courante que la porte elle-même (DOOR_R=
   4.65) : visible EN PLEIN MILIEU de la salle où on se trouve. Bug signalé
   explicitement : "les murs de la salle de derrière sont dans la salle de
   base". Fix : coquille à un rayon RÉDUIT (STUB_RADIUS < ROOM_GAP), donc son
   mur le plus proche reste toujours au-delà de la porte, quelle que soit la
   distance à laquelle on se trouve dans la salle courante. Pas de plafond
   dédié : celui de la salle courante (CEILING_R=12, largement plus grand que
   la distance à cette coquille, 8.15) le couvre déjà — en superposer un
   second au même niveau créerait un scintillement (z-fighting). Pas de
   baie de porte non plus (anneau de mur complet, 360°) : cette coquille n'a
   pas de porte, inutile d'en réserver une. Sans portes/PNJ dans tous les cas
   (leur présence dépend de l'état de partie résolu SEULEMENT au moment du
   commit — inconnaissable avant). Masquée (pas détruite) au moment du vrai
   commit — voir commitDoor(). */
function buildDoorStub(localAngle, origin, forward, right, zoneIdx, wallHeight = WALL_HEIGHT_MIN) {
  const dir = dirFromLocalAngle(localAngle, forward, right);
  const stubOrigin = origin.clone().addScaledVector(dir, DOOR_R + ROOM_GAP);
  const stubRight = rightFromForward(dir);
  const group = new THREE.Group();

  fillWallArc(group, 180 + STUB_GAP_HALF_ANGLE, 180 - STUB_GAP_HALF_ANGLE + 360, stubOrigin, dir, stubRight, zoneIdx, STUB_RADIUS, wallHeight);

  const floor = new THREE.Mesh(GEO.floor, MAT.zones[zoneIdx].floor);
  floor.rotation.x = -Math.PI / 2;
  const floorScale = (STUB_RADIUS + 0.3) / FLOOR_R;
  floor.scale.set(floorScale, floorScale, 1);
  floor.position.set(stubOrigin.x, 0.015, stubOrigin.z);
  group.add(floor);

  return group;
}

/* Petit halo lumineux flottant au-dessus d'une porte bonus (PNJ 2 : énergie
   réduite/offerte ; PNJ 3 : or offert) — un accent supplémentaire, séparé du
   battant (donc jamais caché par le mouvement d'ouverture), pour que ces
   portes soient repérables même de loin dans la salle. */
function buildBonusGlow(kind, localAngle, origin, forward, right) {
  const dir = dirFromLocalAngle(localAngle, forward, right);
  const p = origin.clone().addScaledVector(dir, DOOR_R);
  const mat = kind === 'gold' ? MAT.glowGold : MAT.glowEnergy;
  const orb = new THREE.Mesh(GEO.glowOrb, mat);
  orb.position.set(p.x, DOOR_HEIGHT + 0.3, p.z);
  return orb;
}

/* Panneau scellé (chemin absent, ex : "doubler l'énergie" déjà utilisé) :
   ne s'ouvre jamais, purement visuel + collision. */
function buildSealedDoor(localAngle, origin, forward, right) {
  const dir = dirFromLocalAngle(localAngle, forward, right);
  const p = origin.clone().addScaledVector(dir, DOOR_R);
  const group = orientedGroup(p, dir);
  const modelPanel = (MODELS && MODELS.door) ? doorModelPanel(MAT.doorSealed) : null;
  if (modelPanel) {
    modelPanel.position.set(-DOOR_WIDTH / 2, 0, 0); // recentré : `orientedGroup` place l'origine du groupe au centre de la baie, pas au bord comme le gond d'une vraie porte
    group.add(modelPanel);
  } else {
    const panel = new THREE.Mesh(GEO.door, MAT.doorSealed);
    panel.position.set(0, DOOR_HEIGHT / 2, 0);
    group.add(panel);
  }
  return group;
}

/* La porte par laquelle on vient d'entrer (voir ENTRY_ANGLE) : purement
   visuelle et statique (revenir en arrière n'est pas un mécanisme du jeu),
   mais bien présente et d'apparence normale (matériau bois standard, pas la
   teinte "scellée" grisâtre de buildSealedDoor qui suggère un chemin
   bloqué) — pour qu'elle continue logiquement d'exister là où on l'a prise
   plutôt que de disparaître derrière un mur plein. */
function buildEntryDoor(origin, forward, right) {
  const dir = dirFromLocalAngle(ENTRY_ANGLE, forward, right);
  const p = origin.clone().addScaledVector(dir, DOOR_R);
  const group = orientedGroup(p, dir);
  const modelPanel = (MODELS && MODELS.door) ? doorModelPanel(MAT.doorAction) : null;
  if (modelPanel) {
    modelPanel.position.set(-DOOR_WIDTH / 2, 0, 0); // recentré, voir buildSealedDoor()
    group.add(modelPanel);
    [1, -1].forEach(s => {
      const knob = new THREE.Mesh(GEO.knob, MAT.knob);
      knob.position.set(DOOR_WIDTH / 2 - 0.12, 0.95, (DOOR_THICKNESS / 2 + 0.03) * s);
      group.add(knob);
    });
  } else {
    const panel = new THREE.Mesh(GEO.door, MAT.doorAction);
    panel.position.set(0, DOOR_HEIGHT / 2, 0);
    group.add(panel);
    const knobOffset = DOOR_THICKNESS / 2 + 0.03;
    [1, -1].forEach(s => {
      const knob = new THREE.Mesh(GEO.knob, MAT.knob);
      knob.position.set(DOOR_WIDTH / 2 - 0.12, -0.05, knobOffset * s);
      panel.add(knob);
    });
  }
  return group;
}

/* Remplit exactement l'arc [startAngle, endAngle] (en degrés, espace continu —
   endAngle peut dépasser 360 pour un arc qui repasse par l'arrière) avec des
   panneaux de mur pleins, subdivisés pour suivre la courbe. Chaque panneau
   est légèrement SURDIMENSIONNÉ (×1.04) par rapport à sa corde théorique :
   ça crée un léger chevauchement volontaire avec ses voisins plutôt qu'un
   risque d'écart — un mur qui déborde un peu ne se voit pas, un mur qui
   laisse un interstice laisse voir au travers. Facteur réduit de ×1.15 à
   ×1.04 (2026-08-29) : avec une vraie texture (avant, un aplat de couleur),
   le chevauchement se voyait — deux surfaces texturées quasi superposées à
   la jointure, aspect "briques mal recollées" signalé. ×1.04 suffit à éviter
   tout interstice (la marge de sécurité n'a jamais eu besoin d'être grande)
   tout en réduisant nettement le chevauchement visible. */
function fillWallArc(group, startAngle, endAngle, origin, forward, right, zoneIdx, radius = DOOR_R, wallHeight = WALL_HEIGHT_MIN) {
  const span = endAngle - startAngle;
  if (span <= 0.01) return;
  const n = Math.max(1, Math.ceil(span / WALL_SEG_MAX_ANGLE));
  const step = span / n;
  const chordWidth = 2 * radius * Math.sin((step * Math.PI) / 360);
  const wallMat = MAT.zones[zoneIdx].wall;
  for (let i = 0; i < n; i++) {
    const mid = startAngle + step * (i + 0.5);
    const dir = dirFromLocalAngle(mid, forward, right);
    const p = origin.clone().addScaledVector(dir, radius);
    const wallGroup = orientedGroup(p, dir);
    const seg = new THREE.Mesh(wallSegGeometry(chordWidth * 1.04, wallHeight, 0.5), wallMat);
    seg.position.set(0, wallHeight / 2, 0);
    wallGroup.add(seg);
    group.add(wallGroup);
  }
}

/* Le mur occupe TOUT le pourtour de la salle sauf les 8 baies de porte
   (±DOOR_BAY_HALF_ANGLE autour de chaque slot — voir buildDoorFrame, qui
   referme le reste de chaque baie) PLUS une 9e baie, fixe, à 180° (angle
   ENTRY_ANGLE — voir buildEntryDoor) : la porte par laquelle on est entré
   dans cette salle reste physiquement là où on l'a prise, elle ne
   "disparaît" pas derrière un mur plein une fois à l'intérieur — signalé
   explicitement. Toutes les baies sont triées puis reliées par des arcs de
   mur pleins, dans l'ordre. */
function buildBoundary(origin, forward, right, zoneIdx, wallHeight = WALL_HEIGHT_MIN) {
  const group = new THREE.Group();
  const H = DOOR_BAY_HALF_ANGLE;
  const bays = DOOR_SLOTS.map(s => ({ start: s.angle - H, end: s.angle + H }))
    .concat([{ start: ENTRY_ANGLE - H, end: ENTRY_ANGLE + H }])
    .sort((a, b) => a.start - b.start);

  for (let i = 0; i < bays.length - 1; i++) {
    fillWallArc(group, bays[i].end, bays[i + 1].start, origin, forward, right, zoneIdx, DOOR_R, wallHeight);
  }
  fillWallArc(group, bays[bays.length - 1].end, bays[0].start + 360, origin, forward, right, zoneIdx, DOOR_R, wallHeight);

  return group;
}

function buildCeiling(origin, zoneIdx, wallHeight = WALL_HEIGHT_MIN) {
  const ceiling = new THREE.Mesh(GEO.ceiling, MAT.zones[zoneIdx].ceiling);
  ceiling.rotation.x = Math.PI / 2; // face vers le bas
  ceiling.position.set(origin.x, wallHeight, origin.z);
  return ceiling;
}

/* Sol intérieur : disque distinct du sol extérieur (herbe) — sans lui, on
   marchait littéralement sur la même herbe qu'au dehors, ce qui contredisait
   "on n'est pas en extérieur". Légèrement surélevé pour ne pas être rongé
   (z-fighting) par le sol extérieur juste en dessous. Même matériau que les
   murs/plafond de la zone courante : une pièce visuellement uniforme. */
function buildFloor(origin, zoneIdx) {
  const floor = new THREE.Mesh(GEO.floor, MAT.zones[zoneIdx].floor);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(origin.x, 0.015, origin.z);
  return floor;
}

/* Une lumière de contraste par salle, SANS ombre portée (voir le commentaire
   de tête de fichier : une lumière ombrée par salle causait un lag sévère,
   d'autant que salle courante ET salle préchargée en ont chacune une en
   permanence — ombres temps réel désactivées entièrement, `renderer.
   shadowMap.enabled = false`). Reste utile pour la couleur/l'ambiance locale
   même sans ombre : teintée par la couleur de fond de la zone (`bg`, plus
   saturée que `wall`), portée limitée à la salle (`distance`). */
function buildRoomLight(origin, zoneIdx, wallHeight) {
  const def = ZONE_DEFS[zoneIdx];
  const light = new THREE.PointLight(def ? def.bg : 0xffe6c0, 2.4, WALL_R * 3, 2);
  light.color.offsetHSL(0, 0, 0.35); // plus clair que la couleur de fond (davantage qu'avant — signalé "trop angoissant")
  light.position.set(origin.x + 1.2, wallHeight - 0.4, origin.z + 0.6);
  return light;
}


const NPC_TARGET_HEIGHT = 1.75; // hauteur cible (mètres/unités monde) une fois le modèle mis à l'échelle — proche de EYE_HEIGHT, taille humaine crédible
const npcModelScaleCache = {};

/* La taille "naturelle" d'un modèle glTF externe est arbitraire (dépend de
   l'auteur) — on la dérive donc de sa vraie boîte englobante plutôt que de
   deviner un facteur d'échelle à la main, même principe que les hitbox
   ailleurs dans ce fichier. Calculé une seule fois par modèle (mis en cache),
   pas à chaque PNJ posé. */
function npcModelScale(id) {
  if (npcModelScaleCache[id] != null) return npcModelScaleCache[id];
  const box = new THREE.Box3().setFromObject(MODELS[id]);
  const height = box.max.y - box.min.y;
  // seuil volontairement TRÈS bas (pas 0.001) : un des modèles Sketchfab
  // (npc1, rigué) a une échelle "monde" native minuscule (~0.002, un facteur
  // d'unités visiblement mal appliqué à l'export) qui donne une hauteur
  // réelle mais toute petite (~0.0007) — avec l'ancien seuil ça tombait dans
  // le repli "pas de boîte englobante" et le PNJ s'affichait minuscule au
  // lieu d'une vraie taille humaine. 1e-6 ne filtre plus qu'une VRAIE boîte
  // dégénérée (taille nulle), jamais un modèle juste exporté dans des unités
  // inhabituelles.
  const scale = height > 1e-6 ? NPC_TARGET_HEIGHT / height : 1;
  npcModelScaleCache[id] = scale;
  return scale;
}

/* Un PNJ : un vrai modèle 3D (glTF, CC0 Kenney — voir MODELS/loadModels())
   une fois chargé, sinon un repli procédural (jambes/torse/bras/tête +
   accessoire propre au rôle — chapeau de parieur, tablier de forgeron,
   bourse de changeur) tant que ce n'est pas le cas. Planté à un emplacement
   fixe de l'arc arrière. Aucune interaction automatique : le joueur doit
   viser le PNJ et appuyer sur INTERACT_KEY (voir
   tryInteractWithNpcUnderCrosshair()) — demandé explicitement, à la place de
   l'ancien système qui les abordait automatiquement à l'entrée dans la
   salle. */
function buildNpc(id, localAngle, origin, forward, right, labelArr) {
  const dir = dirFromLocalAngle(localAngle, forward, right);
  const p = origin.clone().addScaledVector(dir, NPC_STAND_R);
  const group = orientedGroup(p, dir);
  group.userData.npcId = id; // pour le clic direct — voir le gestionnaire de clic dans initThree()

  if (MODELS && MODELS[id]) {
    // les personnages sont des modèles RIGUÉS (squelette + SkinnedMesh) : un
    // .clone(true) classique ne duplique pas le squelette, le SkinnedMesh
    // cloné reste lié aux os de l'ORIGINAL — rien ne s'affichait
    // correctement. SkeletonUtils.clone() duplique aussi le squelette et
    // relie le clone à ses propres os.
    const model = cloneSkeleton ? cloneSkeleton(MODELS[id]) : MODELS[id].clone(true);
    model.scale.setScalar(npcModelScale(id));
    group.add(model);
  } else {
    const primary = MAT[id];

    // jambes
    [-0.11, 0.11].forEach(x => {
      const leg = new THREE.Mesh(GEO.npcLimb, primary);
      leg.scale.set(1, 0.55, 1);
      leg.position.set(x, 0.275, 0);
      group.add(leg);
    });

    // torse
    const torso = new THREE.Mesh(GEO.npcTorso, primary);
    torso.position.set(0, 0.82, 0);
    group.add(torso);

    // bras, légèrement écartés du corps
    [-0.32, 0.32].forEach(x => {
      const arm = new THREE.Mesh(GEO.npcLimb, primary);
      arm.scale.set(0.75, 0.5, 0.75);
      arm.position.set(x, 0.86, 0);
      arm.rotation.z = x > 0 ? -0.2 : 0.2;
      group.add(arm);
    });

    // tête
    const head = new THREE.Mesh(GEO.npcHead, MAT.npcSkin);
    head.position.set(0, 1.42, 0);
    group.add(head);

    // accessoire propre au rôle de ce PNJ
    if (id === 'npc1') {
      const brim = new THREE.Mesh(GEO.unitBox, MAT.npc1Accent);
      brim.scale.set(0.5, 0.05, 0.5);
      brim.position.set(0, 1.64, 0);
      group.add(brim);
      const top = new THREE.Mesh(GEO.npcCone, MAT.npc1Accent);
      top.scale.set(0.55, 0.45, 0.55);
      top.position.set(0, 1.86, 0);
      group.add(top);
    } else if (id === 'npc2') {
      const apron = new THREE.Mesh(GEO.unitBox, MAT.npc2Accent);
      apron.scale.set(0.4, 0.55, 0.06);
      apron.position.set(0, 0.72, 0.24);
      group.add(apron);
    } else if (id === 'npc3') {
      const collar = new THREE.Mesh(GEO.unitBox, MAT.npc3Accent);
      collar.scale.set(0.48, 0.08, 0.48);
      collar.position.set(0, 1.12, 0);
      group.add(collar);
      const pouch = new THREE.Mesh(GEO.propSphereSmall, MAT.npc3Accent);
      pouch.scale.set(0.55, 0.55, 0.55);
      pouch.position.set(0.28, 0.62, 0.14);
      group.add(pouch);
    }
  }

  const name = (typeof window.npcName === 'function') ? window.npcName(id) : id;
  const hint = (typeof window.t === 'function') ? window.t('npc.interactHint') : 'Visez-le et appuyez sur E';
  const html = `<span class="pl-name">${name}</span><span class="pl-cost">${hint}</span>`;
  const labelPos = p.clone();
  labelPos.y = 2.0;
  makeLabel(html, labelPos, 'npc-label', labelArr);

  // rayon de collision dérivé de l'encombrement RÉEL du personnage (bras
  // écartés compris, point le plus large) plutôt que d'une valeur choisie à
  // la main — exactement la même taille que ce qui est affiché.
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  const collisionRadius = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2;

  return { object: group, worldPos: p, collisionRadius };
}

/* Objets de décor : table, armoire (gothique), lustre — de vrais modèles 3D
   Poly Haven (CC0, mêmes fichiers PBR photoscannés que les textures de murs/
   sol déjà utilisées — voir loadPbrTextureSet()) plutôt que du low-poly
   stylisé, pour un rendu à la fois réaliste ET visuellement cohérent avec le
   reste de la salle. Le lustre est suspendu au plafond (PROP_HANGING),
   hors de portée du joueur au sol : pas de collision pour lui, contrairement
   aux autres qui bloquent réellement le passage (jamais TOTALEMENT l'accès à
   une porte cela dit — une seule petite exclusion angulaire par porte/PNJ,
   un contournement reste toujours possible dans une salle circulaire aussi
   dégagée). Hauteur cible par type (voir PROP_TARGET_SIZE), échelle dérivée
   de la vraie taille du modèle — jamais devinée à la main. */
// pondéré (pas juste une entrée par type) : plantes et lustres/lampes
// nettement plus fréquents que le reste — "il faut plus de plante... plus de
// lustre... un décor plus gai" demandé explicitement.
const PROP_KEYS = ['propTable', 'propCabinet', 'propChandelier', 'propChandelier', 'propChandelier', 'propPlant', 'propPlant', 'propPlant', 'propPlant'];
const PROP_TARGET_SIZE = {
  propTable: 0.75,
  propCabinet: 1.9,
  propChandelier: 0.9,
  propPlant: 0.7, // le pot compte dans la hauteur cible du groupe entier (plante + pot), voir buildProps()
};
const PROP_HANGING = { propChandelier: true };
// la plupart des plantes sont posées dans un pot (comme entretenues, pas
// sauvages) — demandé explicitement ("comme si elle était entretenue").
const PROP_POTTED_CHANCE = { propPlant: 0.75 };
// une plante a un vrai feuillage souple, pas une carcasse rigide — demandé
// explicitement ("une vraie physique... on peut traverser une plante comme
// dans la vraie vie"). Garde une hitbox EXACTE (mêmes halfW/halfD dérivés du
// modèle que tout le reste du décor, voir buildProps) mais `soft:true` fait
// que resolveObstacleList() ne repousse jamais le joueur pour cet obstacle —
// contrairement à une table/armoire, restées rigides.
const PROP_SOFT = { propPlant: true };
const propModelScaleCache = {};

function propModelScale(key) {
  if (propModelScaleCache[key] != null) return propModelScaleCache[key];
  const box = new THREE.Box3().setFromObject(MODELS[key]);
  const height = box.max.y - box.min.y;
  const target = PROP_TARGET_SIZE[key] || 0.7;
  const scale = height > 0.001 ? target / height : 1;
  propModelScaleCache[key] = scale;
  return scale;
}

const propExtentsCache = {};

/* Demi-largeur/profondeur (X/Z) RÉELLES du modèle, à l'échelle 1 — dérivées
   de sa vraie boîte englobante, jamais devinées. Combinées à l'échelle et à
   la rotation aléatoire de chaque instance posée, elles donnent une hitbox
   RECTANGULAIRE ORIENTÉE qui colle exactement à la silhouette affichée —
   demandé explicitement ("les hitbox... exactement de la même taille et
   forme que leur apparence"), pas juste un cercle englobant plus large que
   l'objet dans sa direction la plus étroite (ex. une table, bien plus longue
   que large). */
function propExtents(key) {
  if (propExtentsCache[key]) return propExtentsCache[key];
  const box = new THREE.Box3().setFromObject(MODELS[key]);
  propExtentsCache[key] = { halfW: (box.max.x - box.min.x) / 2, halfD: (box.max.z - box.min.z) / 2 };
  return propExtentsCache[key];
}

/* Éparpille 2 à 4 objets de décor dans l'espace intérieur libre de la salle,
   en évitant les baies de porte, les emplacements des PNJ, la porte
   d'entrée (avoidAngles) ET tout objet de décor déjà posé cette salle
   (aucun chevauchement entre deux objets — demandé explicitement ; test par
   cercle circonscrit à chaque rectangle, conservateur donc sûr quelle que
   soit leur rotation relative). Retourne aussi la liste des obstacles de
   collision — chaque objet réellement solide bloque le passage (sauf le
   lustre, suspendu au plafond — hors de portée du joueur au sol ; lui
   donner une hitbox purement horizontale bloquerait à tort le passage EN
   DESSOUS de lui), mais jamais TOTALEMENT l'accès à une porte (une seule
   petite exclusion angulaire par porte/PNJ, un contournement reste toujours
   possible dans une salle circulaire aussi dégagée). Rien tant que les
   modèles ne sont pas chargés : pas de repli procédural (l'ancienne version
   en formes géométriques simples a été retirée à la demande de
   l'utilisateur, qui la jugeait moche). */
function buildProps(zoneIdx, origin, forward, right, avoidAngles, wallHeight = WALL_HEIGHT_MIN) {
  const group = new THREE.Group();
  const obstacles = [];
  if (!MODELS) return { group, obstacles };

  const placedCircles = []; // {x, z, r} — cercle circonscrit de chaque objet déjà posé, pour le rejet de chevauchement
  // "un décor plus gai" avec "plus de plantes... plus de lustres" demandé
  // explicitement : remonté par rapport au tour précédent (qui visait
  // délibérément moins d'objets) — la logique de placement (pas de
  // chevauchement, exclusion angulaire large, décalé du centre) reste
  // inchangée, seul le nombre remonte.
  const count = 1 + Math.floor(Math.random() * 3);
  let placed = 0, attempts = 0;
  // budget d'essais généreux : l'exclusion angulaire élargie (25°, voir plus
  // haut) autour de 8 portes + jusqu'à 3 PNJ + l'entrée laisse assez peu
  // d'espace angulaire "libre" par tirage aléatoire — un budget trop juste
  // (l'ancien ×15) faisait souvent échouer le placement bien avant d'avoir
  // atteint `count`, contredisant "plus de plantes/lustres" demandé.
  while (placed < count && attempts < count * 50) {
    attempts++;
    const angle = Math.random() * 360;
    if (avoidAngles.some(a => Math.abs(angleDiff(angle, a)) < 25)) continue;
    const radius = 2.0 + Math.random() * (WALL_R - 2.8);
    const dir = dirFromLocalAngle(angle, forward, right);
    const p = origin.clone().addScaledVector(dir, radius);
    const key = PROP_KEYS[Math.floor(Math.random() * PROP_KEYS.length)];
    if (!MODELS[key]) continue;

    const scale = propModelScale(key);
    const ext = propExtents(key);
    const halfW = ext.halfW * scale, halfD = ext.halfD * scale;
    const circumRadius = Math.hypot(halfW, halfD); // englobe le rectangle quelle que soit sa rotation
    if (placedCircles.some(q => Math.hypot(p.x - q.x, p.z - q.z) < circumRadius + q.r)) continue;

    const model = MODELS[key].clone(true);
    model.scale.setScalar(scale);
    const hanging = PROP_HANGING[key];
    // la plupart des plantes sont posées dans un pot en terre cuite (comme
    // entretenues, pas sauvages) — demandé explicitement. Simple géométrie
    // procédurale (pas de modèle téléchargé pour ça) : la plante repose
    // dessus, légèrement enfoncée comme dans un vrai pot.
    const potted = PROP_POTTED_CHANCE[key] && Math.random() < PROP_POTTED_CHANCE[key];
    if (potted) {
      const pot = new THREE.Mesh(GEO.plantPot, MAT.plantPot);
      pot.position.set(p.x, 0.11, p.z);
      group.add(pot);
    }
    model.position.set(p.x, hanging ? wallHeight - 0.1 : (potted ? 0.16 : 0), p.z);
    const rotY = Math.random() * Math.PI * 2;
    model.rotation.y = rotY;
    group.add(model);

    if (!hanging) {
      obstacles.push({ type: 'box', x: p.x, z: p.z, halfW, halfD, rotY, soft: PROP_SOFT[key] });
      placedCircles.push({ x: p.x, z: p.z, r: circumRadius });
    }
    placed++;
  }
  return { group, obstacles };
}

function buildRoomInto(group, labelArr, origin, forward, right) {
  clearGroup(group, labelArr);
  const paths = (typeof window.getCurrentPaths === 'function' ? window.getCurrentPaths() : []);
  const presentNpcs = (typeof window.getCurrentNpcs === 'function' ? window.getCurrentNpcs() : []);
  const zone = (typeof window.getCurrentZone === 'function') ? window.getCurrentZone() : null;
  const zoneIdx = zone ? zone.index : 0;
  const closed = new Set();
  // hauteur de plafond tirée au hasard UNE FOIS pour toute cette salle — vraie
  // variété d'une salle à l'autre ("il peut y avoir un plafond plus haut, une
  // autre forme de pièce") plutôt qu'une constante partout. Suivie hors de
  // cette fonction via roomWallHeight/pendingWallHeight (voir regenerateHub()/
  // updateGapMovement()) pour que updateJump() connaisse le VRAI plafond.
  const wallHeight = WALL_HEIGHT_MIN + Math.random() * (WALL_HEIGHT_MAX - WALL_HEIGHT_MIN);

  DOOR_SLOTS.forEach(slot => {
    const p = paths.find(x => x.id === slot.id);
    if (p) {
      const built = buildDoor(p, slot.angle, origin, forward, right, labelArr);
      group.add(built.object);
      if (!p.affordable) closed.add(slot.id);
      built.hinge.userData.slotId = slot.id;
      if (p.affordable && p.bonusEnergy) group.add(buildBonusGlow('energy', slot.angle, origin, forward, right));
      else if (p.affordable && p.bonusGold) group.add(buildBonusGlow('gold', slot.angle, origin, forward, right));
      // la coquille de salle visible derrière une porte OUVERTE (voir
      // buildDoorStub) n'est PAS construite ici pour toutes les portes
      // franchissables : elle est grande comme une vraie salle, et en
      // construire une par porte franchissable (souvent 3-5 simultanément)
      // les empilait toutes les unes sur les autres (bug signalé : "plein de
      // salles empilées, on traverse les murs"). Elle est maintenant créée
      // dynamiquement, une seule à la fois, UNIQUEMENT pour la porte
      // réellement ouverte — voir maybeTriggerDoorSwing()/updateDoorSwing().
    } else {
      group.add(buildSealedDoor(slot.angle, origin, forward, right));
      closed.add(slot.id);
    }
    group.add(buildDoorFrame(slot.angle, origin, forward, right, zoneIdx, wallHeight));
  });
  group.add(buildBoundary(origin, forward, right, zoneIdx, wallHeight));
  group.add(buildCeiling(origin, zoneIdx, wallHeight));
  group.add(buildFloor(origin, zoneIdx));
  group.add(buildRoomLight(origin, zoneIdx, wallHeight));
  // la toute première salle de la partie n'a pas été "prise" par une porte
  // (on y démarre directement) : pas de porte d'entrée pour elle. Toutes les
  // suivantes ont forcément été atteintes en franchissant une porte — celle-
  // ci reste visible, à sa place logique (ENTRY_ANGLE), au lieu de
  // disparaître derrière un mur plein.
  if (hasEnteredViaDoor) {
    group.add(buildEntryDoor(origin, forward, right));
    group.add(buildDoorFrame(ENTRY_ANGLE, origin, forward, right, zoneIdx, wallHeight));
  }

  // décor (voir buildProps()) : uniquement une fois les modèles réels chargés
  // (pas de repli procédural pour ça — jugés "moches" par l'utilisateur dans
  // leur ancienne version en formes géométriques simples, retirés pour de
  // bon ; ils reviennent maintenant seulement avec de vrais modèles 3D).
  const avoidAngles = DOOR_SLOTS.map(s => s.angle).concat(NPC_SLOTS.map(s => s.angle)).concat([ENTRY_ANGLE]);
  const propsBuilt = buildProps(zoneIdx, origin, forward, right, avoidAngles, wallHeight);
  group.add(propsBuilt.group);
  const obstacles = propsBuilt.obstacles;

  const npcSlots = [];
  NPC_SLOTS.forEach(slot => {
    if (!presentNpcs.includes(slot.id)) return;
    const built = buildNpc(slot.id, slot.angle, origin, forward, right, labelArr);
    group.add(built.object);
    npcSlots.push({ id: slot.id, worldPos: built.worldPos, group: built.object });
    obstacles.push({ type: 'circle', x: built.worldPos.x, z: built.worldPos.z, radius: built.collisionRadius });
  });

  return { closed, npcSlots, zoneIdx, obstacles, wallHeight };
}

function findDoorHinge(group, slotId) {
  for (const child of group.children) {
    if (child.userData && child.userData.slotId === slotId) return child;
  }
  return null;
}

/* ============================= PONT AVEC game.js ============================= */

function regenerateHub() {
  if (!started) initThree();

  if (transitioning) {
    const built = buildRoomInto(nextRoomGroup, nextLabels, pendingRoomOrigin, pendingRoomForward, pendingRoomRight);
    pendingClosedSlots = built.closed;
    pendingNpcSlots = built.npcSlots;
    pendingObstacles = built.obstacles;
    pendingZoneIdx = built.zoneIdx;
    pendingWallHeight = built.wallHeight;
    nextRoomReady = true;
  } else {
    const built = buildRoomInto(roomGroup, labels, roomOrigin, roomForward, roomRight);
    closedSlots = built.closed;
    roomNpcSlots = built.npcSlots;
    roomObstacles = built.obstacles;
    roomWallHeight = built.wallHeight;
    doorSwingTargets = new Map();
    doorStubs = new Map(); // les coquilles précédentes ont déjà été détruites par clearGroup() dans buildRoomInto ; on oublie juste leurs références ici
    applyZoneAtmosphere(built.zoneIdx);
  }
}

/* Retourne true si le chemin a bien été pris. En jeu normal, closedSlots
   reflète toujours exactement getCurrentPaths(), donc choosePath() ne peut
   pas refuser ici — ce repli n'est qu'une sécurité. */
/* L'ordre compte : `transitioning` doit déjà valoir `true` AVANT d'appeler
   window.choosePath(), parce que game.js résout tout le tour de façon
   SYNCHRONE (voir endTurn() dans game.js) et appelle window.regenerateHub()
   immédiatement — regenerateHub() regarde `transitioning` pour savoir s'il
   doit construire dans nextRoomGroup (préchargement, correct) ou écraser la
   salle courante (roomGroup, faux) ; l'inverser ferait détruire la salle où
   le joueur se trouve encore au moment même où il pousse la porte. */
function commitDoor(slot) {
  const dir = dirFromLocalAngle(slot.angle, roomForward, roomRight).normalize();
  transitionDir.copy(dir);
  doorPoint.copy(roomOrigin).addScaledVector(dir, DOOR_R);

  pendingRoomOrigin.copy(doorPoint).addScaledVector(dir, ROOM_GAP);
  pendingRoomForward.copy(dir);
  pendingRoomRight.copy(rightFromForward(dir));

  transitioning = true;
  nextRoomReady = false;
  hasEnteredViaDoor = true; // dès la première vraie porte franchie — voir buildRoomInto()

  const accepted = typeof window.choosePath === 'function' ? window.choosePath(slot.id) : false;
  if (!accepted) {
    // repli de sécurité : rien n'a été validé côté jeu, on annule la transition
    transitioning = false;
    return false;
  }

  // repli : si l'ouverture anticipée (voir maybeTriggerDoorSwing) n'a pour une
  // raison quelconque pas eu lieu, on la déclenche maintenant (idempotent).
  maybeTriggerDoorSwing(slot.id);

  // on franchit VRAIMENT cette porte : l'aperçu-stub (voir buildDoorStub)
  // n'a plus sa place, sa géométrie se retrouverait en plein milieu du
  // trajet vers la vraie salle suivante — masquée, pas détruite (roomGroup
  // sera de toute façon entièrement vidé à l'arrivée, voir updateGapMovement).
  const committedStub = doorStubs.get(slot.id);
  if (committedStub) committedStub.visible = false;

  return true;
}

function enterPlayMode() {
  if (!started) initThree();
  document.getElementById('playArea').hidden = false;
}

window.regenerateHub = regenerateHub;
window.enterPlayMode = enterPlayMode;
// appelé par game.js quand une partie SAUVEGARDÉE (pas neuve) est restaurée
// au chargement — voir newRun()/loadRun() : la salle reconstruite n'est pas
// la toute première de la partie, elle doit donc afficher sa porte d'entrée
// (voir buildRoomInto/ENTRY_ANGLE) comme n'importe quelle autre salle.
window.markRoomAlreadyEntered = () => { hasEnteredViaDoor = true; };

/* ============================= BOUCLE ============================= */

/* Fait tendre chaque battant en cours d'animation vers sa cible (ouvert ou
   fermé) à vitesse angulaire constante — contrairement à l'ancienne version
   à durée fixe, ça permet d'inverser proprement une porte à mi-course si le
   joueur change d'avis (voir closeDoorSwing()), sans à-coup. */
function updateDoorSwing(dt) {
  const maxStep = DOOR_SWING_SPEED * dt;
  for (const [slotId, entry] of doorSwingTargets) {
    const current = entry.hinge.rotation.y;
    const diff = entry.target - current;
    if (Math.abs(diff) <= maxStep) {
      entry.hinge.rotation.y = entry.target;
      if (entry.target === 0) {
        doorSwingTargets.delete(slotId); // fermée : plus besoin de la suivre
        // la coquille de salle derrière cette porte (voir maybeTriggerDoorSwing)
        // n'a plus lieu d'être une fois la porte refermée — détruite, pas
        // juste masquée (sinon elle traînerait, invisible mais toujours là,
        // à chaque future ouverture de la même porte).
        const stub = doorStubs.get(slotId);
        if (stub) {
          roomGroup.remove(stub);
          stub.traverse(o => { if (o.isMesh && o.geometry && o.geometry.userData.disposable) o.geometry.dispose(); });
          doorStubs.delete(slotId);
        }
      }
    } else {
      entry.hinge.rotation.y = current + Math.sign(diff) * maxStep;
    }
  }
}

function updateJump(dt) {
  // ne jamais DÉCLENCHER un nouveau saut (son inclus) pendant la traversée
  // du "gap" d'une porte, sinon le son de saut retentit juste après le son
  // de porte ouverte — mais la gravité, elle, doit continuer à s'appliquer
  // MÊME pendant la traversée : si le joueur était déjà en l'air au moment
  // de franchir la porte (saut commencé juste avant), figer entièrement
  // heightOffset/velocityY pendant tout le "gap" (ancien comportement : toute
  // cette fonction était sautée tant que `transitioning` valait vrai) le
  // laissait suspendu à une hauteur fixe jusqu'à l'arrivée dans la salle
  // suivante, où il retombait d'un coup après avoir déjà avancé — sensation
  // de rester coincé dans le mur au-dessus de la porte franchie. Bug signalé
  // explicitement.
  if (!transitioning && isDown('jump') && heightOffset <= 0.001 && velocityY <= 0) {
    velocityY = JUMP_SPEED;
    if (window.SFX) SFX.jump();
  }
  velocityY += GRAVITY * dt;
  heightOffset += velocityY * dt;
  if (heightOffset < 0) {
    heightOffset = 0; velocityY = 0;
    if (wasAirborne && window.SFX) SFX.land();
    wasAirborne = false;
  } else {
    wasAirborne = true;
  }
  // ne jamais laisser la caméra dépasser le plafond (sinon on passe derrière
  // ce disque fin comme une caméra sans épaisseur, ce qui le rend invisible
  // — donc "voir à travers" — puisque son revers n'est jamais dessiné). Le
  // plafond a une hauteur DIFFÉRENTE par salle désormais (voir
  // roomWallHeight/WALL_HEIGHT_MIN/MAX) — recalculé ici plutôt qu'une
  // constante fixe (un ancien MAX_HEIGHT_OFFSET figé au chargement du script).
  const maxHeightOffset = roomWallHeight - EYE_HEIGHT - 0.1;
  if (heightOffset > maxHeightOffset) { heightOffset = maxHeightOffset; if (velocityY > 0) velocityY = 0; }
  camera.position.y = EYE_HEIGHT + heightOffset;
}

/* Un pas discret toutes les FOOTSTEP_INTERVAL secondes de marche effective —
   pas à chaque frame (ce serait un bruit continu "parasite"), et rien du
   tout tant qu'on ne bouge pas (`moving` gardé au sol, pas en l'air pour ne
   pas superposer un pas au son d'atterrissage). */
function tickFootsteps(dt, moving) {
  if (!moving || heightOffset > 0.01) return;
  footstepTimer += dt;
  if (footstepTimer >= FOOTSTEP_INTERVAL) {
    footstepTimer = 0;
    if (window.SFX) SFX.footstep();
  }
}

/* Empêche de traverser les objets de décor (rectangles orientés) et les PNJ
   (cercles), dans le plan XZ — appliqué juste après le déplacement brut,
   avant le clamp mur/porte qui suit.

   Convention de rotation.y de THREE.js vérifiée EMPIRIQUEMENT (comme pour
   lookAt() ailleurs dans ce fichier — ne jamais la déduire par le seul
   raisonnement) : pour un objet tourné de θ autour de Y, l'axe local +X finit
   en (cos θ, -sin θ) en coordonnées monde, pas (cos θ, sin θ) comme le
   donnerait une rotation 2D "standard" — d'où le signe de `sin` ci-dessous,
   dans les deux sens (monde→local et local→monde).

   Calcule le vecteur de correction (en repère LOCAL du rectangle, non
   tourné) qui replace le joueur à `clearance` de la surface la plus proche.
   Deux cas, PAS un simple "point le plus proche puis clamp" : si le joueur
   est déjà À L'INTÉRIEUR du rectangle (lx/lz dans les demi-étendues), le
   clamp ne bouge rien (un point déjà dans l'intervalle reste inchangé) —
   bug réel trouvé en testant : le joueur restait bloqué SANS ÊTRE repoussé
   s'il se retrouvait à l'intérieur (spawn proche, mouvement rapide...). Dans
   ce cas on pousse vers la face la plus proche plutôt que vers le point le
   plus proche. */
function obbPushVector(lx, lz, halfW, halfD, clearance) {
  const insideX = Math.abs(lx) < halfW, insideZ = Math.abs(lz) < halfD;
  if (insideX && insideZ) {
    const distToXFace = halfW - Math.abs(lx);
    const distToZFace = halfD - Math.abs(lz);
    return distToXFace < distToZFace
      ? { x: Math.sign(lx || 1) * (halfW + clearance), z: lz }
      : { x: lx, z: Math.sign(lz || 1) * (halfD + clearance) };
  }
  const cx = Math.max(-halfW, Math.min(halfW, lx));
  const cz = Math.max(-halfD, Math.min(halfD, lz));
  const ex = lx - cx, ez = lz - cz;
  const edist = Math.hypot(ex, ez);
  if (edist >= clearance) return null; // déjà assez loin, rien à faire
  const nx = edist > 1e-6 ? ex / edist : 1, nz = edist > 1e-6 ? ez / edist : 0;
  return { x: cx + nx * clearance, z: cz + nz * clearance };
}

/* Repousse le joueur hors de chaque obstacle de `obstacles` (cercle — PNJ —
   ou rectangle orienté — décor, voir buildProps) où il se trouve encore
   engagé. Paramétrée (pas juste `roomObstacles`) pour pouvoir aussi
   s'appliquer à `pendingObstacles` pendant la traversée du "gap" entre deux
   salles (voir updateGapMovement) : sans ça, le décor de la salle qu'on
   vient d'atteindre restait traversable jusqu'à l'arrivée "officielle" —
   signalé explicitement ("dès qu'on entre dans une pièce on peut traverser
   les objets"). */
function resolveObstacleList(obstacles) {
  for (const ob of obstacles) {
    if (ob.soft) continue; // décor "souple" (plantes) : hitbox exacte mais traversable, voir PROP_SOFT
    if (ob.type === 'box') {
      const dx = camera.position.x - ob.x, dz = camera.position.z - ob.z;
      const cos = Math.cos(ob.rotY), sin = Math.sin(ob.rotY);
      const lx = dx * cos - dz * sin, lz = dx * sin + dz * cos;
      const corrected = obbPushVector(lx, lz, ob.halfW, ob.halfD, PLAYER_RADIUS);
      if (corrected) {
        camera.position.x = corrected.x * cos + corrected.z * sin + ob.x;
        camera.position.z = -corrected.x * sin + corrected.z * cos + ob.z;
      }
    } else {
      const dx = camera.position.x - ob.x, dz = camera.position.z - ob.z;
      const minDist = PLAYER_RADIUS + ob.radius;
      const distSq = dx * dx + dz * dz;
      if (distSq < minDist * minDist && distSq > 1e-6) {
        const dist = Math.sqrt(distSq);
        const push = minDist - dist;
        camera.position.x += (dx / dist) * push;
        camera.position.z += (dz / dist) * push;
      }
    }
  }
}

function resolveObstacleCollisions() {
  resolveObstacleList(roomObstacles);
}

/* Déclenche le battant (animation + son) un peu AVANT que le joueur
   n'atteigne réellement la porte (voir DOOR_PREOPEN_DIST) — sinon, comme le
   déclenchement coïncidait avec le moment même de la franchir, la porte
   s'ouvrait déjà derrière la tête du joueur et il ne la voyait jamais
   s'ouvrir. Idempotent : ne rejoue pas le son si déjà ouverte/en cours
   d'ouverture. */
function maybeTriggerDoorSwing(slotId) {
  const existing = doorSwingTargets.get(slotId);
  const wasClosedOrClosing = !existing || existing.target === 0;
  if (existing) {
    existing.target = -SWING_ANGLE;
  } else {
    const hinge = findDoorHinge(roomGroup, slotId);
    if (!hinge) return;
    doorSwingTargets.set(slotId, { hinge, target: -SWING_ANGLE });
  }
  // vraie première ouverture (pas juste ré-ouverte avant d'avoir fini de se
  // refermer) : construit la coquille de salle vue derrière cette porte
  // (voir buildDoorStub) — une seule à la fois, voir la note sur doorStubs.
  if (wasClosedOrClosing && !doorStubs.has(slotId)) {
    const slot = DOOR_SLOTS.find(s => s.id === slotId);
    const zone = (typeof window.getCurrentZone === 'function') ? window.getCurrentZone() : null;
    if (slot) {
      const stub = buildDoorStub(slot.angle, roomOrigin, roomForward, roomRight, zone ? zone.index : 0, roomWallHeight);
      roomGroup.add(stub);
      doorStubs.set(slotId, stub);
    }
  }
  if (wasClosedOrClosing && window.SFX) SFX.doorOpen();
}

/* Referme un battant précédemment ouvert (le joueur s'en est éloigné sans le
   franchir) — voir l'appel dans updateRoomMovement(). Idempotent. */
function closeDoorSwing(slotId) {
  const entry = doorSwingTargets.get(slotId);
  if (!entry || entry.target === 0) return;
  entry.target = 0;
  if (window.SFX && SFX.doorClose) SFX.doorClose();
}

function updateRoomMovement(dt) {
  const forwardInput = (isDown('forward') ? 1 : 0) - (isDown('back') ? 1 : 0);
  const rightInput = (isDown('right') ? 1 : 0) - (isDown('left') ? 1 : 0);
  // le déplacement effectif reste conditionné à une touche pressée, MAIS tout
  // ce qui suit (état des portes) doit tourner à CHAQUE frame, pas seulement
  // pendant qu'on bouge — sinon une porte ouverte puis laissée telle quelle
  // (joueur immobile après s'en être éloigné) ne se refermait jamais : le
  // `return` ici sortait de la fonction avant d'atteindre la boucle de
  // fermeture des battants, plus bas. Bug signalé explicitement.
  if (forwardInput !== 0 || rightInput !== 0) {
    tickFootsteps(dt, true);
    _forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    _right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    camera.position.addScaledVector(_forward, forwardInput * MOVE_SPEED * dt);
    camera.position.addScaledVector(_right, rightInput * MOVE_SPEED * dt);
    resolveObstacleCollisions();
  }

  _rel.set(camera.position.x - roomOrigin.x, 0, camera.position.z - roomOrigin.z);
  const fComp = _rel.dot(roomForward);
  const rComp = _rel.dot(roomRight);
  const r = Math.sqrt(fComp * fComp + rComp * rComp);
  const localAngle = (Math.atan2(rComp, fComp) * 180) / Math.PI;

  const nearest = nearestDoorSlot(localAngle);
  const atDoor = Math.abs(nearest.diff) <= DOOR_HALF_WIDTH;
  const open = atDoor && !closedSlots.has(nearest.slot.id);

  if (open) {
    if (r >= DOOR_R - DOOR_PREOPEN_DIST) maybeTriggerDoorSwing(nearest.slot.id);
    if (r >= DOOR_R) {
      commitDoor(nearest.slot);
      // filet de sécurité : si le commit a été refusé côté jeu (ex: état
      // périmé entre le moment où la salle a été construite et celui où on
      // atteint réellement la porte), `transitioning` reste false — sans ce
      // clamp on continuerait à avancer librement au-delà de DOOR_R, à
      // travers la coquille de salle (voir buildDoorStub), sans jamais
      // vraiment transitionner. Aucun mur ne doit être traversable : on
      // referme cette porte-là comme les autres (clampé à la surface du mur).
      if (!transitioning) {
        const rad = (localAngle * Math.PI) / 180;
        _dir.copy(roomForward).multiplyScalar(Math.cos(rad)).addScaledVector(roomRight, Math.sin(rad));
        camera.position.x = roomOrigin.x + _dir.x * (WALL_R - WALL_CLEARANCE);
        camera.position.z = roomOrigin.z + _dir.z * (WALL_R - WALL_CLEARANCE);
      }
    }
  } else if (r > WALL_R - WALL_CLEARANCE) {
    // clampé un peu AVANT la surface du mur (WALL_CLEARANCE), pas exactement
    // dessus : collé pile sur la surface, le plan proche de la caméra (0.1)
    // finissait DANS le mur, qui disparaissait du rendu — on voyait au
    // travers. Bug signalé explicitement.
    const rad = (localAngle * Math.PI) / 180;
    _dir.copy(roomForward).multiplyScalar(Math.cos(rad)).addScaledVector(roomRight, Math.sin(rad));
    camera.position.x = roomOrigin.x + _dir.x * (WALL_R - WALL_CLEARANCE);
    camera.position.z = roomOrigin.z + _dir.z * (WALL_R - WALL_CLEARANCE);
  }

  // referme tout battant resté ouvert dont le joueur s'est éloigné sans le
  // franchir (une marge — DOOR_CLOSE_HYSTERESIS — évite un battement au pas
  // pile de la frontière).
  for (const [slotId] of doorSwingTargets) {
    const keepOpen = open && slotId === nearest.slot.id && r >= DOOR_R - DOOR_PREOPEN_DIST - DOOR_CLOSE_HYSTERESIS;
    if (!keepOpen) closeDoorSwing(slotId);
  }
}

/* Pas de couloir à traverser : juste un court espace ouvert entre la porte et
   la salle suivante, qu'on voit directement. Le déplacement y reste libre
   (pas de murs latéraux) ; seule une avancée trop rapide est freinée si la
   salle suivante n'est pas encore prête (jamais de salle vide révélée). */
/* Léger balancement vertical (respiration) pour que les PNJ ne paraissent
   pas figés — décalé par la position de chacun pour ne pas tous osciller
   en même temps. Coût négligeable : au plus 3 PNJ par salle. */
function updateNpcIdle(t) {
  for (const npc of roomNpcSlots) {
    if (npc.group) npc.group.position.y = Math.sin(t * 1.6 + npc.worldPos.x) * 0.035;
  }
}


function updateGapMovement(dt) {
  const forwardInput = (isDown('forward') ? 1 : 0) - (isDown('back') ? 1 : 0);
  const rightInput = (isDown('right') ? 1 : 0) - (isDown('left') ? 1 : 0);
  tickFootsteps(dt, forwardInput !== 0 || rightInput !== 0);
  if (forwardInput !== 0 || rightInput !== 0) {
    _forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    _right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    camera.position.addScaledVector(_forward, forwardInput * MOVE_SPEED * dt);
    camera.position.addScaledVector(_right, rightInput * MOVE_SPEED * dt);
  }
  // le décor de la salle qu'on approche (pas encore "officiellement" celle
  // où on se trouve) doit déjà bloquer le passage — sinon on pouvait
  // traverser ses objets pendant les derniers instants de la traversée et
  // juste après l'arrivée. Contrairement à updateRoomMovement(), pas
  // conditionné à un appui touche : sinon rester immobile PILE dans un
  // obstacle (arrivée en mouvement, puis on relâche) ne repousserait jamais.
  if (nextRoomReady) resolveObstacleList(pendingObstacles);

  _rel.set(camera.position.x - doorPoint.x, 0, camera.position.z - doorPoint.z);
  const progress = _rel.dot(transitionDir);
  const limit = nextRoomReady ? ROOM_GAP : Math.max(0, ROOM_GAP - HOLD_BACK);
  if (progress > limit) {
    const excess = progress - limit;
    camera.position.addScaledVector(transitionDir, -excess);
  } else if (progress < 0) {
    // bug corrigé (2026-08-29) : rien ne limitait `progress` vers le bas —
    // une fois la porte franchie (transitioning=true), on pouvait reculer
    // librement, repasser derrière la porte et se retrouver PHYSIQUEMENT
    // dans l'espace de l'ancienne salle... alors que updateGapMovement()
    // n'applique aucune collision de mur (juste cette limite de progression
    // vers l'avant) : ses murs redevenaient traversables. Signalé
    // explicitement : "si je suis considéré dans l'autre pièce je ne dois
    // pas pouvoir en sortir". Une fois la porte franchie, le point de non-
    // retour est la porte elle-même : `progress` ne repasse plus jamais sous 0.
    camera.position.addScaledVector(transitionDir, -progress);
  }

  if (nextRoomReady && progress >= ROOM_GAP - 0.05) {
    // arrivée dans la nouvelle salle
    transitioning = false;
    roomOrigin.copy(pendingRoomOrigin);
    roomForward.copy(pendingRoomForward);
    roomRight.copy(pendingRoomRight);
    closedSlots = pendingClosedSlots;
    roomNpcSlots = pendingNpcSlots;
    roomObstacles = pendingObstacles;
    roomWallHeight = pendingWallHeight;
    doorSwingTargets = new Map();
    doorStubs = new Map(); // la coquille de la porte franchie a été masquée dans commitDoor() ; clearGroup() ci-dessous détruit tout roomGroup de toute façon
    applyZoneAtmosphere(pendingZoneIdx);

    clearGroup(roomGroup, labels);
    labels = nextLabels;
    nextLabels = [];
    // transfère les enfants de la salle suivante dans le groupe "salle courante"
    while (nextRoomGroup.children.length) roomGroup.add(nextRoomGroup.children[0]);
  }
}

function updateLabels() {
  const w = window.innerWidth, h = window.innerHeight;
  for (const l of labels) placeLabel(l, w, h);
  for (const l of nextLabels) placeLabel(l, w, h);
}

function placeLabel(l, w, h) {
  const p = l.pos.clone().project(camera);
  if (p.z > 1) { l.el.style.display = 'none'; return; }
  l.el.style.display = '';
  l.el.style.left = ((p.x * 0.5 + 0.5) * w) + 'px';
  l.el.style.top = ((-p.y * 0.5 + 0.5) * h) + 'px';
}

let elapsed = 0; // accumulé à la main via dt (ne PAS utiliser clock.getElapsedTime() : elle rappelle getDelta() en interne et fausserait le pas de temps de la physique)

function tick() {
  const dt = clock ? Math.min(clock.getDelta(), 0.05) : 0;
  elapsed += dt;

  if (isTouchDevice) updateTouchUIVisibility();
  // un overlay plein écran (PNJ/règles/paramètres/succès) doit mettre le
  // déplacement en pause, pas seulement sur tactile (voir
  // updateTouchUIVisibility ci-dessus, qui gère `locked` pour le tactile) —
  // sur desktop, talkToNpc() (game.js) appelle déjà exitPointerLock() donc
  // `locked` retombe tout seul pour le panneau PNJ, mais Règles/Paramètres/
  // Succès (ouvrables en cours de partie depuis la barre d'outils) ne le
  // faisaient pas : sans ce garde-fou on pouvait continuer à marcher sous un
  // panneau plein écran.
  if (locked && !anyOverlayVisible()) {
    // updateJump() tourne TOUJOURS (voir son propre garde-fou interne contre
    // le déclenchement d'un NOUVEAU saut pendant `transitioning`) : la
    // gravité doit rester continue même en traversant une porte, sinon un
    // saut commencé juste avant de franchir la porte laissait le joueur figé
    // en l'air jusqu'à l'arrivée dans la salle suivante.
    updateJump(dt);
    updateDoorSwing(dt);
    if (transitioning) {
      updateGapMovement(dt);
    } else {
      updateRoomMovement(dt);
    }
  }
  updateNpcIdle(elapsed); // même hors pointer-lock : le petit bob des PNJ continue de jouer

  if (renderer && scene && camera) {
    renderer.render(scene, camera);
    updateLabels();
  }
}
