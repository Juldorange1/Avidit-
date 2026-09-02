'use strict';

/* Pont sécurisé entre le jeu (renderer, sandboxé) et Electron — expose
   UNIQUEMENT window.electronAPI.quit()/isElectron, jamais l'accès Node
   complet (contextIsolation:true dans main.js). C'est cette présence
   (`window.electronAPI`) que js/game.js utilise pour savoir s'il tourne
   dans l'appli empaquetée et afficher le bouton "Quitter" — absent dans un
   navigateur normal, le bouton reste caché (voir wireEvents() dans
   game.js). */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  quit: () => ipcRenderer.invoke('app:quit'),
});
