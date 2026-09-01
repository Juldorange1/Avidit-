'use strict';

/* Système de langue : un simple dictionnaire clé -> texte par langue, une
   fonction t(clé, variables) qui résout la traduction (avec repli sur le
   français si la langue courante n'a pas la clé, puis sur la clé elle-même
   si même le français ne l'a pas — jamais un texte vide/cassé), et
   applyStaticI18n() qui remplit tout élément HTML marqué data-i18n. Demandé
   explicitement : "dans les paramètres l'on doit pouvoir choisir la langue
   de tout". Chargé AVANT audio.js/game.js/scene3d.js (voir index.html) :
   ce fichier ne fait que DÉFINIR t()/STRINGS, il n'est appelé qu'une fois
   `meta` (déclaré dans game.js) existe déjà, donc l'ordre de chargement ne
   pose pas de problème même si ce script s'exécute en premier. */

const LANG_DEFAULT = 'fr';
const LANGS = ['fr', 'en'];
const LANG_LABELS = { fr: 'Français', en: 'English' };

const STRINGS = {
  fr: {
    'page.title': 'Avidité — Le Dé du Jugement',
    'app.title': 'AVIDITÉ',
    'toolbar.rules': 'Règles',
    'toolbar.stats': 'Records',
    'toolbar.settings': 'Paramètres',

    'dial.faceWord': 'faces',
    'hud.faces': 'Faces du Dé',
    'hud.energy': 'Énergie',
    'hud.goldRun': 'Or partie',
    'hud.goldBank': 'Or banqué',

    'lock.title': 'Cliquez pour regarder autour de vous',
    'lock.hint': 'Souris pour regarder — touches de déplacement (configurables) pour marcher, sauter — E pour interagir avec un PNJ visé — Échap pour libérer le curseur',
    'lock.title.touch': 'Touchez pour commencer',
    'lock.hint.touch': 'Glissez à droite pour regarder — joystick à gauche pour marcher — bouton ⤒ pour sauter — bouton E pour interagir avec un PNJ visé',

    'rules.title': 'Règles',
    'rules.paths.title': 'Chemins',
    'rules.paths.body': "Chaque tour, 8 chemins s'offrent à vous. En prendre un l'applique aussitôt, vous traversez le passage, puis le Dé du Jugement tombe et une nouvelle salle apparaît.",
    'rules.dice.title': 'Dé du Jugement',
    'rules.dice.body': '50 faces au départ, une de moins à chaque tour. Sur "1" : vous perdez tout l\'or de la partie et la roue reprend son nombre de faces initial.',
    'rules.runGold.title': 'Or de la partie',
    'rules.runGold.body': 'Multiplié par le nombre de tours joués. Plus vous restez, plus il pèse — et plus vous risquez de tout perdre d\'un coup.',
    'rules.actionPaths.title': "Chemins d'action",
    'rules.actionPaths.mine': '<strong>Mine</strong> — +1 or dans 10 tours.',
    'rules.actionPaths.canal': '<strong>Canalisation</strong> — +1 énergie/tour, toute la partie.',
    'rules.actionPaths.anti': '<strong>Anti-destinée</strong> — le prochain lancer ne peut pas faire 1.',
    'rules.actionPaths.rejet': '<strong>Rejet</strong> — relance : sauve automatiquement d\'un 1.',
    'rules.actionPaths.rajeun': '<strong>Rajeunissement</strong> — +1 face au dé, toute la partie.',
    'rules.actionPaths.closed': "Un chemin d'action fermé (barré) signifie que vous n'avez pas l'énergie pour le prendre.",
    'rules.specialPaths.title': 'Chemins spéciaux',
    'rules.specialPaths.body': '<strong>Ne rien faire</strong> : passe le tour sans effet. <strong>Doubler énergie</strong> : x2 immédiat, 1 seule fois par partie — une fois pris, ce chemin disparaît. <strong>Récupérer l\'or</strong> : banque l\'or de la partie dans votre or permanent, la partie continue.',
    'rules.costs.title': 'Coûts des actions',
    'rules.costs.body': '+20% par achat, remis à zéro à chaque nouvelle partie.',
    'rules.npcs.title': 'Les PNJ',
    'rules.npcs.body': 'Chaque PNJ a une petite chance d\'apparaître dans une salle. Visez-le et appuyez sur la touche dédiée pour lui parler. Leurs achats (contre de l\'or banqué, sauf le Parieur qui est gratuit) sont permanents, pour toutes vos parties futures. Leurs prix augmentent de 20% à chaque achat.',
    'rules.story.title': 'Histoire',
    'rules.story.body': "Les PNJ sont des gens qui n'ont jamais réussi à combler leur propre avidité. Devenus vieux, ils ont fini par abandonner — et ont choisi, à défaut, de vous aider à combler la vôtre.",

    'settings.title': 'Paramètres',
    'settings.diceSpeed.label': 'Vitesse du dé',
    'settings.volume.label': 'Volume des sons',
    'settings.language.label': 'Langue',
    'settings.assistMode.label': 'Mode assisté',
    'settings.assistMode.hint': "Affiche l'effet complet de chaque porte pendant une partie. Activé par défaut, se désactive tout seul dès votre premier reset du dé.",
    'settings.assistMode.on': 'Activé',
    'settings.assistMode.off': 'Désactivé',
    'settings.keybinds.hint': 'Touches de déplacement. « Changer » puis une touche. Échap annule.',
    'settings.resetKeybinds': 'Réinitialiser les touches',
    'settings.resetSave': 'Réinitialiser la sauvegarde',
    'settings.add100Gold': '+100 or',
    'settings.resetSave.confirm': 'Réinitialiser toute la progression permanente (or banqué, achats des PNJ et records) ?',
    'settings.changeKey': 'Changer',
    'settings.pressKey': 'Appuyez sur une touche…',

    'stats.title': 'Records',
    'stats.lowestUpgrade.title': 'Amélioration la moins avancée',
    'stats.maxEnergy': 'Énergie maximale atteinte',
    'stats.maxTurns': 'Le plus de salles parcourues sans réinitialisation du dé',
    'stats.maxOnesRerolled': 'Le plus de "1" relancés en une seule partie',
    'stats.totalGoldBanked': 'Or total banqué',
    'stats.maxRunGold': 'Or de partie maximal atteint',

    'rank.bronze': 'Bronze',
    'rank.silver': 'Argent',
    'rank.gold': 'Or',
    'rank.platinum': 'Platine',
    'rank.diamond': 'Diamant',
    'rank.divine': 'Divin',

    'npc.goldBankLabel': 'Or banqué :',
    'npc.free': 'Gratuit',
    'npc.buyPrefix': 'Prendre —',
    'npc.interactHint': 'Visez-le et appuyez sur E',
    'npc.npc1.sub': 'Choix restants pour cette visite : {remaining} (un choix de plus tous les {every} pris — {total} au total jusqu\'ici).',

    'zone.0': 'Donjon de pierre',
    'zone.1': 'Cabane de bois',
    'zone.2': 'Temple doré',
    'zone.3': 'Antre de cristal',
    'zone.4': 'Ruines englouties par la jungle',
    'zone.5': 'Cité engloutie',
    'zone.6': 'Forge infernale',
    'zone.7': 'Bastion de glace',

    'moveKey.forward': 'Avancer',
    'moveKey.back': 'Reculer',
    'moveKey.left': 'Aller à gauche',
    'moveKey.right': 'Aller à droite',
    'moveKey.jump': 'Sauter',

    'diceSpeed.lente': 'Lente',
    'diceSpeed.normale': 'Normale',
    'diceSpeed.rapide': 'Rapide',
    'diceSpeed.instant': 'Instantanée',

    'keyLabel.escape': 'Échap',
    'keyLabel.space': 'Espace',

    'currency.energy': 'énergie',
    'currency.gold': 'or',

    'action.mine.name': 'Mine',
    'action.mine.desc': '+1 or dans 10 tours.',
    'action.canal.name': 'Canalisation',
    'action.canal.desc': '+1 énergie/tour, toute la partie.',
    'action.anti.name': 'Anti-destinée',
    'action.anti.desc': 'Prochain lancer : jamais 1.',
    'action.rejet.name': 'Rejet',
    'action.rejet.desc': "Relance : sauve d'un 1.",
    'action.rajeun.name': 'Rajeunissement',
    'action.rajeun.desc': '+1 face au dé, toute la partie.',
    'action.bonusEnergyGive': '(donne {n} énergie !)',
    'action.bonusEnergyReduce': '(coût -{n})',
    'action.bonusGold': '(+{n} or banqué)',

    'path.skip.name': 'Ne rien faire',
    'path.skip.desc': 'Passe ce tour.',
    'path.double.name': "Doubler l'énergie",
    'path.double.desc': '×2 immédiat, 1 seule fois.',
    'path.cashout.name': "Récupérer l'or",
    'path.cashout.desc': 'Banque {gold} or. La partie continue.',
    'path.bonusDoor.energy': ' (+{n} énergie !)',
    'path.bonusDoor.gold': ' (+{n} or banqué)',

    'npc.npc1.name': 'Le Parieur',
    'npc.npc2.name': "Le Forgeron d'Énergie",
    'npc.npc3.name': "Le Changeur d'Or",

    // Micro-dialogues des PNJ : une ligne par rencontre (première interaction
    // dans une NOUVELLE salle, voir talkToNpc()/renderNpcOverlay() dans
    // game.js), progression narrative fixe en 5 étapes par PNJ — jamais plus
    // d'1-2 phrases, jamais un tutoriel déguisé. Reste affichée telle quelle
    // en reparlant plusieurs fois dans la MÊME salle.
    'npc1.dialogue.0': 'Je connais cette roue mieux que personne. Chaque face a un prix.',
    'npc1.dialogue.1': "Moi aussi, j'ai voulu voir jusqu'où elle pouvait tourner.",
    'npc1.dialogue.2': "J'ai perdu plus de fois que je ne veux m'en souvenir. Puis j'ai arrêté.",
    'npc1.dialogue.3': "Le vrai danger n'a jamais été le 1. C'était de vouloir relancer encore.",
    'npc1.dialogue.4': 'Je ne peux plus tourner cette roue. Toi, tu peux encore.',

    'npc2.dialogue.0': "L'énergie ne ment jamais. Elle dit ce que tu es prêt à payer.",
    'npc2.dialogue.1': 'J\'ai forgé ma propre roue, autrefois. Plus grande, plus affamée.',
    'npc2.dialogue.2': "Chaque salle en demandait plus. Un jour, je n'ai plus pu suivre.",
    'npc2.dialogue.3': "Ce n'est pas l'énergie qui manque en premier. C'est la raison de continuer.",
    'npc2.dialogue.4': 'Prends ce que je peux encore te donner. Va plus loin que moi.',

    'npc3.dialogue.0': "L'or que tu portes n'est jamais le dernier que tu voudras.",
    'npc3.dialogue.1': "J'ai amassé plus que quiconque avant toi. Ça n'a jamais suffi.",
    'npc3.dialogue.2': "Un jour, j'ai tout perdu d'un coup. Je n'ai jamais tout récupéré.",
    'npc3.dialogue.3': 'Le problème n\'était pas la roue. C\'était que je ne savais jamais m\'arrêter.',
    'npc3.dialogue.4': 'Prends cet or. Sache seulement quand cesser d\'en vouloir plus.',

    'npc1.facesForDouble.name': 'Marché du hasard',
    'npc1.facesForDouble.desc': "-8 faces au dé du jugement, mais ×2 énergie immédiat ET un nouveau doubleur d'énergie utilisable (même si le vôtre est déjà dépensé).",
    'npc1.npcChance.name': 'Flair des voyageurs',
    'npc1.npcChance.desc': "Tous les PNJ ont {mult}× plus de chance d'apparaître dans la PROCHAINE salle.",

    'npc2.unlockDoor.name': 'Porte allégée',
    'npc2.unlockDoor.desc': "Débloque : dans chaque salle, une porte a son coût en énergie réduit (peut devenir négatif — la porte donne alors de l'énergie).",
    'npc2.boostDoor.name': 'Porte allégée',
    'npc2.boostDoor.desc': 'Réduction actuelle : {n} énergie. Encore +10.',
    'npc2.rerollPct.name': 'Instinct de survie',
    'npc2.rerollPct.desc': 'Chance de relancer automatiquement un 1 : {pct}%. Encore +1%.',

    'npc3.extraFaces.name': 'Horloge Agrandie',
    'npc3.extraFaces.desc': 'Faces de base de la roue : {n}. Encore +1.',
    'npc3.turn1Energy.name': 'Réveil Vif',
    'npc3.turn1Energy.desc': '+{n} énergie bonus au 1er tour de chaque partie. Encore +10.',
    'npc3.unlockDoor.name': 'Porte généreuse',
    'npc3.unlockDoor.desc': "Débloque : dans chaque salle, une porte rapporte de l'or banqué directement quand on la traverse.",
    'npc3.boostDoor.name': 'Porte généreuse',
    'npc3.boostDoor.desc': 'Bonus actuel : +{n} or banqué. Encore +10.',

    'upgrade.extraFaces': 'Horloge Agrandie (PNJ 3)',
    'upgrade.turn1Energy': 'Réveil Vif (PNJ 3)',
    'upgrade.npc2DoorBonus': 'Porte allégée (PNJ 2)',
    'upgrade.npc2RerollPct': 'Instinct de survie (PNJ 2)',
    'upgrade.npc3DoorBonus': 'Porte généreuse (PNJ 3)',
  },
  en: {
    'page.title': 'Avidité — The Wheel of Judgment',
    'app.title': 'AVIDITÉ',
    'toolbar.rules': 'Rules',
    'toolbar.stats': 'Records',
    'toolbar.settings': 'Settings',

    'dial.faceWord': 'faces',
    'hud.faces': 'Wheel Faces',
    'hud.energy': 'Energy',
    'hud.goldRun': 'Run gold',
    'hud.goldBank': 'Banked gold',

    'lock.title': 'Click to look around',
    'lock.hint': 'Mouse to look — movement keys (configurable) to walk, jump — E to interact with a targeted NPC — Esc to release the cursor',
    'lock.title.touch': 'Tap to start',
    'lock.hint.touch': 'Drag on the right to look — joystick on the left to walk — ⤒ button to jump — E button to interact with a targeted NPC',

    'rules.title': 'Rules',
    'rules.paths.title': 'Paths',
    'rules.paths.body': 'Each turn, 8 paths are offered to you. Taking one applies it immediately, you walk through the passage, then the Wheel of Judgment falls and a new room appears.',
    'rules.dice.title': 'Wheel of Judgment',
    'rules.dice.body': '50 faces at the start, one fewer each turn. On a "1": you lose all the run\'s gold and the wheel goes back to its starting number of faces.',
    'rules.runGold.title': 'Run gold',
    'rules.runGold.body': 'Multiplied by the number of turns played. The longer you stay, the more it weighs — and the more you risk losing it all at once.',
    'rules.actionPaths.title': 'Action paths',
    'rules.actionPaths.mine': '<strong>Mine</strong> — +1 gold in 10 turns.',
    'rules.actionPaths.canal': '<strong>Pipeline</strong> — +1 energy/turn, for the whole run.',
    'rules.actionPaths.anti': '<strong>Anti-fate</strong> — the next roll cannot land on 1.',
    'rules.actionPaths.rejet': '<strong>Reroll</strong> — automatically saves you from a 1.',
    'rules.actionPaths.rajeun': '<strong>Rejuvenation</strong> — +1 wheel face, for the whole run.',
    'rules.actionPaths.closed': "A closed (struck-through) action path means you don't have the energy to take it.",
    'rules.specialPaths.title': 'Special paths',
    'rules.specialPaths.body': '<strong>Do nothing</strong>: passes the turn with no effect. <strong>Double energy</strong>: instant x2, once per run — once taken, this path disappears. <strong>Cash out gold</strong>: banks the run\'s gold into your permanent gold, the run continues.',
    'rules.costs.title': 'Action costs',
    'rules.costs.body': '+20% per purchase, reset at the start of every new run.',
    'rules.npcs.title': 'NPCs',
    'rules.npcs.body': 'Each NPC has a small chance of appearing in a room. Aim at them and press the dedicated key to talk. Their purchases (paid with banked gold, except the Gambler who is free) are permanent, for all your future runs. Their prices increase by 20% with each purchase.',
    'rules.story.title': 'Story',
    'rules.story.body': "The NPCs are people who never managed to satisfy their own greed. Grown old, they eventually gave up — and chose, instead, to help you satisfy yours.",

    'settings.title': 'Settings',
    'settings.diceSpeed.label': 'Wheel speed',
    'settings.volume.label': 'Sound volume',
    'settings.language.label': 'Language',
    'settings.assistMode.label': 'Assisted mode',
    'settings.assistMode.hint': 'Shows the full effect of every door during a run. Enabled by default, turns itself off the first time your wheel resets.',
    'settings.assistMode.on': 'On',
    'settings.assistMode.off': 'Off',
    'settings.keybinds.hint': 'Movement keys. "Change" then a key. Esc cancels.',
    'settings.resetKeybinds': 'Reset keys',
    'settings.resetSave': 'Reset save data',
    'settings.add100Gold': '+100 gold',
    'settings.resetSave.confirm': 'Reset all permanent progress (banked gold, NPC purchases and records)?',
    'settings.changeKey': 'Change',
    'settings.pressKey': 'Press a key…',

    'stats.title': 'Records',
    'stats.lowestUpgrade.title': 'Least advanced upgrade',
    'stats.maxEnergy': 'Highest energy reached',
    'stats.maxTurns': 'Most rooms crossed without a wheel reset',
    'stats.maxOnesRerolled': 'Most 1s rerolled in a single run',
    'stats.totalGoldBanked': 'Total gold banked',
    'stats.maxRunGold': 'Highest run gold reached',

    'rank.bronze': 'Bronze',
    'rank.silver': 'Silver',
    'rank.gold': 'Gold',
    'rank.platinum': 'Platinum',
    'rank.diamond': 'Diamond',
    'rank.divine': 'Divine',

    'npc.goldBankLabel': 'Banked gold:',
    'npc.free': 'Free',
    'npc.buyPrefix': 'Take —',
    'npc.interactHint': 'Aim at them and press E',
    'npc.npc1.sub': 'Choices left for this visit: {remaining} (one more choice every {every} taken — {total} total so far).',

    'zone.0': 'Stone Dungeon',
    'zone.1': 'Wooden Cabin',
    'zone.2': 'Golden Temple',
    'zone.3': 'Crystal Lair',
    'zone.4': 'Jungle-Swallowed Ruins',
    'zone.5': 'Sunken City',
    'zone.6': 'Infernal Forge',
    'zone.7': 'Ice Bastion',

    'moveKey.forward': 'Forward',
    'moveKey.back': 'Backward',
    'moveKey.left': 'Left',
    'moveKey.right': 'Right',
    'moveKey.jump': 'Jump',

    'diceSpeed.lente': 'Slow',
    'diceSpeed.normale': 'Normal',
    'diceSpeed.rapide': 'Fast',
    'diceSpeed.instant': 'Instant',

    'keyLabel.escape': 'Esc',
    'keyLabel.space': 'Space',

    'currency.energy': 'energy',
    'currency.gold': 'gold',

    'action.mine.name': 'Mine',
    'action.mine.desc': '+1 gold in 10 turns.',
    'action.canal.name': 'Pipeline',
    'action.canal.desc': '+1 energy/turn, for the whole run.',
    'action.anti.name': 'Anti-fate',
    'action.anti.desc': 'Next roll: never a 1.',
    'action.rejet.name': 'Reroll',
    'action.rejet.desc': 'Reroll: saves you from a 1.',
    'action.rajeun.name': 'Rejuvenation',
    'action.rajeun.desc': '+1 wheel face, for the whole run.',
    'action.bonusEnergyGive': '(gives {n} energy!)',
    'action.bonusEnergyReduce': '(cost -{n})',
    'action.bonusGold': '(+{n} banked gold)',

    'path.skip.name': 'Do nothing',
    'path.skip.desc': 'Passes this turn.',
    'path.double.name': 'Double energy',
    'path.double.desc': 'Instant ×2, once only.',
    'path.cashout.name': 'Cash out gold',
    'path.cashout.desc': 'Banks {gold} gold. The run continues.',
    'path.bonusDoor.energy': ' (+{n} energy!)',
    'path.bonusDoor.gold': ' (+{n} banked gold)',

    'npc.npc1.name': 'The Gambler',
    'npc.npc2.name': 'The Energy Smith',
    'npc.npc3.name': 'The Gold Changer',

    'npc1.dialogue.0': 'I know this wheel better than anyone. Every face has a price.',
    'npc1.dialogue.1': 'I too wanted to see how far it could spin.',
    'npc1.dialogue.2': "I lost more times than I care to remember. Then I stopped.",
    'npc1.dialogue.3': 'The real danger was never the 1. It was wanting to reroll again.',
    'npc1.dialogue.4': "I can't spin this wheel anymore. You still can.",

    'npc2.dialogue.0': "Energy never lies. It says exactly what you're willing to pay.",
    'npc2.dialogue.1': 'I forged my own wheel once. Bigger. Hungrier.',
    'npc2.dialogue.2': "Every room demanded more. One day, I couldn't keep up.",
    'npc2.dialogue.3': "It's not energy that runs out first. It's the reason to continue.",
    'npc2.dialogue.4': 'Take what I can still give you. Go further than I did.',

    'npc3.dialogue.0': "The gold you're carrying is never the last you'll want.",
    'npc3.dialogue.1': 'I amassed more than anyone before you. It was never enough.',
    'npc3.dialogue.2': 'One day, I lost it all at once. I never got it back.',
    'npc3.dialogue.3': 'The wheel was never the problem. I just never knew when to stop.',
    'npc3.dialogue.4': 'Take this gold. Just know when to stop wanting more.',

    'npc1.facesForDouble.name': 'Deal of chance',
    'npc1.facesForDouble.desc': '-8 faces on the wheel of judgment, but an instant ×2 energy AND a new usable energy doubler (even if yours is already spent).',
    'npc1.npcChance.name': "Traveler's instinct",
    'npc1.npcChance.desc': 'All NPCs have a {mult}× higher chance of appearing in the NEXT room.',

    'npc2.unlockDoor.name': 'Lightened door',
    'npc2.unlockDoor.desc': 'Unlocks: in every room, one door has its energy cost reduced (can go negative — the door then gives energy).',
    'npc2.boostDoor.name': 'Lightened door',
    'npc2.boostDoor.desc': 'Current reduction: {n} energy. +10 more.',
    'npc2.rerollPct.name': 'Survival instinct',
    'npc2.rerollPct.desc': 'Chance to auto-reroll a 1: {pct}%. +1% more.',

    'npc3.extraFaces.name': 'Enlarged Clock',
    'npc3.extraFaces.desc': 'Base wheel faces: {n}. +1 more.',
    'npc3.turn1Energy.name': 'Sharp Wakeup',
    'npc3.turn1Energy.desc': '+{n} bonus energy on turn 1 of every run. +10 more.',
    'npc3.unlockDoor.name': 'Generous door',
    'npc3.unlockDoor.desc': 'Unlocks: in every room, one door pays out banked gold directly when crossed.',
    'npc3.boostDoor.name': 'Generous door',
    'npc3.boostDoor.desc': 'Current bonus: +{n} banked gold. +10 more.',

    'upgrade.extraFaces': 'Enlarged Clock (NPC 3)',
    'upgrade.turn1Energy': 'Sharp Wakeup (NPC 3)',
    'upgrade.npc2DoorBonus': 'Lightened door (NPC 2)',
    'upgrade.npc2RerollPct': 'Survival instinct (NPC 2)',
    'upgrade.npc3DoorBonus': 'Generous door (NPC 3)',
  },
};

function t(key, vars) {
  const lang = (typeof meta !== 'undefined' && meta && meta.lang) ? meta.lang : LANG_DEFAULT;
  let str = (STRINGS[lang] && STRINGS[lang][key]) || (STRINGS[LANG_DEFAULT] && STRINGS[LANG_DEFAULT][key]) || key;
  if (vars) {
    for (const k in vars) str = str.split(`{${k}}`).join(vars[k]);
  }
  return str;
}

/* Remplit tout élément marqué data-i18n="clé" (texte) ou data-i18n-html="clé"
   (HTML, pour les phrases de règles avec <strong>) avec la traduction
   courante. Appelée une fois au démarrage puis à chaque changement de
   langue (voir renderSettings() dans game.js). */
function applyStaticI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    el.innerHTML = t(el.getAttribute('data-i18n-html'));
  });
  document.title = t('page.title');
}

window.t = t;
window.applyStaticI18n = applyStaticI18n;
window.LANGS = LANGS;
window.LANG_LABELS = LANG_LABELS;
