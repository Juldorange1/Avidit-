'use strict';

/* Effets sonores 100% synthétisés (Web Audio API : oscillateurs + bruit
   filtré avec enveloppes de volume) — pas de fichier audio à charger,
   cohérent avec le reste du jeu (tout le décor est généré procéduralement).
   Volume réglable/coupable depuis les Paramètres (meta.sfxVolume) pour ne
   jamais imposer un son "parasite" à qui n'en veut pas.

   `SFX` est exposé à la fois comme identifiant global partagé (comme
   `meta`/`run`) et explicitement sur `window`, pour être appelable depuis
   game.js et scene3d.js sans dépendre de l'ordre de chargement. */

let actx = null;
let masterGain = null;
let sharedNoiseBuffer = null;

function sfxContext() {
  if (actx) return actx;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    actx = new Ctx();
    masterGain = actx.createGain();
    masterGain.gain.value = (typeof meta !== 'undefined' && meta.sfxVolume != null) ? meta.sfxVolume : 0.6;
    masterGain.connect(actx.destination);

    // un seul buffer de bruit blanc partagé (0.5s), réutilisé par tous les
    // sons "bruit filtré" (pas de génération de données par appel).
    const len = Math.floor(actx.sampleRate * 0.5);
    sharedNoiseBuffer = actx.createBuffer(1, len, actx.sampleRate);
    const data = sharedNoiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  } catch (e) {
    actx = null;
  }
  return actx;
}

function sfxResume() {
  const ctx = sfxContext();
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
}

function sfxSetVolume(v) {
  sfxContext();
  if (masterGain) masterGain.gain.value = Math.max(0, Math.min(1, v));
}

/* ---- primitives ---- */

function sfxTone(freq, duration, opts) {
  const ctx = sfxContext();
  if (!ctx) return;
  opts = opts || {};
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = opts.type || 'sine';
  osc.frequency.setValueAtTime(freq, now);
  if (opts.toFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.toFreq), now + duration);
  const peak = opts.volume != null ? opts.volume : 0.2;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(peak, now + (opts.attack || 0.01));
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(gain);
  gain.connect(masterGain);
  osc.start(now);
  osc.stop(now + duration + 0.03);
}

function sfxNoise(duration, opts) {
  const ctx = sfxContext();
  if (!ctx || !sharedNoiseBuffer) return;
  opts = opts || {};
  const now = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = sharedNoiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = opts.filterType || 'lowpass';
  filter.frequency.setValueAtTime(opts.filterFreq || 1000, now);
  if (opts.filterToFreq) filter.frequency.exponentialRampToValueAtTime(opts.filterToFreq, now + duration);
  const gain = ctx.createGain();
  const peak = opts.volume != null ? opts.volume : 0.15;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(peak, now + (opts.attack || 0.004));
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain);
  src.start(now);
  src.stop(now + duration + 0.03);
}

/* ---- effets ---- */

const SFX = {
  init: sfxResume,
  setVolume: sfxSetVolume,

  footstep() {
    sfxNoise(0.055, { volume: 0.05, filterFreq: 380, filterToFreq: 140, attack: 0.002 });
  },
  jump() {
    // avant : un simple bip synthétique (300→560Hz) — signalé comme
    // irréaliste ("pas un 'pm'"). Un vrai saut humain, c'est surtout un bref
    // effort respiratoire ("hff") + le poids du corps qui se détache du sol
    // — synthétisé ici par un bruit filtré passe-bande (texture de souffle,
    // pas un pur ton) superposé à un thump grave très court (poids/impulsion),
    // plutôt qu'une seule fréquence qui monte. Recherche d'un vrai
    // enregistrement CC0 (freesound.org) : bloquée, le téléchargement — et
    // même l'API — y exigent un compte/une authentification, y compris pour
    // du contenu CC0 ; le pack audio Kenney déjà utilisé sans accroc pour le
    // reste du jeu n'a pas de son d'effort humain dans son catalogue.
    sfxNoise(0.13, { volume: 0.1, filterType: 'bandpass', filterFreq: 420, filterToFreq: 230, attack: 0.015 });
    sfxTone(95, 0.09, { type: 'sine', toFreq: 65, volume: 0.09, attack: 0.005 });
  },
  land() {
    sfxNoise(0.09, { volume: 0.09, filterFreq: 260, filterToFreq: 90 });
  },
  doorOpen() {
    sfxNoise(0.34, { volume: 0.1, filterFreq: 850, filterToFreq: 200, attack: 0.02 });
  },
  doorClose() {
    // même grain que l'ouverture, mais le filtre balaie dans l'autre sens
    // (grave -> aigu) et un peu plus court/discret : on reconnaît le même
    // "matériau" de porte sans que ça sonne comme un doublon de l'ouverture.
    sfxNoise(0.22, { volume: 0.08, filterFreq: 220, filterToFreq: 700, attack: 0.015 });
  },
  npcGreet() {
    sfxTone(660, 0.13, { type: 'sine', volume: 0.14 });
    setTimeout(() => sfxTone(880, 0.17, { type: 'sine', volume: 0.12 }), 90);
  },
  purchase() {
    sfxTone(1100, 0.09, { type: 'sine', volume: 0.13 });
    setTimeout(() => sfxTone(1500, 0.13, { type: 'sine', volume: 0.11 }), 55);
  },
  rollGood() {
    sfxTone(520, 0.15, { type: 'triangle', toFreq: 700, volume: 0.17 });
  },
  rollBad() {
    sfxTone(150, 0.5, { type: 'sawtooth', toFreq: 65, volume: 0.18 });
  },
  cashout() {
    [660, 880, 1100].forEach((f, i) => setTimeout(() => sfxTone(f, 0.2, { type: 'triangle', volume: 0.17 }), i * 100));
  },
};

window.SFX = SFX;
