'use strict';

/* Scène 3D en script classique (pas de "type=module") : les modules ES ne se
   chargent pas de manière fiable en file://, donc tout ici — y compris les
   contrôles souris/clavier et les étiquettes — est écrit à la main avec le
   seul objet global THREE (chargé juste avant ce fichier).

   ---- PERFORMANCE ----
   Pas d'antialiasing, résolution de rendu plafonnée, géométries et matériaux
   PARTAGÉS (créés une fois, réutilisés partout — la salle est reconstruite à
   chaque tour), aucune allocation d'objet dans la boucle de déplacement.
   Depuis la passe "réalisme" (2026-08-29) : ombres temps réel réactivées,
   mais limitées à UNE SEULE lumière ombrée par salle (voir buildRoomLight()),
   résolution d'ombre modeste (512²) — le nombre d'objets par salle reste
   petit (une vingtaine de mesh), donc le coût reste contenu malgré les
   ombres. Si le FPS redevient un problème, réduire d'abord la résolution
   d'ombre avant de désactiver les ombres entièrement.

   ---- RÉALISME (2026-08-29) ----
   Matériaux PBR (`MeshStandardMaterial`, rugosité/métallique) au lieu de
   Lambert plat ; texture de bosses/rugosité procédurale générée UNE FOIS via
   canvas (voir buildNoiseTexture()) — aucun fichier externe téléchargé, tout
   reste conforme à la contrainte "pas de modules ES / pas d'assets externes"
   du reste du projet ; mappage d'environnement procédural (PMREMGenerator,
   API cœur de Three.js, aucun addon requis) pour des reflets crédibles sur
   le métal/l'or ; tonemapping filmique (ACES) sur le renderer. Une vraie
   fidélité "Elden Ring" (assets scannés/sculptés à la main par une équipe
   d'artistes professionnels, ray tracing) reste hors de portée d'un
   prototype procédural en navigateur — voir la conversation pour le détail
   de cet arbitrage, discuté avec l'utilisateur avant cette passe. */

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

const WALL_HEIGHT = 3.0;           // assez haut pour qu'un saut à pleine détente (~0.99 unité) reste sous le plafond avec de la marge
const WALL_SEG_MAX_ANGLE = 26;     // subdivision max d'un pan de mur, pour suivre la courbe de la salle
const CEILING_Y = WALL_HEIGHT;     // le plafond rejoint exactement le haut des murs (une vraie pièce close, pas un disque qui flotte)
const CEILING_R = 12;              // généreux : les plafonds de deux salles voisines se recouvrent toujours
const FLOOR_R = WALL_R + 0.3;      // sol intérieur, légèrement plus large que le rayon de collision

const MOVE_SPEED = 6.2;
const LOOK_SENS = 0.0022;
const PITCH_LIMIT = Math.PI / 2 - 0.02;
const EYE_HEIGHT = 1.65;
const GRAVITY = -20;
const JUMP_SPEED = 6.3;
const MAX_HEIGHT_OFFSET = CEILING_Y - EYE_HEIGHT - 0.1; // le saut ne doit jamais faire passer la caméra au-dessus du plafond (sinon on le voit "par en dessous", càd à travers)

const WORLD_R = 40; // rayon du sol extérieur visible brièvement pendant la traversée entre deux salles (aucun décor dessus)

const PATH_ORDER = ['mine', 'canal', 'anti', 'rejet', 'rajeun', 'skip', 'double', 'cashout'];
const DOOR_SLOTS = PATH_ORDER.map((id, i) => ({ id, angle: -DOOR_ARC_HALF + i * (2 * DOOR_ARC_HALF / (PATH_ORDER.length - 1)) }));

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

/* ---- 8 zones : même géométrie de salle partout, mais palette de matériaux,
   ambiance (fond/brouillard) et objets de décor entièrement différents. On
   change de zone (au hasard, jamais la même deux fois de suite) toutes les
   ROOMS_PER_ZONE salles — voir game.js. Les couleurs "wall" s'appliquent
   ensemble aux murs, au plafond ET au sol (une seule teinte par zone, comme
   demandé), "doorFrame" à l'encadrement des portes, "fog"/"bg" à l'ambiance
   générale de la salle. "props" liste les objets de décor tirés au hasard
   dans cette zone (voir PROP_KINDS). */
const ZONE_DEFS = [
  { wall: 0x6e6c64, doorFrame: 0x453f37, fog: 0x2c2a26, bg: 0x201e1b, props: ['barrel', 'crate', 'chain', 'pillar'] },
  { wall: 0x8a5a34, doorFrame: 0x5c3d20, fog: 0x4a3320, bg: 0x2e2015, props: ['barrel', 'crate', 'hay'] },
  { wall: 0xe8dcb8, doorFrame: 0xcf9f3a, fog: 0x8a7548, bg: 0x6b5a38, props: ['statue', 'urn', 'pillar'] },
  { wall: 0x453a5c, doorFrame: 0x8a6fd6, fog: 0x201a30, bg: 0x150f22, props: ['crystal', 'stalagmite'] },
  { wall: 0x5a6b4a, doorFrame: 0x3d5c30, fog: 0x2a3520, bg: 0x1c2416, props: ['vine', 'fern', 'statue'] },
  { wall: 0x2e6b6b, doorFrame: 0x1d4d4d, fog: 0x123030, bg: 0x0c2222, props: ['coral', 'shell', 'chest'] },
  { wall: 0x3a2622, doorFrame: 0x9a3a1e, fog: 0x200e0a, bg: 0x160907, props: ['anvil', 'forgeGlow', 'chain'] },
  { wall: 0xd6ecf2, doorFrame: 0x7ab8d6, fog: 0xa9cdd9, bg: 0x8fb6c4, props: ['icicle', 'frostCrate', 'crystal'] },
];

/* Objets de décor : chaque type combine 1-2 mesh(es) réutilisant des
   géométries/matériaux PARTAGÉS (voir buildSharedAssets) — seule l'instance
   Mesh est créée par salle, jamais la géométrie/le matériau. `hang:true`
   suspend l'objet au plafond plutôt que de le poser au sol. */
const PROP_KINDS = {
  // Pas de rayon de collision codé en dur : la forme/taille de collision est
  // dérivée automatiquement de la géométrie réelle (voir collisionShapeFor())
  // — un cube donne un rectangle EXACT (avec sa rotation), un cylindre/cône/
  // sphère donne un cercle du rayon exact de la géométrie. `hang:true`
  // (chaîne/liane/stalactite, suspendues près du plafond) exclut de toute
  // collision : hors de portée réelle du joueur au sol.
  barrel:     { geo: 'propBarrel', mat: 'propWood',  scale: [1, 1, 1],          y: 0.31 },
  crate:      { geo: 'unitBox',    mat: 'propWood',  scale: [0.55, 0.55, 0.55], y: 0.275 },
  hay:        { geo: 'propBarrel', mat: 'propGold',  scale: [1.15, 0.7, 1.15],  y: 0.2 },
  chain:      { geo: 'propThinCyl', mat: 'propIronDark', scale: [1, 0.9, 1],    y: 0.5, hang: true },
  pillar:     { geo: 'propPillarShaft', mat: 'propStone', scale: [1, 1, 1],     y: WALL_HEIGHT / 2 },
  statue:     { geo: 'propPillarShaft', mat: 'propStone', scale: [0.55, 0.6, 0.55], y: 0.42, extra: 'statueHead' },
  urn:        { geo: 'propBarrel', mat: 'propGold',  scale: [0.55, 0.75, 0.55], y: 0.24 },
  crystal:    { geo: 'propCone',   mat: 'propCrystalMat', scale: [0.6, 1, 0.6], y: 0.4 },
  stalagmite: { geo: 'propCone',   mat: 'propStone', scale: [0.85, 1.25, 0.85], y: 0.42 },
  vine:       { geo: 'propThinCyl', mat: 'propGreen', scale: [1, 1.3, 1],       y: 0.55, hang: true },
  fern:       { geo: 'propCone',   mat: 'propGreen', scale: [0.75, 0.55, 0.75], y: 0.24 },
  coral:      { geo: 'propCone',   mat: 'propCoralMat', scale: [0.7, 0.6, 0.7], y: 0.24 },
  shell:      { geo: 'propSphereSmall', mat: 'propCoralMat', scale: [1, 0.55, 1], y: 0.13 },
  chest:      { geo: 'unitBox',    mat: 'propWood',  scale: [0.7, 0.42, 0.42],  y: 0.21, extra: 'chestBand' },
  anvil:      { geo: 'unitBox',    mat: 'propIronDark', scale: [0.6, 0.35, 0.32], y: 0.3, extra: 'anvilHorn' },
  forgeGlow:  { geo: 'propSphereSmall', mat: 'propGlow', scale: [1.1, 1.1, 1.1], y: 0.24 },
  icicle:     { geo: 'propCone',   mat: 'propIce', scale: [0.7, 1, 0.7],        y: 0, hang: true },
  frostCrate: { geo: 'unitBox',    mat: 'propIce', scale: [0.55, 0.55, 0.55],   y: 0.275 },
};

let renderer, scene, camera, clock;
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
let npcQueue = [];          // PNJ de la salle courante pas encore abordés — voir queueRoomNpcs()
// battants en cours d'animation dans la salle courante : slotId -> { hinge, target }
// target = -SWING_ANGLE (ouvert) ou 0 (fermé) ; updateDoorSwing() fait tendre
// hinge.rotation.y vers `target` à vitesse constante, dans les deux sens —
// permet à un battant de se refermer si le joueur s'en éloigne avant de le
// franchir (voir updateRoomMovement()).
let doorSwingTargets = new Map();
let pendingZoneIdx = 0; // zone de la salle préchargée — appliqué (fond/brouillard) seulement à l'arrivée

// repère (origine + orientation) de la salle où se trouve le joueur
let roomOrigin, roomForward, roomRight;
// repère de la prochaine salle, précalculé dès qu'on pousse une porte
let pendingRoomOrigin, pendingRoomForward, pendingRoomRight;

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
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
    if (document.pointerLockElement !== renderer.domElement) {
      const p = renderer.domElement.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  });

  buildSharedAssets();
  buildStaticScene();

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

function onKeyDown(e) { heldCodes.add(e.code); }
function onKeyUp(e) { heldCodes.delete(e.code); }

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

/* ============================= RESSOURCES PARTAGÉES (créées 1 seule fois) ============================= */

function buildSharedAssets() {
  GEO = {
    door: new THREE.BoxGeometry(DOOR_WIDTH, DOOR_HEIGHT, DOOR_THICKNESS),
    ceiling: new THREE.CircleGeometry(CEILING_R, 20),
    floor: new THREE.CircleGeometry(FLOOR_R, 24),
    unitBox: new THREE.BoxGeometry(1, 1, 1),
    knob: new THREE.SphereGeometry(0.06, 8, 6),
    // ---- PNJ (personnage articulé : jambes/bras/torse/tête + accessoires) ----
    npcLimb: new THREE.CylinderGeometry(0.09, 0.11, 1, 6),
    npcTorso: new THREE.CylinderGeometry(0.24, 0.3, 0.75, 8),
    npcHead: new THREE.SphereGeometry(0.22, 12, 10),
    npcCone: new THREE.ConeGeometry(1, 1, 10),
    // ---- objets de décor (props) ----
    propBarrel: new THREE.CylinderGeometry(0.32, 0.38, 0.62, 10),
    propCone: new THREE.ConeGeometry(0.22, 0.85, 6),
    propSphereSmall: new THREE.SphereGeometry(0.2, 8, 6),
    propPillarShaft: new THREE.CylinderGeometry(0.26, 0.26, WALL_HEIGHT, 8),
    propThinCyl: new THREE.CylinderGeometry(0.05, 0.05, 1.1, 5),
    // ---- lueur des portes bonus (PNJ 2 / PNJ 3) ----
    glowOrb: new THREE.SphereGeometry(0.09, 8, 6),
  };

  MAT = {
    doorAction: new THREE.MeshLambertMaterial({ color: 0xcf9f5a }),
    doorSpecial: new THREE.MeshLambertMaterial({ color: 0xe8b64f }),
    doorBlocked: new THREE.MeshLambertMaterial({ color: 0xa4432f }),
    doorSealed: new THREE.MeshLambertMaterial({ color: 0x4a4034 }),
    doorInset: new THREE.MeshLambertMaterial({ color: 0x3a2e1f }),
    knob: new THREE.MeshLambertMaterial({ color: 0xd4af37 }),
    ground: new THREE.MeshLambertMaterial({ color: 0x5c9a44 }),
    // portes à bonus PNJ (coût énergie réduit / or offert) : couleurs vives et
    // ÉMISSIVES (MeshBasicMaterial, non éclairées : elles restent lumineuses
    // même dans une zone sombre) pour être immédiatement reconnaissables.
    doorBonusEnergy: new THREE.MeshBasicMaterial({ color: 0x5be86a }),
    doorBonusGold: new THREE.MeshBasicMaterial({ color: 0xffd54a }),
    glowEnergy: new THREE.MeshBasicMaterial({ color: 0x8dffa0 }),
    glowGold: new THREE.MeshBasicMaterial({ color: 0xffe98a }),
    // ---- PNJ : couleur d'identité (vêtements) + accessoire propre à chacun ----
    npc1: new THREE.MeshLambertMaterial({ color: 0x5b3a86 }),        // Le Parieur : redingote violette
    npc1Accent: new THREE.MeshLambertMaterial({ color: 0x241a33 }),  // chapeau sombre
    npc2: new THREE.MeshLambertMaterial({ color: 0xb5502a }),        // Le Forgeron : tenue cuivrée
    npc2Accent: new THREE.MeshLambertMaterial({ color: 0x3a2018 }),  // tablier de cuir sombre
    npc3: new THREE.MeshLambertMaterial({ color: 0xd6a63a }),        // Le Changeur d'Or : robe dorée
    npc3Accent: new THREE.MeshLambertMaterial({ color: 0xf1e6a8 }),  // col/bourse crème
    npcSkin: new THREE.MeshLambertMaterial({ color: 0xdba871 }),
    // ---- objets de décor ----
    propWood: new THREE.MeshLambertMaterial({ color: 0x6b4a2a }),
    propStone: new THREE.MeshLambertMaterial({ color: 0x8a8a82 }),
    propGold: new THREE.MeshLambertMaterial({ color: 0xd4af37 }),
    propCrystalMat: new THREE.MeshLambertMaterial({ color: 0x9a7fe6 }),
    propGreen: new THREE.MeshLambertMaterial({ color: 0x4a6b3a }),
    propCoralMat: new THREE.MeshLambertMaterial({ color: 0x2e8a7a }),
    propIronDark: new THREE.MeshLambertMaterial({ color: 0x2a2420 }),
    propGlow: new THREE.MeshBasicMaterial({ color: 0xff9c40 }),
    propIce: new THREE.MeshLambertMaterial({ color: 0xbfe6f2 }),
    // ---- zones : une paire {wall, doorFrame} par zone, créée une seule fois ----
    zones: ZONE_DEFS.map(z => ({
      wall: new THREE.MeshLambertMaterial({ color: z.wall }),
      doorFrame: new THREE.MeshLambertMaterial({ color: z.doorFrame }),
    })),
  };

  // boîtes englobantes calculées UNE SEULE FOIS : c'est sur elles que
  // collisionShapeFor() dérive des hitboxes exactement de la même forme et
  // taille que ce qui est réellement affiché, plutôt que des valeurs
  // approximées à la main.
  ['unitBox', 'propBarrel', 'propCone', 'propSphereSmall', 'propPillarShaft', 'propThinCyl'].forEach(k => {
    GEO[k].computeBoundingBox();
  });
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

  scene.add(new THREE.HemisphereLight(0xdcefff, 0x4c7a3a, 1.15));
  const sun = new THREE.DirectionalLight(0xfff3d6, 0.9);
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
  while (group.children.length) group.remove(group.children[0]);
}

/* Encadrement de la porte : referme ENTIÈREMENT sa baie (réservée sur
   ±DOOR_BAY_HALF_ANGLE, voir buildBoundary) sauf l'ouverture du battant
   lui-même — deux montants qui vont du sol au plafond et rejoignent
   exactement le bord de la baie (même rayon, même angle que les murs
   voisins : aucun écart), plus un linteau plein au-dessus du battant
   jusqu'au plafond. Sans ça il restait un interstice au-dessus de la porte
   et sur ses côtés par lequel on voyait au travers. */
function buildDoorFrame(localAngle, origin, forward, right, zoneIdx) {
  const dir = dirFromLocalAngle(localAngle, forward, right);
  const p = origin.clone().addScaledVector(dir, DOOR_R);
  const group = orientedGroup(p, dir);
  const depth = 0.3;
  const frameMat = MAT.zones[zoneIdx].doorFrame;

  const bayHalfLinear = DOOR_R * Math.tan((DOOR_BAY_HALF_ANGLE * Math.PI) / 180);
  const sideWidth = bayHalfLinear - DOOR_WIDTH / 2;
  const sideCenter = (DOOR_WIDTH / 2 + bayHalfLinear) / 2;

  [1, -1].forEach(s => {
    const side = new THREE.Mesh(GEO.unitBox, frameMat);
    side.scale.set(sideWidth, WALL_HEIGHT, depth);
    side.position.set(sideCenter * s, WALL_HEIGHT / 2, 0);
    group.add(side);
  });

  const lintel = new THREE.Mesh(GEO.unitBox, frameMat);
  lintel.scale.set(bayHalfLinear * 2, WALL_HEIGHT - DOOR_HEIGHT, depth);
  lintel.position.set(0, DOOR_HEIGHT + (WALL_HEIGHT - DOOR_HEIGHT) / 2, 0);
  group.add(lintel);

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

  const panel = new THREE.Mesh(GEO.door, mat);
  panel.position.set(DOOR_WIDTH / 2, DOOR_HEIGHT / 2, 0);
  hinge.add(panel);

  // panneau en relief, sur les deux faces du battant
  const insetOffset = DOOR_THICKNESS / 2 + 0.015;
  [1, -1].forEach(s => {
    const inset = new THREE.Mesh(GEO.unitBox, MAT.doorInset);
    inset.scale.set(DOOR_WIDTH * 0.62, DOOR_HEIGHT * 0.56, 0.03);
    inset.position.set(0, 0, insetOffset * s);
    panel.add(inset);

    const knob = new THREE.Mesh(GEO.knob, MAT.knob);
    knob.position.set(DOOR_WIDTH / 2 - 0.12, -0.05, insetOffset * s + 0.03 * s);
    panel.add(knob);
  });

  const costText = path.kind === 'action' ? `${path.cost} ${path.currency}` : path.desc;
  const html = `<span class="pl-name">${path.name}</span><span class="pl-cost">${costText}</span>`;
  const labelPos = origin.clone().addScaledVector(dir, DOOR_R);
  labelPos.y = DOOR_HEIGHT + 0.5;
  const bonusClass = path.bonusEnergy ? ' bonus-energy' : (path.bonusGold ? ' bonus-gold' : '');
  makeLabel(html, labelPos, (!open ? 'blocked' : '') + (path.kind === 'special' ? ' special' : '') + bonusClass, labelArr);

  return { object: hinge, hinge };
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
  const panel = new THREE.Mesh(GEO.door, MAT.doorSealed);
  panel.position.set(0, DOOR_HEIGHT / 2, 0);
  group.add(panel);
  return group;
}

/* Remplit exactement l'arc [startAngle, endAngle] (en degrés, espace continu —
   endAngle peut dépasser 360 pour un arc qui repasse par l'arrière) avec des
   panneaux de mur pleins, subdivisés pour suivre la courbe. Chaque panneau
   est légèrement SURDIMENSIONNÉ (×1.15) par rapport à sa corde théorique :
   ça crée un léger chevauchement volontaire avec ses voisins plutôt qu'un
   risque d'écart — un mur qui déborde un peu ne se voit pas, un mur qui
   laisse un interstice laisse voir au travers. */
function fillWallArc(group, startAngle, endAngle, origin, forward, right, zoneIdx) {
  const span = endAngle - startAngle;
  if (span <= 0.01) return;
  const n = Math.max(1, Math.ceil(span / WALL_SEG_MAX_ANGLE));
  const step = span / n;
  const chordWidth = 2 * DOOR_R * Math.sin((step * Math.PI) / 360);
  const wallMat = MAT.zones[zoneIdx].wall;
  for (let i = 0; i < n; i++) {
    const mid = startAngle + step * (i + 0.5);
    const dir = dirFromLocalAngle(mid, forward, right);
    const p = origin.clone().addScaledVector(dir, DOOR_R);
    const wallGroup = orientedGroup(p, dir);
    const seg = new THREE.Mesh(GEO.unitBox, wallMat);
    seg.scale.set(chordWidth * 1.15, WALL_HEIGHT, 0.5);
    seg.position.set(0, WALL_HEIGHT / 2, 0);
    wallGroup.add(seg);
    group.add(wallGroup);
  }
}

/* Le mur occupe TOUT le pourtour de la salle sauf les 8 baies de porte
   (±DOOR_BAY_HALF_ANGLE autour de chaque slot — voir buildDoorFrame, qui
   referme le reste de chaque baie) : les 7 arcs entre portes voisines, puis
   le grand arc qui referme le tour par l'arrière. Portes et murs partagent
   le même rayon (DOOR_R) : plus aucun écart, ni radial ni angulaire, entre
   un mur et une porte. */
function buildBoundary(origin, forward, right, zoneIdx) {
  const group = new THREE.Group();
  const H = DOOR_BAY_HALF_ANGLE;
  const bays = DOOR_SLOTS.map(s => ({ start: s.angle - H, end: s.angle + H }));

  for (let i = 0; i < bays.length - 1; i++) {
    fillWallArc(group, bays[i].end, bays[i + 1].start, origin, forward, right, zoneIdx);
  }
  fillWallArc(group, bays[bays.length - 1].end, bays[0].start + 360, origin, forward, right, zoneIdx);

  return group;
}

function buildCeiling(origin, zoneIdx) {
  const ceiling = new THREE.Mesh(GEO.ceiling, MAT.zones[zoneIdx].wall);
  ceiling.rotation.x = Math.PI / 2; // face vers le bas
  ceiling.position.set(origin.x, CEILING_Y, origin.z);
  return ceiling;
}

/* Sol intérieur : disque distinct du sol extérieur (herbe) — sans lui, on
   marchait littéralement sur la même herbe qu'au dehors, ce qui contredisait
   "on n'est pas en extérieur". Légèrement surélevé pour ne pas être rongé
   (z-fighting) par le sol extérieur juste en dessous. Même matériau que les
   murs/plafond de la zone courante : une pièce visuellement uniforme. */
function buildFloor(origin, zoneIdx) {
  const floor = new THREE.Mesh(GEO.floor, MAT.zones[zoneIdx].wall);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(origin.x, 0.015, origin.z);
  return floor;
}

/* Dérive la forme de collision d'un type de prop DIRECTEMENT de sa géométrie
   réelle (boîte englobante × échelle) — jamais une valeur choisie à la main :
   ainsi la hitbox est TOUJOURS exactement de la même forme et taille que ce
   qui est affiché, y compris si les dimensions de la géométrie changent un
   jour. Un cube (`unitBox`) donne un rectangle EXACT (voir `rotY`, appliqué
   plus tard par l'appelant selon la rotation aléatoire du prop) ; les
   géométries à base ronde (cylindre/cône/sphère, toutes à symétrie
   circulaire autour de Y) donnent un cercle de leur rayon réel. */
function collisionShapeFor(def) {
  if (def.hang) return null; // suspendu près du plafond : hors de portée du joueur au sol
  const bb = GEO[def.geo].boundingBox;
  const halfW = ((bb.max.x - bb.min.x) / 2) * def.scale[0];
  const halfD = ((bb.max.z - bb.min.z) / 2) * def.scale[2];
  if (def.geo === 'unitBox') {
    return { type: 'box', halfW, halfD };
  }
  return { type: 'circle', radius: Math.max(halfW, halfD) };
}

/* Un objet de décor (voir PROP_KINDS) — 1 à 2 mesh(es) réutilisant des
   géométries/matériaux partagés, positionné au sol (ou suspendu au plafond
   si `hang`). Une légère rotation aléatoire est appliquée par l'appelant
   pour éviter que tous les objets d'un même type se ressemblent trop. */
function buildProp(kind, p) {
  const def = PROP_KINDS[kind];
  if (!def) return null;
  const group = new THREE.Group();
  group.position.set(p.x, 0, p.z);

  const mesh = new THREE.Mesh(GEO[def.geo], MAT[def.mat]);
  mesh.scale.set(def.scale[0], def.scale[1], def.scale[2]);
  if (def.hang) {
    mesh.rotation.x = Math.PI; // pointe vers le bas
    mesh.position.y = WALL_HEIGHT - 0.05;
  } else {
    mesh.position.y = def.y;
  }
  group.add(mesh);

  if (def.extra === 'statueHead') {
    const head = new THREE.Mesh(GEO.propSphereSmall, MAT.propStone);
    head.position.y = def.y + 0.75;
    group.add(head);
  } else if (def.extra === 'chestBand') {
    const band = new THREE.Mesh(GEO.unitBox, MAT.propIronDark);
    band.scale.set(0.72, 0.08, 0.44);
    band.position.y = def.y;
    group.add(band);
  } else if (def.extra === 'anvilHorn') {
    const horn = new THREE.Mesh(GEO.propCone, MAT.propIronDark);
    horn.scale.set(0.35, 0.5, 0.35);
    horn.rotation.z = Math.PI / 2;
    horn.position.set(0.32, def.y + 0.06, 0);
    group.add(horn);
  }

  return group;
}

/* Éparpille 3 à 5 objets de décor propres à la zone courante dans l'espace
   intérieur libre de la salle, en évitant les baies de porte et les
   emplacements des PNJ (avoidAngles). Retourne aussi la liste des obstacles
   de collision (voir resolveObstacleCollisions()) — chaque objet réellement
   solide bloque désormais le passage. */
function buildProps(zoneIdx, origin, forward, right, avoidAngles) {
  const group = new THREE.Group();
  const obstacles = [];
  const kinds = ZONE_DEFS[zoneIdx].props;
  const count = 3 + Math.floor(Math.random() * 3);
  let placed = 0, attempts = 0;
  // les props sont posés à un rayon bien plus petit (1.0-1.7) que les portes/PNJ
  // (DOOR_R=4.65, NPC_STAND_R=2.2) : une petite marge angulaire suffit à éviter
  // qu'ils paraissent "sous" une porte/un PNJ, pas besoin d'exclure une large bande.
  while (placed < count && attempts < count * 15) {
    attempts++;
    const angle = Math.random() * 360;
    if (avoidAngles.some(a => Math.abs(angleDiff(angle, a)) < 10)) continue;
    const radius = 1.0 + Math.random() * (WALL_R - 1.7);
    const dir = dirFromLocalAngle(angle, forward, right);
    const p = origin.clone().addScaledVector(dir, radius);
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    const def = PROP_KINDS[kind];
    const built = buildProp(kind, p);
    if (!built) continue;
    const rotY = Math.random() * Math.PI * 2;
    built.rotation.y = rotY;
    group.add(built);
    const shape = collisionShapeFor(def);
    if (shape) {
      if (shape.type === 'box') {
        obstacles.push({ type: 'box', x: p.x, z: p.z, halfW: shape.halfW, halfD: shape.halfD, rotY });
      } else {
        obstacles.push({ type: 'circle', x: p.x, z: p.z, radius: shape.radius });
      }
    }
    placed++;
  }
  return { group, obstacles };
}

/* Un PNJ : personnage articulé (jambes, torse, bras, tête) + un accessoire
   propre à son rôle — chapeau de parieur, tablier de forgeron, bourse de
   changeur — planté à un emplacement fixe de l'arc arrière. Tous les PNJ
   présents dans une salle sont abordés automatiquement dès qu'on y entre
   (voir queueRoomNpcs()) : on ne peut donc jamais en manquer un, quelle que
   soit la direction dans laquelle on marche ensuite. */
function buildNpc(id, localAngle, origin, forward, right, labelArr) {
  const dir = dirFromLocalAngle(localAngle, forward, right);
  const p = origin.clone().addScaledVector(dir, NPC_STAND_R);
  const group = orientedGroup(p, dir);
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

  const html = `<span class="pl-name">${NPC_NAMES[id]}</span><span class="pl-cost">Marchez jusqu'à lui</span>`;
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

function buildRoomInto(group, labelArr, origin, forward, right) {
  clearGroup(group, labelArr);
  const paths = (typeof window.getCurrentPaths === 'function' ? window.getCurrentPaths() : []);
  const presentNpcs = (typeof window.getCurrentNpcs === 'function' ? window.getCurrentNpcs() : []);
  const zone = (typeof window.getCurrentZone === 'function') ? window.getCurrentZone() : null;
  const zoneIdx = zone ? zone.index : 0;
  const closed = new Set();

  DOOR_SLOTS.forEach(slot => {
    const p = paths.find(x => x.id === slot.id);
    if (p) {
      const built = buildDoor(p, slot.angle, origin, forward, right, labelArr);
      group.add(built.object);
      if (!p.affordable) closed.add(slot.id);
      built.hinge.userData.slotId = slot.id;
      if (p.affordable && p.bonusEnergy) group.add(buildBonusGlow('energy', slot.angle, origin, forward, right));
      else if (p.affordable && p.bonusGold) group.add(buildBonusGlow('gold', slot.angle, origin, forward, right));
    } else {
      group.add(buildSealedDoor(slot.angle, origin, forward, right));
      closed.add(slot.id);
    }
    group.add(buildDoorFrame(slot.angle, origin, forward, right, zoneIdx));
  });
  group.add(buildBoundary(origin, forward, right, zoneIdx));
  group.add(buildCeiling(origin, zoneIdx));
  group.add(buildFloor(origin, zoneIdx));

  const avoidAngles = DOOR_SLOTS.map(s => s.angle).concat(NPC_SLOTS.map(s => s.angle));
  const propsBuilt = buildProps(zoneIdx, origin, forward, right, avoidAngles);
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

  return { closed, npcSlots, zoneIdx, obstacles };
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
    nextRoomReady = true;
  } else {
    const built = buildRoomInto(roomGroup, labels, roomOrigin, roomForward, roomRight);
    closedSlots = built.closed;
    roomNpcSlots = built.npcSlots;
    roomObstacles = built.obstacles;
    doorSwingTargets = new Map();
    applyZoneAtmosphere(built.zoneIdx);
    queueRoomNpcs();
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

  const accepted = typeof window.choosePath === 'function' ? window.choosePath(slot.id) : false;
  if (!accepted) {
    // repli de sécurité : rien n'a été validé côté jeu, on annule la transition
    transitioning = false;
    return false;
  }

  // repli : si l'ouverture anticipée (voir maybeTriggerDoorSwing) n'a pour une
  // raison quelconque pas eu lieu, on la déclenche maintenant (idempotent).
  maybeTriggerDoorSwing(slot.id);

  return true;
}

function enterPlayMode() {
  if (!started) initThree();
  document.getElementById('playArea').hidden = false;
}

function exitPlayMode() {
  if (document.pointerLockElement) document.exitPointerLock();
  document.getElementById('playArea').hidden = true;
  // sécurité : ne jamais laisser une transition "en cours" traîner d'une partie à l'autre
  transitioning = false;
  nextRoomReady = false;
  doorSwingTargets = new Map();
  npcQueue = [];
}

window.regenerateHub = regenerateHub;
window.enterPlayMode = enterPlayMode;
window.exitPlayMode = exitPlayMode;

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
      if (entry.target === 0) doorSwingTargets.delete(slotId); // fermée : plus besoin de la suivre
    } else {
      entry.hinge.rotation.y = current + Math.sign(diff) * maxStep;
    }
  }
}

function updateJump(dt) {
  if (isDown('jump') && heightOffset <= 0.001 && velocityY <= 0) {
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
  // — donc "voir à travers" — puisque son revers n'est jamais dessiné)
  if (heightOffset > MAX_HEIGHT_OFFSET) { heightOffset = MAX_HEIGHT_OFFSET; if (velocityY > 0) velocityY = 0; }
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

/* Empêche de traverser les objets de décor et les PNJ (collision cercle-
   cercle simple, dans le plan XZ) — appliqué juste après le déplacement
   brut, avant le clamp mur/porte qui suit. */
/* Point le plus proche du joueur sur un rectangle ORIENTÉ (dans le plan XZ) —
   ramène le joueur dans le repère local du rectangle (annule sa rotation),
   pince aux demi-étendues, puis repasse le résultat en coordonnées monde.
   Nécessaire pour que les props en forme de boîte (caisses/coffres/etc,
   tournés aléatoirement) aient une hitbox qui suit vraiment leur rotation
   affichée, pas juste un cercle approximatif. */
/* Convention de rotation.y de THREE.js vérifiée EMPIRIQUEMENT (comme pour
   lookAt() ailleurs dans ce fichier — ne jamais la déduire par le
   raisonnement seul) : pour un objet tourné de θ autour de Y, l'axe local
   +X finit en (cos θ, -sin θ) en coordonnées monde — PAS (cos θ, sin θ)
   comme le donnerait une rotation 2D "standard". D'où le signe de `sin` ici
   (monde -> local) et dans le retour (local -> monde), qui diffèrent de la
   formule naïve. */
function closestPointOnOBB(px, pz, ob) {
  const dx = px - ob.x, dz = pz - ob.z;
  const cos = Math.cos(ob.rotY), sin = Math.sin(ob.rotY);
  const lx = dx * cos - dz * sin;
  const lz = dx * sin + dz * cos;
  const cx = Math.max(-ob.halfW, Math.min(ob.halfW, lx));
  const cz = Math.max(-ob.halfD, Math.min(ob.halfD, lz));
  return { x: cx * cos + cz * sin + ob.x, z: -cx * sin + cz * cos + ob.z };
}

function resolveObstacleCollisions() {
  for (const ob of roomObstacles) {
    let closestX, closestZ, extraRadius;
    if (ob.type === 'box') {
      const c = closestPointOnOBB(camera.position.x, camera.position.z, ob);
      closestX = c.x; closestZ = c.z; extraRadius = 0;
    } else {
      closestX = ob.x; closestZ = ob.z; extraRadius = ob.radius;
    }
    const dx = camera.position.x - closestX;
    const dz = camera.position.z - closestZ;
    const minDist = PLAYER_RADIUS + extraRadius;
    const distSq = dx * dx + dz * dz;
    if (distSq < minDist * minDist && distSq > 1e-6) {
      const dist = Math.sqrt(distSq);
      const push = minDist - dist;
      camera.position.x += (dx / dist) * push;
      camera.position.z += (dz / dist) * push;
    }
  }
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
  if (forwardInput === 0 && rightInput === 0) return;
  tickFootsteps(dt, true);

  _forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  _right.set(Math.cos(yaw), 0, -Math.sin(yaw));
  camera.position.addScaledVector(_forward, forwardInput * MOVE_SPEED * dt);
  camera.position.addScaledVector(_right, rightInput * MOVE_SPEED * dt);
  resolveObstacleCollisions();

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
    if (r >= DOOR_R) commitDoor(nearest.slot);
  } else if (r > WALL_R) {
    const rad = (localAngle * Math.PI) / 180;
    _dir.copy(roomForward).multiplyScalar(Math.cos(rad)).addScaledVector(roomRight, Math.sin(rad));
    camera.position.x = roomOrigin.x + _dir.x * WALL_R;
    camera.position.z = roomOrigin.z + _dir.z * WALL_R;
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

/* Aborde automatiquement, un par un, tous les PNJ présents dans la salle qui
   vient de devenir la salle courante — appelé au moment même où elle le
   devient (voir regenerateHub()/updateGapMovement()), PAS en fonction de la
   position du joueur : ainsi aucun PNJ présent ne peut jamais être manqué,
   quelle que soit la direction empruntée ensuite. S'il y en a plusieurs, le
   suivant se déclenche quand la fenêtre du précédent est fermée (voir
   window.advanceNpcQueue, appelé par game.js). */
function queueRoomNpcs() {
  npcQueue = roomNpcSlots.map(n => n.id);
  advanceNpcQueue();
}

function advanceNpcQueue() {
  if (npcQueue.length === 0) return;
  const id = npcQueue.shift();
  if (typeof window.talkToNpc === 'function') window.talkToNpc(id);
}
window.advanceNpcQueue = advanceNpcQueue;

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

  _rel.set(camera.position.x - doorPoint.x, 0, camera.position.z - doorPoint.z);
  const progress = _rel.dot(transitionDir);
  const limit = nextRoomReady ? ROOM_GAP : Math.max(0, ROOM_GAP - HOLD_BACK);
  if (progress > limit) {
    const excess = progress - limit;
    camera.position.addScaledVector(transitionDir, -excess);
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
    doorSwingTargets = new Map();
    applyZoneAtmosphere(pendingZoneIdx);
    queueRoomNpcs();

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

  if (locked) {
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
