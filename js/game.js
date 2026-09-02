'use strict';

/* ============================= CONSTANTES ============================= */

// Plusieurs parties indépendantes possibles (comme Hades/Isaac/Minecraft),
// demandé explicitement : "on choisit dans quelle de ses parties on joue...
// on peut créer une nouvelle partie avec progression de base à 0 ou
// supprimer des parties". Chaque partie a sa PROPRE progression permanente
// (meta) et son PROPRE état en cours (run), sous des clés localStorage
// distinctes par id de partie — voir slotSaveKey()/slotRunKey() plus bas.
// SLOTS_INDEX_KEY liste les parties existantes (léger : juste de quoi les
// afficher sur l'écran de sélection sans devoir charger chaque meta/run en
// entier). LEGACY_* sont les anciennes clés FIXES d'avant ce système (une
// seule partie possible) — voir migrateLegacySaveIfNeeded().
const SLOTS_INDEX_KEY = 'avidite_slots_v1';
const LEGACY_SAVE_KEY = 'avidite_save_v1';
const LEGACY_RUN_KEY = 'avidite_run_v1';
function slotSaveKey(id) { return 'avidite_save_v1_' + id; }
function slotRunKey(id) { return 'avidite_run_v1_' + id; }
const BASE_FACES = 50;
const BASE_ENERGY = 10;

const ACTION_BASE_COST = { mine: 4, canal: 12, anti: 7, rejet: 30, rajeun: 10 };

const ACTIONS = [
  { key: 'mine', get name() { return t('action.mine.name'); },
    desc: () => t('action.mine.desc') },
  { key: 'canal', get name() { return t('action.canal.name'); },
    desc: () => t('action.canal.desc') },
  { key: 'anti', get name() { return t('action.anti.name'); },
    desc: () => t('action.anti.desc') },
  { key: 'rejet', get name() { return t('action.rejet.name'); },
    desc: () => t('action.rejet.desc') },
  { key: 'rajeun', get name() { return t('action.rajeun.name'); },
    desc: () => t('action.rajeun.desc') },
];

/* Chemins pouvant recevoir une porte bonus PNJ (coût réduit/négatif ou or
   offert) — les 5 actions ET les deux chemins spéciaux gratuits, qui n'ont
   pas de coût de base à réduire : le bonus s'y ajoute directement (voir
   applySpecialBonusDoor()) au lieu de réduire un coût existant. */
const BONUS_DOOR_POOL = [...ACTIONS.map(a => a.key), 'double', 'skip'];

/* Le Sanctuaire n'existe plus : ses améliorations permanentes sont
   remplacées par 3 PNJ qu'on peut croiser (et à qui on peut parler en
   marchant jusqu'à eux) dans les salles — voir NPC_NAMES et la section
   PNJ plus bas. Chaque PNJ a 1.3% de chance d'apparaître dans une salle
   donnée (indépendamment des deux autres), sauf boost ponctuel du PNJ 1. */
const NPC_IDS = ['npc1', 'npc2', 'npc3'];
function npcName(id) { return t('npc.' + id + '.name'); }
window.npcName = npcName; // utilisé par scene3d.js pour l'étiquette 3D au-dessus du PNJ
const NPC_BASE_CHANCE = 0.013;
const NPC_CHANCE_BOOST_MULT = 20;
const NPC1_PICKS_PER_EXTRA_OFFER = 10;

// Micro-dialogue narratif des PNJ (voir talkToNpc()/i18n.js `npcX.dialogue.N`) :
// 5 étapes fixes (index 0 à 4) par PNJ, du "il connaît bien cette aventure"
// au "j'espère que tu iras plus loin que moi" — jamais plus, jamais moins,
// pour rester un petit arc narratif maîtrisé plutôt qu'un flux sans fin.
const NPC_DIALOGUE_MAX = 4;
function npcDialogueLine(npcId) {
  const idx = meta.npc[npcId + 'DialogueIndex'];
  return idx >= 0 ? t(npcId + '.dialogue.' + idx) : '';
}

/* 8 zones visuelles (décor différent : murs, sol/plafond, objets de salle,
   ambiance) — le rendu de chacune est entièrement géré par scene3d.js
   (ZONE_DEFS), game.js ne suit que l'index courant. Toutes les 200 salles
   traversées, on bascule sur une autre zone tirée au hasard. */
const ZONE_COUNT = 8;
function zoneName(idx) { return t('zone.' + idx); }
const ROOMS_PER_ZONE = 200;

/* Les 8 chemins possibles à un carrefour : 5 actions + 3 spéciaux.
   Leur disposition dans l'espace (angles, largeur de salle) est entièrement
   gérée par scene3d.js — game.js ne connaît que les identifiants. */
const PATH_IDS = ['mine', 'canal', 'anti', 'rejet', 'rajeun', 'skip', 'double', 'cashout'];

/* Raccourcis clavier : uniquement le déplacement (marcher jusqu'à un chemin
   pour le choisir, ou sauter). Stockés en `.code` (position physique de la
   touche), ce qui fait marcher WASD et ZQSD indifféremment selon la disposition. */
const DEFAULT_MOVE_KEYS = { forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space' };
const MOVE_KEY_ORDER = ['forward', 'back', 'left', 'right', 'jump'];
function moveKeyLabel(dir) { return t('moveKey.' + dir); }

const DICE_SPEEDS = {
  lente: { mult: 1.6 },
  normale: { mult: 1 },
  rapide: { mult: 0.5 },
  instant: { mult: 0.12 },
};
const SPIN_BASE_MS = 1150;
const HOLD_BASE_MS = 1000;

/* ============================= ETAT ============================= */

// aucune partie active tant que le joueur n'en a pas choisi une sur l'écran
// de sélection (voir showSlotsScreen()/enterSlot()) — meta reste un simple
// gabarit par défaut jusque-là (loadMeta()/saveMeta() n'écrivent jamais tant
// qu'aucune partie n'est active, voir plus bas).
let activeSlotId = null;
let meta = defaultMeta();
let run = null;
let rebindListenerActive = false;

function defaultMeta() {
  return {
    gold: 0,
    // zone visuelle courante, persistée pour qu'un rechargement de page (F5,
    // ou fermer/rouvrir) retrouve le même décor plutôt que d'en retirer un
    // au hasard — demandé explicitement. Tout le reste de `run` (dé, or de
    // partie, énergie...) recommence à zéro comme avant : seule la zone/le
    // décor doit survivre à un rechargement.
    zoneIndex: Math.floor(Math.random() * ZONE_COUNT),
    roomsInZone: 0,
    lvl: { extraFaces: 0, turn1Energy: 0 },
    npc: {
      npc1Picks: 0,          // compteur permanent cumulé de choix pris chez le PNJ 1
      npc2DoorUnlocked: false, // porte "énergie réduite" débloquée (magnitude 0 tant que non améliorée)
      npc2DoorBonus: 0,        // réduction actuelle (peut rendre le coût négatif = don d'énergie)
      npc2BoostDoorCost: 300,  // +20% après chaque achat
      npc2RerollPct: 0,        // % de chance de relancer automatiquement un 1
      npc2RerollCost: 4,       // +20% après chaque achat
      npc3DoorUnlocked: false, // porte "donne de l'or" débloquée (magnitude 0 tant que non améliorée)
      npc3DoorBonus: 0,        // or banqué gagné en traversant cette porte
      npc3BoostDoorCost: 700,  // +20% après chaque achat
      npc3ExtraFacesCost: 30,  // +20% après chaque achat
      npc3Turn1EnergyCost: 20, // +20% après chaque achat
      // ---- micro-dialogue narratif (voir NPC_DIALOGUE_MAX / talkToNpc()) ----
      // -1 = aucune ligne encore vue. Avance d'1 cran (jusqu'à
      // NPC_DIALOGUE_MAX) à chaque PREMIÈRE interaction dans une NOUVELLE
      // salle (jamais en reparlant plusieurs fois dans la même salle) —
      // permanent, indépendant des parties, pour une progression étalée sur
      // de nombreuses rencontres plutôt que consommée d'un coup.
      npc1DialogueIndex: -1,
      npc2DialogueIndex: -1,
      npc3DialogueIndex: -1,
    },
    // ---- statistiques permanentes (menu Records) ----
    stats: {
      maxEnergy: 0,
      maxTurnsPassed: 0,   // record de salles parcourues sans réinitialisation du dé
      maxOnesRerolledInRun: 0, // le plus de "1" relancés (token Rejet ou % PNJ 2) cumulés en une seule partie — voir endTurn()
      totalGoldBanked: 0,      // or total banqué (cashout + portes bonus PNJ 3), toutes parties confondues — voir bankGold()
      maxRunGold: 0,       // "or de partie" (effectiveGold()) maximal jamais atteint
    },
    moveKeys: { ...DEFAULT_MOVE_KEYS },
    diceSpeed: 'normale',
    sfxVolume: 0.6,
    lang: (typeof LANG_DEFAULT !== 'undefined') ? LANG_DEFAULT : 'fr',
    // "mode assisté" : activé par défaut (aide un joueur qui découvre le
    // jeu), se désactive tout seul dès le premier reset du dé (voir
    // endTurn()) — demandé explicitement. Reste désactivé ensuite tant que
    // le joueur ne le réactive pas lui-même dans les Paramètres.
    assistMode: true,
  };
}

function loadMeta() {
  if (!activeSlotId) return defaultMeta();
  try {
    const raw = localStorage.getItem(slotSaveKey(activeSlotId));
    if (!raw) return defaultMeta();
    const parsed = JSON.parse(raw);
    const d = defaultMeta();
    return {
      gold: typeof parsed.gold === 'number' ? parsed.gold : d.gold,
      zoneIndex: (typeof parsed.zoneIndex === 'number' && parsed.zoneIndex >= 0 && parsed.zoneIndex < ZONE_COUNT) ? parsed.zoneIndex : d.zoneIndex,
      roomsInZone: typeof parsed.roomsInZone === 'number' ? parsed.roomsInZone : d.roomsInZone,
      lvl: {
        extraFaces: (parsed.lvl && typeof parsed.lvl.extraFaces === 'number') ? parsed.lvl.extraFaces : d.lvl.extraFaces,
        turn1Energy: (parsed.lvl && typeof parsed.lvl.turn1Energy === 'number') ? parsed.lvl.turn1Energy : d.lvl.turn1Energy,
      },
      npc: { ...d.npc, ...(parsed.npc || {}) },
      stats: { ...d.stats, ...(parsed.stats || {}) },
      moveKeys: { ...d.moveKeys, ...(parsed.moveKeys || {}) },
      diceSpeed: DICE_SPEEDS[parsed.diceSpeed] ? parsed.diceSpeed : d.diceSpeed,
      sfxVolume: typeof parsed.sfxVolume === 'number' ? parsed.sfxVolume : d.sfxVolume,
      lang: (typeof LANGS !== 'undefined' && LANGS.includes(parsed.lang)) ? parsed.lang : d.lang,
      assistMode: typeof parsed.assistMode === 'boolean' ? parsed.assistMode : d.assistMode,
    };
  } catch (e) {
    return defaultMeta();
  }
}

function saveMeta() {
  if (!activeSlotId) return; // pas de partie active (écran de sélection) : ne jamais écrire dans le vide
  localStorage.setItem(slotSaveKey(activeSlotId), JSON.stringify(meta));
}

/* Sauvegarde la partie EN COURS (tour, dé, énergie, or, salle exacte...),
   pas seulement la progression permanente (meta) — demandé explicitement :
   "si on était au tour 20 et que le dé a 30 faces max, ces informations sont
   enregistrées". `getCurrentPaths()`/`getCurrentNpcs()` (voir plus bas) sont
   des fonctions PURES de `run` (aucun tirage aléatoire à l'affichage — tout
   ce qui est aléatoire, ex. `roomNpcs`/`npc2BonusDoor`, est tiré UNE FOIS
   dans startNewTurn() et stocké dans `run`) : sauvegarder `run` tel quel
   suffit donc à reconstruire exactement la même salle au rechargement, pas
   besoin de sérialiser la salle séparément. Appelée depuis render() (voir
   plus bas), donc à chaque changement d'état visible — jamais depuis la
   boucle 3D par frame. */
function saveRun() {
  if (run && activeSlotId) localStorage.setItem(slotRunKey(activeSlotId), JSON.stringify(run));
}

function loadRun() {
  if (!activeSlotId) return null;
  try {
    const raw = localStorage.getItem(slotRunKey(activeSlotId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // une partie qui s'est terminée (perdue) ne doit pas "reprendre" morte —
    // repli sur une partie neuve dans ce cas, comme s'il n'y avait rien à charger.
    if (!parsed || parsed.alive === false || parsed.ended === true) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

/* ============================= PARTIES (SLOTS) ============================= */

function loadSlotsIndex() {
  try {
    const raw = localStorage.getItem(SLOTS_INDEX_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) return parsed;
  } catch (e) { /* repli sur liste vide plus bas */ }
  return [];
}
function saveSlotsIndex(slots) {
  localStorage.setItem(SLOTS_INDEX_KEY, JSON.stringify(slots));
}

/* Avant ce système, une seule partie possible sous des clés FIXES
   (LEGACY_SAVE_KEY/LEGACY_RUN_KEY). Si elles existent encore et qu'aucune
   partie n'a jamais été créée dans le nouveau système, les convertit en
   Partie 1 automatiquement — une seule fois — pour ne jamais perdre la
   progression déjà là ("ne casse pas la sauvegarde"). */
function migrateLegacySaveIfNeeded() {
  const slots = loadSlotsIndex();
  if (slots.length > 0) return slots;
  const legacyMeta = localStorage.getItem(LEGACY_SAVE_KEY);
  const legacyRun = localStorage.getItem(LEGACY_RUN_KEY);
  if (!legacyMeta && !legacyRun) return slots;
  const id = 'slot_' + Date.now();
  if (legacyMeta) localStorage.setItem(slotSaveKey(id), legacyMeta);
  if (legacyRun) localStorage.setItem(slotRunKey(id), legacyRun);
  localStorage.removeItem(LEGACY_SAVE_KEY);
  localStorage.removeItem(LEGACY_RUN_KEY);
  const newSlots = [{ id, number: 1, createdAt: Date.now(), updatedAt: Date.now() }];
  saveSlotsIndex(newSlots);
  return newSlots;
}

/* Écran affiché au chargement de la page (voir init()) ET accessible en
   cours de partie via le bouton "Menu" de la barre d'outils — demandé
   explicitement : choisir/créer/supprimer une partie, comme Hades/Isaac/
   Minecraft. Mettre en pause : libère le curseur et masque le jeu, sans
   jamais détruire la scène 3D déjà construite (elle sera juste régénérée
   avec l'état de la prochaine partie choisie, voir enterSlot()). */
function showSlotsScreen() {
  if (document.pointerLockElement) document.exitPointerLock();
  const playArea = document.getElementById('playArea');
  if (playArea) playArea.hidden = true;
  document.getElementById('toolbar').hidden = true;
  renderSlotsScreen();
  document.getElementById('slotsScreen').hidden = false;
}

function renderSlotsScreen() {
  const slots = migrateLegacySaveIfNeeded();
  const list = document.getElementById('slotsList');
  list.innerHTML = '';
  if (!slots.length) {
    const p = document.createElement('p');
    p.className = 'slots-empty';
    p.textContent = t('slots.empty');
    list.appendChild(p);
  }
  slots.slice().sort((a, b) => b.updatedAt - a.updatedAt).forEach(slot => {
    let slotMeta = null, slotRun = null;
    try { slotMeta = JSON.parse(localStorage.getItem(slotSaveKey(slot.id))); } catch (e) { /* repli plus bas */ }
    try { slotRun = JSON.parse(localStorage.getItem(slotRunKey(slot.id))); } catch (e) { /* repli plus bas */ }
    const gold = slotMeta ? slotMeta.gold : 0;
    const turn = slotRun ? slotRun.turn : 0;
    const zone = (slotMeta && typeof slotMeta.zoneIndex === 'number') ? zoneName(slotMeta.zoneIndex) : '';

    const card = document.createElement('div');
    card.className = 'slot-card';
    card.innerHTML = `
      <div class="slot-info">
        <span class="slot-name">${t('slots.label', { n: slot.number })}</span>
        <span class="slot-stats">${t('slots.stats', { gold, turn, zone })}</span>
      </div>
      <div class="slot-actions">
        <button class="accept-btn slot-continue-btn">${t('slots.continue')}</button>
        <button class="slot-delete-btn" title="${t('slots.deleteConfirm', { n: slot.number })}">✕</button>
      </div>
    `;
    card.addEventListener('click', () => enterSlot(slot.id));
    card.querySelector('.slot-delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(t('slots.deleteConfirm', { n: slot.number }))) deleteSlot(slot.id);
    });
    list.appendChild(card);
  });
}

function createNewSlot() {
  const slots = loadSlotsIndex();
  const nextNumber = slots.length ? Math.max(...slots.map(s => s.number)) + 1 : 1;
  const id = 'slot_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
  slots.push({ id, number: nextNumber, createdAt: Date.now(), updatedAt: Date.now() });
  saveSlotsIndex(slots);
  enterSlot(id);
}

function deleteSlot(id) {
  localStorage.removeItem(slotSaveKey(id));
  localStorage.removeItem(slotRunKey(id));
  saveSlotsIndex(loadSlotsIndex().filter(s => s.id !== id));
  renderSlotsScreen();
}

/* Rend la partie `id` active et lance le jeu — seul point d'entrée en
   gameplay (remplace l'ancien démarrage automatique). */
function enterSlot(id) {
  activeSlotId = id;
  meta = loadMeta();
  saveMeta();
  applyDiceSpeed();
  document.documentElement.lang = meta.lang;
  if (window.applyStaticI18n) applyStaticI18n();

  const slots = loadSlotsIndex();
  const idx = slots.findIndex(s => s.id === id);
  if (idx >= 0) { slots[idx].updatedAt = Date.now(); saveSlotsIndex(slots); }

  const resuming = !!loadRun();
  // nouvelle partie (jamais jouée, ou reprise d'une partie qui s'est
  // terminée) : si une AUTRE partie a déjà tourné dans cette page, la scène
  // 3D garde le souvenir d'avoir déjà franchi une porte — sans ce reset, la
  // toute première salle de cette partie-ci afficherait à tort une porte
  // d'entrée (voir resetRoomEntryState() dans scene3d.js).
  if (!resuming && window.resetRoomEntryState) window.resetRoomEntryState();

  document.getElementById('slotsScreen').hidden = true;
  document.getElementById('toolbar').hidden = false;
  newRun();
}

function newRun() {
  const saved = loadRun();
  if (saved) {
    run = saved;
  } else {
    run = {
      turn: 0,
      turnsPassed: 0,
      energy: 0,
      gold: 0,
      costs: { ...ACTION_BASE_COST },
      canalBonus: 0,
      rajeunBonus: 0,
      antiCharges: 0,
      rerollTokens: 0,
      onesRerolledThisRun: 0, // cumul des "1" relancés (token Rejet ou % PNJ 2) depuis le début de CETTE partie — voir endTurn()/RECORD "le plus de 1 relancés"
      pendingMines: [],
      usedDouble: false,
      alive: true,
      ended: false,
      rolling: false,
      // ---- PNJ (état propre à cette partie) ----
      npc1FaceDelta: 0,          // ajustement (peut être négatif) du nombre de faces, offert par le PNJ 1
      npc1RemainingPicks: 0,     // choix restants pour la visite en cours chez le PNJ 1
      npc1VisitedThisRoom: false, // vrai dès le premier talkToNpc('npc1') de cette salle — voir startNewTurn()/talkToNpc()
      npc2VisitedThisRoom: false, // idem, pour la progression du micro-dialogue uniquement (voir talkToNpc())
      npc3VisitedThisRoom: false,
      npc2BonusDoor: null,       // id de l'action dont le coût est réduit cette salle (ou null)
      npc3BonusDoor: null,       // id de l'action qui rapporte de l'or banqué cette salle (ou null)
      npcChanceBoostNextRoom: false, // consommé par startNewTurn() pour la salle suivante seulement
      roomNpcs: [],               // PNJ présents dans la salle courante
      // ---- zone visuelle : reprise de meta (persistée), PAS retirée au hasard
      // à chaque partie — voir defaultMeta()/loadMeta() et le compteur dans
      // startNewTurn() qui la met à jour dans meta au fil du jeu. ----
      zoneIndex: meta.zoneIndex,
      roomsInZone: meta.roomsInZone,
    };
  }
  if (window.enterPlayMode) window.enterPlayMode();
  if (saved) {
    // salle déjà connue (restaurée telle quelle) : on la reconstruit sans
    // repasser par startNewTurn(), qui avancerait le tour et tirerait une
    // NOUVELLE salle au hasard au lieu de reprendre exactement la même.
    if (window.markRoomAlreadyEntered) window.markRoomAlreadyEntered();
    render();
    if (window.regenerateHub) window.regenerateHub();
  } else {
    startNewTurn();
  }
}

/* ============================= LOGIQUE DE JEU ============================= */

function currentFaces() {
  return Math.max(1, BASE_FACES + meta.lvl.extraFaces + run.rajeunBonus + run.npc1FaceDelta - run.turnsPassed);
}

function effectiveGold() {
  // multiplicateur = nombre de tours/salles traversés, jamais 0 ; repart à 1
  // avec turnsPassed quand la roue affiche 1 (voir endTurn()).
  return run.gold * (run.turnsPassed + 1);
}

function rollJudgmentDie(faces) {
  if (run.antiCharges > 0 && faces > 1) {
    run.antiCharges -= 1;
    return 2 + Math.floor(Math.random() * (faces - 1)); // uniforme sur [2, faces] : jamais 1
  }
  return 1 + Math.floor(Math.random() * faces); // uniforme sur [1, faces]
}

function startNewTurn() {
  // faire mûrir les mines en attente
  const matured = [];
  run.pendingMines.forEach(m => m.left--);
  run.pendingMines = run.pendingMines.filter(m => {
    if (m.left <= 0) { matured.push(m); return false; }
    return true;
  });
  if (matured.length) {
    run.gold += matured.length;
  }

  run.turn++;
  let energyGain = BASE_ENERGY + run.canalBonus;
  if (run.turn === 1) energyGain += meta.lvl.turn1Energy; // PNJ 3 : bonus d'énergie au 1er tour
  run.energy += energyGain;

  // nouvelle salle = nouvelle visite possible chez le PNJ 1 (voir talkToNpc()) :
  // un plein jeu de choix gratuits, mais une seule fois par salle même si on
  // lui reparle plusieurs fois — demandé explicitement.
  run.npc1VisitedThisRoom = false;
  // même principe pour les 2 autres PNJ, uniquement pour la progression du
  // micro-dialogue (voir talkToNpc()) — pas de mécanique de jeu associée
  // pour eux, contrairement au PNJ 1.
  run.npc2VisitedThisRoom = false;
  run.npc3VisitedThisRoom = false;

  // toutes les ROOMS_PER_ZONE (200) salles traversées, bascule sur une autre zone
  // au hasard (jamais la même) — le compteur ne dépend PAS de turnsPassed : perdre
  // sur un "1" ne fait pas reculer la progression d'exploration.
  run.roomsInZone++;
  if (run.roomsInZone >= ROOMS_PER_ZONE) {
    let next = run.zoneIndex;
    if (ZONE_COUNT > 1) {
      while (next === run.zoneIndex) next = Math.floor(Math.random() * ZONE_COUNT);
    }
    run.zoneIndex = next;
    run.roomsInZone = 0;
  }
  // persisté à chaque tour (pas seulement au changement de zone) : le compteur
  // roomsInZone doit lui aussi survivre à un rechargement, sinon on repartirait
  // toujours à 0 dans la même zone au lieu de continuer la progression réelle.
  meta.zoneIndex = run.zoneIndex;
  meta.roomsInZone = run.roomsInZone;
  saveMeta();

  // porte(s) bonus de cette salle, si les mécaniques PNJ correspondantes sont
  // débloquées — inclut aussi "Ne rien faire"/"Doubler l'énergie" (les deux
  // n'ont normalement pas de coût : le bonus s'ajoute alors directement, voir
  // applySpecialBonusDoor()).
  run.npc2BonusDoor = meta.npc.npc2DoorUnlocked ? BONUS_DOOR_POOL[Math.floor(Math.random() * BONUS_DOOR_POOL.length)] : null;
  run.npc3BonusDoor = meta.npc.npc3DoorUnlocked ? BONUS_DOOR_POOL[Math.floor(Math.random() * BONUS_DOOR_POOL.length)] : null;

  // quels PNJ se trouvent dans cette nouvelle salle (1.3% chacun, indépendamment ;
  // ×20 si le PNJ 1 a offert le bonus de flair pour LA prochaine salle uniquement)
  const npcChance = NPC_BASE_CHANCE * (run.npcChanceBoostNextRoom ? NPC_CHANCE_BOOST_MULT : 1);
  run.npcChanceBoostNextRoom = false;
  run.roomNpcs = NPC_IDS.filter(() => Math.random() < npcChance);

  saveMeta();

  render();
  if (window.regenerateHub) window.regenerateHub();
}

function effectiveActionCost(key) {
  let cost = run.costs[key];
  if (key === run.npc2BonusDoor) cost -= meta.npc.npc2DoorBonus;
  return cost;
}

function canAffordAction(key) {
  return run.energy >= effectiveActionCost(key);
}

function applyAction(key) {
  const cost = effectiveActionCost(key);
  run.energy -= cost; // le coût peut être négatif (porte du PNJ 2) : l'énergie augmente alors

  switch (key) {
    case 'mine':
      run.pendingMines.push({ left: 10 });
      break;
    case 'canal':
      run.canalBonus += 1;
      break;
    case 'anti':
      run.antiCharges += 1;
      break;
    case 'rejet':
      run.rerollTokens += 1;
      break;
    case 'rajeun':
      run.rajeunBonus += 1;
      break;
  }

  run.costs[key] = Math.ceil(run.costs[key] * 1.2); // l'escalade porte sur le coût de base, pas sur le coût déjà réduit

  if (key === run.npc3BonusDoor && meta.npc.npc3DoorBonus > 0) {
    bankGold(meta.npc.npc3DoorBonus); // directement banqué, permanent — voir PNJ 3
  }
}

/* Seul point d'entrée qui ajoute de l'or PERMANENT (meta.gold) via une vraie
   action de jeu (cashout, portes bonus PNJ 3) — PAS le bouton de triche
   "+100 or" des Paramètres, qui reste un simple ajout direct pour ne pas
   fausser ce record. Centralisé ici pour que meta.stats.totalGoldBanked ne
   puisse jamais dériver de meta.gold (un seul endroit à tenir à jour). */
function bankGold(amount) {
  meta.gold += amount;
  meta.stats.totalGoldBanked += amount;
  saveMeta();
}

/* Un chemin choisi (marché, ou raccourci clavier) : applique son effet
   puis termine immédiatement le tour — "récupérer l'or" ne quitte plus la
   partie, c'est juste un chemin de plus qui banque l'or accumulé. */
function choosePath(id) {
  if (!run || !run.alive || run.ended || run.rolling) return false;

  if (id === 'cashout') {
    collectGold();
    endTurn();
    return true;
  }
  if (id === 'double') {
    if (run.usedDouble) return false;
    run.energy *= 2;
    run.usedDouble = true;
    applySpecialBonusDoor(id);
    endTurn();
    return true;
  }
  if (id === 'skip') {
    applySpecialBonusDoor(id);
    endTurn();
    return true;
  }
  const action = ACTIONS.find(a => a.key === id);
  if (!action || !canAffordAction(id)) return false;
  applyAction(id);
  endTurn();
  return true;
}

/* "Ne rien faire"/"Doubler l'énergie" n'ont pas de coût de base à réduire
   (contrairement aux actions, voir applyAction()) : le bonus PNJ 2/PNJ 3
   s'y ajoute donc directement plutôt que de réduire un coût existant. */
function applySpecialBonusDoor(id) {
  if (id === run.npc2BonusDoor && meta.npc.npc2DoorBonus > 0) {
    run.energy += meta.npc.npc2DoorBonus;
  }
  if (id === run.npc3BonusDoor && meta.npc.npc3DoorBonus > 0) {
    bankGold(meta.npc.npc3DoorBonus);
  }
}

/* "Récupérer l'or" : banque l'or de la partie (avec son multiplicateur) dans
   l'or permanent, PUIS remet l'or de la partie à 0 (sinon on pourrait
   rebanquer indéfiniment le même or) — mais la partie continue normalement,
   contrairement à l'ancien "Terminer" qui y mettait fin. */
function collectGold() {
  const gained = effectiveGold();
  bankGold(gained);
  run.gold = 0;
  saveMeta();
  render();
  flashGoldBanked();
  if (window.SFX) SFX.cashout();
}

/* Effet visuel (flash doré) de l'or récupéré — même mécanique que
   flashLostGold() mais en positif. */
function flashGoldBanked() {
  const flash = document.getElementById('goldFlash');
  flash.classList.remove('active');
  void flash.offsetWidth;
  flash.classList.add('active');
}

/* Effet visuel (flash rouge + secousse) d'un "1" perdant — purement
   cosmétique, l'état (or à 0, roue réinitialisée) est déjà appliqué par
   endTurn() au moment où cette fonction est déclenchée. */
function flashLostGold() {
  const flash = document.getElementById('deathFlash');
  flash.classList.remove('active');
  void flash.offsetWidth;
  flash.classList.add('active');

  const playArea = document.getElementById('playArea');
  playArea.classList.remove('shake');
  void playArea.offsetWidth;
  playArea.classList.add('shake');
}

/* ---- résolution du tour / lancer du dé ----
   L'état du tour entier (relances sur un "1", gains, perte d'or, roue qui
   redémarre, tours passés) est résolu de façon 100% SYNCHRONE dans
   endTurn(), qui appelle startNewTurn() (donc window.regenerateHub()) tout
   de suite après : la salle suivante est donc déjà prête au moment même où
   la porte s'ouvre, sans aucun temps de chargement. L'animation de la roue
   (aiguille qui tourne, chiffre qui s'affiche) qui suit n'est plus qu'un
   habillage visuel différé — elle ne bloque plus jamais le déplacement. */

let dialRotation = 0;

function speedMult() {
  const s = DICE_SPEEDS[meta.diceSpeed] ? meta.diceSpeed : 'normale';
  return DICE_SPEEDS[s].mult;
}
function spinMs() { return Math.round(SPIN_BASE_MS * speedMult()); }
function holdMs() { return Math.round(HOLD_BASE_MS * speedMult()); }

function applyDiceSpeed() {
  document.documentElement.style.setProperty('--spin-duration', (1.1 * speedMult()).toFixed(2) + 's');
}

function endTurn() {
  if (!run || !run.alive || run.ended || run.rolling) return;
  run.rolling = true;

  const facesAtRollTime = currentFaces();
  const rollSequence = [];
  let value = rollJudgmentDie(facesAtRollTime);
  rollSequence.push(value);
  // relance sur un "1" : soit via un jeton (Rejet), soit via le % permanent du PNJ 2 —
  // les deux se cumulent librement, le jeton est consommé en priorité s'il y en a un.
  while (value === 1 && (run.rerollTokens > 0 || Math.random() * 100 < meta.npc.npc2RerollPct)) {
    if (run.rerollTokens > 0) run.rerollTokens -= 1;
    value = rollJudgmentDie(facesAtRollTime);
    rollSequence.push(value);
    // record "le plus de 1 relancés en une seule partie" (meta.stats.maxOnesRerolledInRun,
    // voir render()) : cumulé pour TOUTE la partie en cours, pas juste ce tour.
    run.onesRerolledThisRun = (run.onesRerolledThisRun || 0) + 1;
  }

  const lostGold = value === 1;
  if (lostGold) {
    run.gold = 0;
    run.turnsPassed = 0;
    // "mode assisté" (voir defaultMeta()) : se désactive tout seul dès que
    // les faces du dé sont remises à leur maximum par un vrai reset (un "1"
    // tiré) — demandé explicitement. Ne se réactive jamais tout seul
    // ensuite, uniquement si le joueur le fait lui-même dans les Paramètres.
    if (meta.assistMode) {
      meta.assistMode = false;
      saveMeta();
    }
  } else {
    // un seul incrément par tour : le nombre de faces maximal baisse d'exactement 1
    run.turnsPassed += 1;
  }

  run.rolling = false;
  startNewTurn(); // précharge la salle suivante immédiatement (window.regenerateHub)

  playRollAnimation(rollSequence, facesAtRollTime, lostGold);
}

function spinDialTo(value, faces) {
  const angle = (value / faces) * 360;
  const base = dialRotation - (dialRotation % 360);
  dialRotation = base + 3 * 360 + angle;
  document.getElementById('needleGroup').style.transform = `rotate(${dialRotation}deg)`;
}

function showDialNumber(value, kind) {
  document.getElementById('faceCountLabel').textContent = value;
  document.querySelector('.face-word').textContent = 'jugement';
  const wrap = document.getElementById('dialResult');
  wrap.classList.remove('flash-good', 'flash-bad');
  void wrap.offsetWidth;
  wrap.classList.add(kind === 'bad' ? 'flash-bad' : 'flash-good');
  if (window.SFX) (kind === 'bad' ? SFX.rollBad() : SFX.rollGood());
}

/* Rejoue visuellement la séquence de lancers déjà résolue par endTurn()
   (aiguille, chiffre, temps de pose, éventuelles relances) — pur spectacle,
   plus aucun état de jeu n'est modifié ici. */
function playRollAnimation(rollSequence, faces, lostGold) {
  let i = 0;
  function playNext() {
    const value = rollSequence[i];
    spinDialTo(value, faces);
    setTimeout(() => {
      showDialNumber(value, value === 1 ? 'bad' : 'good');
      setTimeout(() => {
        i++;
        if (i < rollSequence.length) {
          playNext();
        } else {
          document.getElementById('dialResult').classList.remove('flash-good', 'flash-bad');
          document.querySelector('.face-word').textContent = 'faces';
          document.getElementById('faceCountLabel').textContent = currentFaces();
          if (lostGold) flashLostGold();
        }
      }, holdMs());
    }, spinMs());
  }
  playNext();
}

/* ============================= RENDU (HUD 2D par-dessus la 3D) ============================= */

function render() {
  if (!run) return;
  saveRun(); // à chaque rendu = à chaque changement d'état visible, jamais par frame (voir saveRun())

  // records permanents (menu Records) — vérifiés à chaque rendu, donc après
  // quasiment toute action affectant l'un de ces chiffres.
  let statsChanged = false;
  if (run.energy > meta.stats.maxEnergy) { meta.stats.maxEnergy = run.energy; statsChanged = true; }
  if (run.turnsPassed > meta.stats.maxTurnsPassed) { meta.stats.maxTurnsPassed = run.turnsPassed; statsChanged = true; }
  if ((run.onesRerolledThisRun || 0) > meta.stats.maxOnesRerolledInRun) { meta.stats.maxOnesRerolledInRun = run.onesRerolledThisRun; statsChanged = true; }
  const runGoldNow = effectiveGold();
  if (runGoldNow > meta.stats.maxRunGold) { meta.stats.maxRunGold = runGoldNow; statsChanged = true; }
  if (statsChanged) saveMeta();

  document.getElementById('facesHudVal').textContent = currentFaces();
  document.getElementById('zoneHudVal').textContent = zoneName(run.zoneIndex);
  document.getElementById('energyVal').textContent = run.energy;
  document.getElementById('goldRun').textContent = effectiveGold();
  document.getElementById('goldBank').textContent = meta.gold;
  if (!run.rolling) {
    document.getElementById('faceCountLabel').textContent = currentFaces();
  }

  const dangerMix = Math.min(1, run.turnsPassed / (BASE_FACES + meta.lvl.extraFaces + run.rajeunBonus + run.npc1FaceDelta - 1));
  document.documentElement.style.setProperty('--danger-mix', isFinite(dangerMix) ? dangerMix.toFixed(3) : '0');

  const antiBadge = document.getElementById('badgeAnti');
  antiBadge.hidden = run.antiCharges <= 0;
  document.getElementById('badgeAntiVal').textContent = run.antiCharges;

  const rerollBadge = document.getElementById('badgeReroll');
  rerollBadge.hidden = run.rerollTokens <= 0;
  document.getElementById('badgeRerollVal').textContent = run.rerollTokens;

  renderMines();
}

function renderMines() {
  const row = document.getElementById('minesRow');
  row.innerHTML = '';
  run.pendingMines.forEach(m => {
    const chip = document.createElement('div');
    chip.className = 'mine-chip';
    chip.innerHTML = `<span class="badge-icon">⛏</span>${m.left}`;
    row.appendChild(chip);
  });
}

/* Décrit les chemins disponibles au carrefour courant, pour la scène 3D.
   La disposition spatiale (angles, largeur) est gérée par scene3d.js. */
/* Info bonus PNJ 2/PNJ 3 pour un chemin donné (action, "Ne rien faire" ou
   "Doubler l'énergie") — factorisé pour ne pas dupliquer ce calcul entre
   les actions et les deux spéciaux gratuits. */
function bonusDoorInfo(id) {
  const bonusEnergy = id === run.npc2BonusDoor && meta.npc.npc2DoorBonus > 0;
  const bonusGold = id === run.npc3BonusDoor && meta.npc.npc3DoorBonus > 0;
  let suffix = '';
  if (bonusEnergy) suffix += t('path.bonusDoor.energy', { n: meta.npc.npc2DoorBonus });
  if (bonusGold) suffix += t('path.bonusDoor.gold', { n: meta.npc.npc3DoorBonus });
  return { bonusEnergy, bonusGold, suffix };
}

function getCurrentPaths() {
  return PATH_IDS
    .filter(id => id !== 'double' || !run.usedDouble)
    .map(id => {
      const action = ACTIONS.find(a => a.key === id);
      if (action) {
        const cost = effectiveActionCost(id);
        let desc = action.desc();
        const info = bonusDoorInfo(id);
        if (info.bonusEnergy) desc += ' ' + (cost < 0 ? t('action.bonusEnergyGive', { n: -cost }) : t('action.bonusEnergyReduce', { n: meta.npc.npc2DoorBonus }));
        if (info.bonusGold) desc += ' ' + t('action.bonusGold', { n: meta.npc.npc3DoorBonus });
        return {
          id, kind: 'action',
          name: action.name, desc,
          cost, currency: t('currency.energy'),
          affordable: canAffordAction(id),
          bonusEnergy: info.bonusEnergy, bonusGold: info.bonusGold,
        };
      }
      if (id === 'skip') {
        const info = bonusDoorInfo(id);
        return { id, kind: 'special', name: t('path.skip.name'), desc: t('path.skip.desc') + info.suffix, affordable: true, bonusEnergy: info.bonusEnergy, bonusGold: info.bonusGold };
      }
      if (id === 'double') {
        const info = bonusDoorInfo(id);
        return { id, kind: 'special', name: t('path.double.name'), desc: t('path.double.desc') + info.suffix, affordable: true, bonusEnergy: info.bonusEnergy, bonusGold: info.bonusGold };
      }
      if (id === 'cashout') {
        return { id, kind: 'special', name: t('path.cashout.name'), desc: t('path.cashout.desc', { gold: effectiveGold() }), affordable: true };
      }
      return null;
    })
    .filter(Boolean);
}

/* Quels PNJ se trouvent dans la salle courante — décidé une fois par
   startNewTurn(), stable tant qu'on reste dans cette salle. */
function getCurrentNpcs() {
  return run.roomNpcs || [];
}

/* Zone visuelle courante — scene3d.js l'appelle à la construction de CHAQUE
   salle (y compris la salle préchargée) pour savoir quel décor utiliser. */
function getCurrentZone() {
  return { index: run.zoneIndex, name: zoneName(run.zoneIndex) };
}

/* ============================= PNJ ============================= */

function npc1MaxOffers() {
  return 1 + Math.floor(meta.npc.npc1Picks / NPC1_PICKS_PER_EXTRA_OFFER);
}

function getNpc1Offers() {
  return [
    { key: 'facesForDouble', name: t('npc1.facesForDouble.name'),
      desc: t('npc1.facesForDouble.desc') },
    { key: 'npcChance', name: t('npc1.npcChance.name'),
      desc: t('npc1.npcChance.desc', { mult: NPC_CHANCE_BOOST_MULT }) },
  ];
}

function getNpc2Offers() {
  const offers = [];
  if (!meta.npc.npc2DoorUnlocked) {
    offers.push({ key: 'unlockDoor', name: t('npc2.unlockDoor.name'), cost: 400,
      desc: t('npc2.unlockDoor.desc') });
  } else {
    offers.push({ key: 'boostDoor', name: t('npc2.boostDoor.name'), cost: meta.npc.npc2BoostDoorCost,
      desc: t('npc2.boostDoor.desc', { n: meta.npc.npc2DoorBonus }) });
  }
  offers.push({ key: 'rerollPct', name: t('npc2.rerollPct.name'), cost: meta.npc.npc2RerollCost,
    desc: t('npc2.rerollPct.desc', { pct: meta.npc.npc2RerollPct }) });
  return offers;
}

function getNpc3Offers() {
  const offers = [
    { key: 'extraFaces', name: t('npc3.extraFaces.name'), cost: meta.npc.npc3ExtraFacesCost,
      desc: t('npc3.extraFaces.desc', { n: BASE_FACES + meta.lvl.extraFaces }) },
    { key: 'turn1Energy', name: t('npc3.turn1Energy.name'), cost: meta.npc.npc3Turn1EnergyCost,
      desc: t('npc3.turn1Energy.desc', { n: meta.lvl.turn1Energy }) },
  ];
  if (!meta.npc.npc3DoorUnlocked) {
    offers.push({ key: 'unlockDoor', name: t('npc3.unlockDoor.name'), cost: 400,
      desc: t('npc3.unlockDoor.desc') });
  } else {
    offers.push({ key: 'boostDoor', name: t('npc3.boostDoor.name'), cost: meta.npc.npc3BoostDoorCost,
      desc: t('npc3.boostDoor.desc', { n: meta.npc.npc3DoorBonus }) });
  }
  return offers;
}

function getNpcOffers(npcId) {
  if (npcId === 'npc1') return getNpc1Offers();
  if (npcId === 'npc2') return getNpc2Offers();
  if (npcId === 'npc3') return getNpc3Offers();
  return [];
}

/* Applique l'effet d'une offre choisie. Retourne true si l'achat/le choix a
   bien été pris en compte (permet à l'appelant de rafraîchir l'affichage). */
function buyNpcOffer(npcId, key) {
  if (npcId === 'npc1') {
    if (run.npc1RemainingPicks <= 0) return false;
    if (key === 'facesForDouble') {
      run.npc1FaceDelta -= 8;
      run.energy *= 2;
      run.usedDouble = false; // regagne un doubleur utilisable : le chemin "Doubler l'énergie" réapparaît (dès la prochaine salle)
    } else if (key === 'npcChance') {
      run.npcChanceBoostNextRoom = true;
    } else {
      return false;
    }
    run.npc1RemainingPicks -= 1;
    meta.npc.npc1Picks += 1;
    saveMeta();
    render();
    if (window.SFX) SFX.purchase();
    return true;
  }

  if (npcId === 'npc2') {
    let spent = 0;
    if (key === 'unlockDoor') {
      if (meta.npc.npc2DoorUnlocked || meta.gold < 400) return false;
      spent = 400;
      meta.gold -= spent;
      meta.npc.npc2DoorUnlocked = true;
    } else if (key === 'boostDoor') {
      if (!meta.npc.npc2DoorUnlocked || meta.gold < meta.npc.npc2BoostDoorCost) return false;
      spent = meta.npc.npc2BoostDoorCost;
      meta.gold -= spent;
      meta.npc.npc2DoorBonus += 10;
      meta.npc.npc2BoostDoorCost = Math.ceil(meta.npc.npc2BoostDoorCost * 1.2);
    } else if (key === 'rerollPct') {
      if (meta.gold < meta.npc.npc2RerollCost || meta.npc.npc2RerollPct >= 100) return false;
      spent = meta.npc.npc2RerollCost;
      meta.gold -= spent;
      meta.npc.npc2RerollPct += 1;
      meta.npc.npc2RerollCost = Math.ceil(meta.npc.npc2RerollCost * 1.2);
    } else {
      return false;
    }
    saveMeta();
    render();
    if (window.SFX) SFX.purchase();
    return true;
  }

  if (npcId === 'npc3') {
    let spent = 0;
    if (key === 'extraFaces') {
      if (meta.gold < meta.npc.npc3ExtraFacesCost) return false;
      spent = meta.npc.npc3ExtraFacesCost;
      meta.gold -= spent;
      meta.lvl.extraFaces += 1;
      meta.npc.npc3ExtraFacesCost = Math.ceil(meta.npc.npc3ExtraFacesCost * 1.2);
    } else if (key === 'turn1Energy') {
      if (meta.gold < meta.npc.npc3Turn1EnergyCost) return false;
      spent = meta.npc.npc3Turn1EnergyCost;
      meta.gold -= spent;
      meta.lvl.turn1Energy += 10;
      meta.npc.npc3Turn1EnergyCost = Math.ceil(meta.npc.npc3Turn1EnergyCost * 1.2);
    } else if (key === 'unlockDoor') {
      if (meta.npc.npc3DoorUnlocked || meta.gold < 400) return false;
      spent = 400;
      meta.gold -= spent;
      meta.npc.npc3DoorUnlocked = true;
    } else if (key === 'boostDoor') {
      if (!meta.npc.npc3DoorUnlocked || meta.gold < meta.npc.npc3BoostDoorCost) return false;
      spent = meta.npc.npc3BoostDoorCost;
      meta.gold -= spent;
      meta.npc.npc3DoorBonus += 10;
      meta.npc.npc3BoostDoorCost = Math.ceil(meta.npc.npc3BoostDoorCost * 1.2);
    } else {
      return false;
    }
    saveMeta();
    render();
    if (window.SFX) SFX.purchase();
    return true;
  }

  return false;
}

/* ============================= SUCCÈS / RECORDS ============================= */

/* "Niveau" d'une amélioration permanente = nombre de fois où elle a été
   achetée (déduit de sa valeur, puisque chaque achat ajoute toujours le même
   incrément — +1 pour extraFaces/npc2RerollPct, +10 pour les trois autres). */
function getUpgradeLevels() {
  return [
    { name: t('upgrade.extraFaces'), level: meta.lvl.extraFaces },
    { name: t('upgrade.turn1Energy'), level: meta.lvl.turn1Energy / 10 },
    { name: t('upgrade.npc2DoorBonus'), level: meta.npc.npc2DoorBonus / 10 },
    { name: t('upgrade.npc2RerollPct'), level: meta.npc.npc2RerollPct },
    { name: t('upgrade.npc3DoorBonus'), level: meta.npc.npc3DoorBonus / 10 },
  ];
}

function getLowestUpgrade() {
  const levels = getUpgradeLevels();
  return levels.reduce((min, c) => (c.level < min.level ? c : min), levels[0]);
}

/* Catalogue "tout ce qu'on peut acheter chez chaque PNJ", pour le menu
   Règles — demandé explicitement ("l'on doit aussi pouvoir voir tous les
   achats possibles par tous les PNJ"). Réutilise directement
   getNpc1/2/3Offers() (même source que le panneau d'achat réel, jamais
   dupliquée) : reflète donc l'état RÉEL actuel (ex. "Porte allégée" affiche
   le déblocage tant qu'il n'est pas acheté, puis l'amélioration progressive
   une fois débloqué) plutôt qu'un catalogue figé qui pourrait diverger du
   vrai panneau PNJ au fil des futurs changements. */
function renderRulesNpcOffers() {
  const wrap = document.getElementById('rulesNpcOffers');
  if (!wrap) return;
  const groups = [
    { id: 'npc1', offers: getNpc1Offers() },
    { id: 'npc2', offers: getNpc2Offers() },
    { id: 'npc3', offers: getNpc3Offers() },
  ];
  wrap.innerHTML = groups.map(g => `
    <h3>${npcName(g.id)}</h3>
    <ul>
      ${g.offers.map(o => `<li><strong>${o.name}</strong> — ${o.desc} (${o.cost != null ? `${o.cost} ${t('currency.gold')}` : t('npc.free')})</li>`).join('')}
    </ul>
  `).join('');
}

/* Petites icônes en ligne (mêmes couleurs que le reste de l'UI, aucune
   image externe) pour l'onglet "Chemins" des Règles — demandé explicitement
   ("tu peux y mettre image"). Un seul <path>/<rect> par icône, style trait
   simple façon pictogramme. */
const RULES_PATH_ICONS = {
  mine: '<path d="M3 17 L11 9"/><path d="M7 3 C11 2 16 4 17 8 C13 8 9 6 7 3 Z"/>',
  canal: '<path d="M11 2 L5 11 H9 L8 18 L15 8 H11 Z"/>',
  anti: '<path d="M10 2 L17 5 V10 C17 14 14 17 10 18 C6 17 3 14 3 10 V5 Z"/>',
  rejet: '<path d="M16 10 A6 6 0 1 1 10 4"/><path d="M10 1 L10 4 L13 4"/>',
  rajeun: '<path d="M5 3 H15 M5 17 H15 M5 3 C5 8 10 9 10 10 C10 11 5 12 5 17 M15 3 C15 8 10 9 10 10 C10 11 15 12 15 17"/>',
  skip: '<rect x="5" y="4" width="3" height="12" rx="1" fill="currentColor" stroke="none"/><rect x="12" y="4" width="3" height="12" rx="1" fill="currentColor" stroke="none"/>',
  double: '<path d="M8 2 L3 10 H7 L6 17 L12 9 H8 Z"/><path d="M14 4 L11 9 H13 L12 14" opacity="0.6"/>',
  cashout: '<circle cx="10" cy="10" r="7"/><path d="M10 6.5 V13.5 M8 8 C8 6.5 9 6.3 10 6.5 C11.5 6.8 11.5 9 10 9.5 C8.5 10 8 11.5 10 12.5 C11 13 12 12.7 12 12" stroke-linecap="round"/>',
};
function rulesPathIcon(key) {
  return `<svg class="rules-path-icon" viewBox="0 0 20 20">${RULES_PATH_ICONS[key] || ''}</svg>`;
}

/* Chemins d'action + spéciaux avec icône, pour l'onglet "Chemins" des
   Règles — réutilise ACTIONS/t('path.*') directement (même source que le
   vrai jeu, voir getCurrentPaths()) plutôt que de dupliquer les textes :
   toujours à jour si les descriptions changent un jour. */
function renderRulesPaths() {
  const actionWrap = document.getElementById('rulesActionPaths');
  if (actionWrap) {
    actionWrap.innerHTML = ACTIONS.map(a => `
      <div class="rules-path-item">
        ${rulesPathIcon(a.key)}
        <div class="rules-path-text"><strong>${a.name}</strong><span>${a.desc()}</span></div>
      </div>
    `).join('');
  }
  const specialWrap = document.getElementById('rulesSpecialPaths');
  if (specialWrap) {
    const specials = [
      { key: 'skip', name: t('path.skip.name'), desc: t('path.skip.desc') },
      { key: 'double', name: t('path.double.name'), desc: t('path.double.desc') },
      { key: 'cashout', name: t('path.cashout.name'), desc: t('rules.specialPaths.cashoutDesc') },
    ];
    specialWrap.innerHTML = specials.map(p => `
      <div class="rules-path-item">
        ${rulesPathIcon(p.key)}
        <div class="rules-path-text"><strong>${p.name}</strong><span>${p.desc}</span></div>
      </div>
    `).join('');
  }
}

/* Sous-chapitres du menu Règles (voir #rulesTabs dans index.html) — demandé
   explicitement pour rendre le menu "plus lisible, claire et simple" (un
   seul long mur de texte à faire défiler avant). Un seul écouteur par
   bouton, posé une fois (voir wireEvents()) ; jamais reconstruit. */
function initRulesTabs() {
  document.querySelectorAll('.rules-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.rules-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.rules-section').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      const section = document.querySelector(`.rules-section[data-section="${btn.dataset.tab}"]`);
      if (section) section.classList.add('active');
    });
  });
}

/* Rangs de record (0=Bronze .. 5=Divin), une seule échelle de couleurs
   partagée par TOUS les records — demandé explicitement ("chaque record doit
   être associé à une couleur qui est associée à un chiffre qui est le
   rang"). Le rang divin (le plus dur à obtenir) a un traitement visuel à
   part (halo doré animé, voir .record-rank-divine dans style.css) plutôt
   qu'une simple couleur unie, pour vraiment se démarquer des autres. */
const RECORD_RANKS = [
  { key: 'bronze', color: '#b5723a' },
  { key: 'silver', color: '#c7d0d9' },
  { key: 'gold', color: '#e8b64f' },
  { key: 'platinum', color: '#7fe0d0' },
  { key: 'diamond', color: '#9fc6ff' },
  { key: 'divine', color: '#fff6d8' },
];

/* `thresholds` = les 5 valeurs minimales pour atteindre les rangs 1 à 5
   (rang 0 en dessous du premier seuil). Un seuil par record, PAS une échelle
   commune : les records n'ont pas du tout la même échelle de valeurs
   (l'énergie max se compte en dizaines, l'or total dépensé en dizaines de
   milliers) — les seuils de chaque record sont choisis indépendamment pour
   que la difficulté RELATIVE de décrocher un rang donné reste comparable
   d'un record à l'autre, comme demandé ("la longueur et difficulté d'avoir
   chaque rang doit être équivalente pour chaque record"). Estimés à dire
   d'expert (le jeu n'a pas encore de données de parties réelles) : à
   recalibrer une fois de vraies parties jouées si un rang s'avère trop
   facile ou trop dur par rapport aux autres. */
function rankForValue(value, thresholds) {
  let rank = 0;
  for (const th of thresholds) {
    if (value >= th) rank++;
  }
  return Math.min(rank, RECORD_RANKS.length - 1);
}

/* Un seul tableau de records unifié — l'amélioration la moins avancée en
   fait partie au même titre que les 5 statistiques, plus de section à part
   ("même l'amélioration la moins avancée fait partie des records comme les
   autres", demandé explicitement). */
function getRecords() {
  return [
    { label: t('stats.lowestUpgrade.title'), value: getLowestUpgrade().level, thresholds: [1, 3, 6, 10, 15] },
    { label: t('stats.maxEnergy'), value: meta.stats.maxEnergy, thresholds: [30, 80, 200, 500, 1200] },
    { label: t('stats.maxTurns'), value: meta.stats.maxTurnsPassed, thresholds: [5, 12, 25, 40, 60] },
    { label: t('stats.maxOnesRerolled'), value: meta.stats.maxOnesRerolledInRun, thresholds: [1, 3, 7, 15, 30] },
    { label: t('stats.totalGoldBanked'), value: meta.stats.totalGoldBanked, thresholds: [1000, 4000, 15000, 50000, 150000] },
    { label: t('stats.maxRunGold'), value: meta.stats.maxRunGold, thresholds: [100, 500, 2000, 8000, 30000] },
  ];
}

function renderStats() {
  const body = document.getElementById('statsBody');
  body.innerHTML = `<div class="record-list">${getRecords().map(r => {
    const info = RECORD_RANKS[rankForValue(r.value, r.thresholds)];
    return `
      <div class="record-item record-rank-${info.key}" style="--rank-color:${info.color}">
        <span class="record-label">${r.label}</span>
        <span class="record-value">${r.value}</span>
        <span class="record-rank-name">${t('rank.' + info.key)}</span>
      </div>
    `;
  }).join('')}</div>`;
}

/* Appelé par scene3d.js quand le joueur marche jusqu'à un PNJ. */
/* Appelé par scene3d.js quand le joueur interagit avec un PNJ (touche
   dédiée, voir INTERACT_KEY) — peut arriver plusieurs fois pour le même PNJ
   dans la même salle, demandé explicitement. Pour le PNJ 1 (offres
   gratuites limitées), seule la PREMIÈRE interaction de la salle recharge
   ses choix — sinon reparler à volonté les rechargerait à chaque fois,
   contournant complètement la limite ("juste le PNJ qui donne gratuitement
   ne peut donner qu'une fois, mais on peut quand même interagir plusieurs
   fois avec lui"). */
function talkToNpc(npcId) {
  if (!run) return;
  if (window.SFX) SFX.npcGreet();
  // micro-dialogue narratif : avance d'1 étape à la première interaction
  // dans une salle donnée (jamais en reparlant dans la même salle) — voir
  // NPC_DIALOGUE_MAX/npcDialogueLine(). Testé AVANT toute mise à jour de
  // `npc1VisitedThisRoom` ci-dessous (qui sert une mécanique de jeu réelle,
  // propre au PNJ 1), sinon l'avancée du dialogue du PNJ 1 ne se
  // déclencherait jamais (le flag serait déjà à `true`).
  const visitedKey = npcId + 'VisitedThisRoom';
  const isFirstVisitThisRoom = !run[visitedKey];
  if (isFirstVisitThisRoom) {
    run[visitedKey] = true;
    const dialogueKey = npcId + 'DialogueIndex';
    if (meta.npc[dialogueKey] < NPC_DIALOGUE_MAX) {
      meta.npc[dialogueKey] += 1;
      saveMeta();
    }
  }
  if (npcId === 'npc1' && isFirstVisitThisRoom) {
    run.npc1RemainingPicks = npc1MaxOffers();
  }
  renderNpcOverlay(npcId);
  showOverlay('npcOverlay');
  if (document.pointerLockElement) document.exitPointerLock();
}
window.talkToNpc = talkToNpc;

function renderNpcOverlay(npcId) {
  document.getElementById('npcName').textContent = npcName(npcId);
  document.getElementById('npcGoldBank').textContent = meta.gold;

  const dialogueEl = document.getElementById('npcDialogue');
  const line = npcDialogueLine(npcId);
  dialogueEl.textContent = line;
  dialogueEl.hidden = !line;

  const sub = document.getElementById('npcSub');
  if (npcId === 'npc1') {
    sub.hidden = false;
    sub.textContent = t('npc.npc1.sub', {
      remaining: run.npc1RemainingPicks,
      every: NPC1_PICKS_PER_EXTRA_OFFER,
      total: meta.npc.npc1Picks,
    });
  } else {
    sub.hidden = true;
  }

  const grid = document.getElementById('npcGrid');
  grid.innerHTML = '';
  getNpcOffers(npcId).forEach(o => {
    const div = document.createElement('div');
    div.className = 'shop-card-item';
    const costLabel = o.cost != null ? `${o.cost} ${t('currency.gold')}` : t('npc.free');
    const disabled = npcId === 'npc1' ? run.npc1RemainingPicks <= 0 : (o.cost != null && meta.gold < o.cost);
    div.innerHTML = `
      <span class="name">${o.name}</span>
      <span class="desc">${o.desc}</span>
      <button class="buy-btn" ${disabled ? 'disabled' : ''}>${t('npc.buyPrefix')} ${costLabel}</button>
    `;
    div.querySelector('.buy-btn').addEventListener('click', () => {
      if (buyNpcOffer(npcId, o.key)) renderNpcOverlay(npcId);
    });
    grid.appendChild(div);
  });
}

/* ---- overlays ---- */

function showOverlay(id) {
  document.getElementById(id).hidden = false;
}
function hideOverlay(id) {
  document.getElementById(id).hidden = true;
}

/* ============================= RACCOURCIS CLAVIER (déplacement uniquement) ============================= */

function codeLabel(code) {
  if (!code) return '—';
  if (code === 'Escape') return t('keyLabel.escape');
  if (code === 'Space') return t('keyLabel.space');
  if (code === 'ArrowUp') return '↑';
  if (code === 'ArrowDown') return '↓';
  if (code === 'ArrowLeft') return '←';
  if (code === 'ArrowRight') return '→';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}

function renderSettings() {
  renderLanguageOptions();
  renderAssistModeOptions();
  renderSpeedOptions();
  document.getElementById('sfxVolumeSlider').value = Math.round(meta.sfxVolume * 100);

  const list = document.getElementById('keybindList');
  list.innerHTML = '';
  MOVE_KEY_ORDER.forEach(dir => {
    const row = document.createElement('div');
    row.className = 'keybind-row';
    row.innerHTML = `
      <span class="kb-name">${moveKeyLabel(dir)}</span>
      <span class="kb-controls">
        <span class="kb-key">${codeLabel(meta.moveKeys[dir])}</span>
        <button class="kb-change-btn">${t('settings.changeKey')}</button>
      </span>
    `;
    row.querySelector('.kb-change-btn').addEventListener('click', (e) => startRebind(dir, e.currentTarget));
    list.appendChild(row);
  });
}

/* Sélecteur de langue (Paramètres) — même gabarit visuel que le sélecteur de
   vitesse du dé juste en dessous. Changer de langue met à jour meta.lang,
   ré-applique toute la chrome statique (data-i18n) ET re-rend tout ce qui
   dépend du texte traduit et est actuellement visible (HUD, salle 3D avec
   ses étiquettes de chemin/PNJ, ce panneau lui-même). */
function renderLanguageOptions() {
  const wrap = document.getElementById('languageOptions');
  if (!wrap || typeof LANGS === 'undefined') return;
  wrap.innerHTML = '';
  LANGS.forEach(code => {
    const btn = document.createElement('button');
    btn.className = 'speed-btn' + (meta.lang === code ? ' active' : '');
    btn.textContent = LANG_LABELS[code] || code;
    btn.addEventListener('click', () => {
      if (meta.lang === code) return;
      meta.lang = code;
      saveMeta();
      document.documentElement.lang = code;
      applyStaticI18n();
      renderSettings();
      renderRulesNpcOffers();
      renderRulesPaths();
      render();
      if (window.regenerateHub) window.regenerateHub();
    });
    wrap.appendChild(btn);
  });
}

/* Bascule ON/OFF du mode assisté (voir defaultMeta()/endTurn()) — même
   gabarit que renderLanguageOptions() juste au-dessus. Regénère la salle
   courante pour que les étiquettes de porte reflètent le changement
   immédiatement (buildDoor() lit meta.assistMode au moment de leur
   construction, pas à chaque frame). */
function renderAssistModeOptions() {
  const wrap = document.getElementById('assistModeOptions');
  if (!wrap) return;
  wrap.innerHTML = '';
  [true, false].forEach(v => {
    const btn = document.createElement('button');
    btn.className = 'speed-btn' + (meta.assistMode === v ? ' active' : '');
    btn.textContent = v ? t('settings.assistMode.on') : t('settings.assistMode.off');
    btn.addEventListener('click', () => {
      if (meta.assistMode === v) return;
      meta.assistMode = v;
      saveMeta();
      renderAssistModeOptions();
      if (window.regenerateHub) window.regenerateHub();
    });
    wrap.appendChild(btn);
  });
}

function renderSpeedOptions() {
  const wrap = document.getElementById('speedOptions');
  wrap.innerHTML = '';
  Object.keys(DICE_SPEEDS).forEach(key => {
    const btn = document.createElement('button');
    btn.className = 'speed-btn' + (meta.diceSpeed === key ? ' active' : '');
    btn.textContent = t('diceSpeed.' + key);
    btn.addEventListener('click', () => {
      meta.diceSpeed = key;
      saveMeta();
      applyDiceSpeed();
      renderSpeedOptions();
    });
    wrap.appendChild(btn);
  });
}

function startRebind(dir, buttonEl) {
  if (rebindListenerActive) return;
  rebindListenerActive = true;
  buttonEl.textContent = t('settings.pressKey');
  buttonEl.classList.add('listening');

  const handler = (e) => {
    e.preventDefault();
    e.stopPropagation();
    window.removeEventListener('keydown', handler, true);
    rebindListenerActive = false;
    const code = e.code;
    if (code !== 'Escape') {
      Object.keys(meta.moveKeys).forEach(k => {
        if (meta.moveKeys[k] === code) meta.moveKeys[k] = '';
      });
      meta.moveKeys[dir] = code;
      saveMeta();
    }
    renderSettings();
  };
  window.addEventListener('keydown', handler, true);
}

function handleGlobalEscape(e) {
  if (e.key !== 'Escape' || rebindListenerActive) return;
  ['settingsOverlay', 'rulesOverlay', 'npcOverlay', 'statsOverlay'].forEach(id => {
    const el = document.getElementById(id);
    if (!el.hidden) el.hidden = true;
  });
}

/* ============================= DECOR (étoiles + cadran) ============================= */

function buildStars() {
  const wrap = document.getElementById('stars');
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 90; i++) {
    const s = document.createElement('span');
    s.style.left = Math.random() * 100 + '%';
    s.style.top = Math.random() * 65 + '%';
    s.style.animationDelay = (Math.random() * 4).toFixed(2) + 's';
    s.style.animationDuration = (3 + Math.random() * 3).toFixed(2) + 's';
    frag.appendChild(s);
  }
  wrap.appendChild(frag);
}

const ROMAN = ['XII','I','II','III','IV','V','VI','VII','VIII','IX','X','XI'];

function buildDial() {
  const ticks = document.getElementById('ticks');
  const numerals = document.getElementById('numerals');
  const cx = 200, cy = 200;
  for (let i = 0; i < 60; i++) {
    const angle = (i / 60) * Math.PI * 2 - Math.PI / 2;
    const major = i % 5 === 0;
    const rOuter = 150;
    const rInner = major ? 134 : 142;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', cx + Math.cos(angle) * rOuter);
    line.setAttribute('y1', cy + Math.sin(angle) * rOuter);
    line.setAttribute('x2', cx + Math.cos(angle) * rInner);
    line.setAttribute('y2', cy + Math.sin(angle) * rInner);
    if (major) line.setAttribute('class', 'major');
    ticks.appendChild(line);
  }
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2 - Math.PI / 2;
    const r = 118;
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', cx + Math.cos(angle) * r);
    text.setAttribute('y', cy + Math.sin(angle) * r);
    text.textContent = ROMAN[i];
    numerals.appendChild(text);
  }
}

/* ============================= INIT / EVENTS ============================= */

function wireEvents() {
  document.getElementById('btnCloseNpc').addEventListener('click', () => {
    hideOverlay('npcOverlay');
    // pas d'enchaînement automatique vers un autre PNJ : interagir est
    // désormais TOUJOURS un choix explicite (touche dédiée visée sur le
    // PNJ voulu) — voir INTERACT_KEY dans scene3d.js.
  });

  document.getElementById('sfxVolumeSlider').addEventListener('input', (e) => {
    meta.sfxVolume = Number(e.target.value) / 100;
    saveMeta();
    if (window.SFX) SFX.setVolume(meta.sfxVolume);
  });

  document.getElementById('btnRules').addEventListener('click', () => {
    renderRulesNpcOffers();
    renderRulesPaths();
    showOverlay('rulesOverlay');
  });
  document.getElementById('btnCloseRules').addEventListener('click', () => hideOverlay('rulesOverlay'));
  initRulesTabs();

  document.getElementById('btnStats').addEventListener('click', () => {
    renderStats();
    showOverlay('statsOverlay');
  });
  document.getElementById('btnCloseStats').addEventListener('click', () => hideOverlay('statsOverlay'));

  document.getElementById('btnSettings').addEventListener('click', () => {
    renderSettings();
    showOverlay('settingsOverlay');
  });
  document.getElementById('btnCloseSettings').addEventListener('click', () => hideOverlay('settingsOverlay'));
  document.getElementById('btnResetKeybinds').addEventListener('click', () => {
    meta.moveKeys = { ...DEFAULT_MOVE_KEYS };
    saveMeta();
    renderSettings();
  });
  document.getElementById('btnResetSave').addEventListener('click', () => {
    if (!activeSlotId) return;
    if (confirm(t('settings.resetSave.confirm'))) {
      localStorage.removeItem(slotSaveKey(activeSlotId));
      meta = defaultMeta();
      applyDiceSpeed();
      // pas d'appel à render() ici : ses vérifications de records comparent
      // à la partie ENCORE en cours (si une partie tourne) et réinflaraient
      // aussitôt les stats qu'on vient tout juste de remettre à zéro.
      const goldBankHud = document.getElementById('goldBank');
      if (goldBankHud) goldBankHud.textContent = meta.gold;
    }
  });
  document.getElementById('btnAdd100Gold').addEventListener('click', () => {
    meta.gold += 100;
    saveMeta();
    render();
  });

  // "vraie application à lancer, pas dans un navigateur... même avec un
  // bouton pour quitter le jeu" (demandé explicitement, en vue d'une future
  // publication Steam) — voir electron/preload.js. window.electronAPI
  // n'existe QUE dans l'appli empaquetée (Electron) : dans un navigateur
  // normal, ce bouton reste caché, il n'y a rien à "quitter".
  const btnQuit = document.getElementById('btnQuit');
  if (window.electronAPI && window.electronAPI.isElectron) {
    btnQuit.hidden = false;
    btnQuit.addEventListener('click', () => window.electronAPI.quit());
  }

  document.getElementById('btnNewSlot').addEventListener('click', createNewSlot);
  document.getElementById('btnBackToMenu').addEventListener('click', showSlotsScreen);

  window.addEventListener('keydown', handleGlobalEscape);
}

/* Écran de sélection de partie au chargement (voir showSlotsScreen()) —
   plus de démarrage automatique direct. Le premier clic du joueur (sur la
   carte d'une partie, ou dans la zone 3D une fois en jeu) sert de geste
   utilisateur pour débloquer l'audio — voir SFX.init() dans scene3d.js. */
function init() {
  document.documentElement.lang = meta.lang;
  if (window.applyStaticI18n) applyStaticI18n();
  buildStars();
  buildDial();
  applyDiceSpeed();
  wireEvents();
  showSlotsScreen();
}

document.addEventListener('DOMContentLoaded', init);
