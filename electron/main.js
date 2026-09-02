'use strict';

/* Processus principal Electron — fait tourner Avidité comme une vraie
   application de bureau (pas un onglet de navigateur), en vue d'une
   distribution future sur Steam (demandé explicitement). Le jeu lui-même
   (index.html, js/, assets/, style.css) reste INCHANGÉ et continue de
   tourner exactement comme avant via `python -m http.server` en
   développement rapide (voir .claude/launch.json) — Electron sert ces
   mêmes fichiers tels quels via un petit serveur HTTP local intégré,
   plutôt que via `file://`, pour éviter tout écart de comportement CORS/
   chargement d'assets entre les deux façons de lancer le jeu. */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

const ROOT = path.join(__dirname, '..'); // racine du projet : index.html, js/, assets/, style.css
const PORT = 5510; // distinct du 5507 utilisé par le serveur de dev navigateur, pour ne jamais entrer en conflit si les deux tournent en même temps

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.hdr': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
};

function startLocalServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ''); // pas de sortie de ROOT via ../
      const filePath = path.join(ROOT, safePath === '/' || safePath === '' || safePath === '\\' ? 'index.html' : safePath);
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not found');
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

let mainWindow = null;

async function createWindow() {
  await startLocalServer();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#050403', // --bg0 (style.css) : évite un flash blanc au tout premier affichage
    autoHideMenuBar: true, // pas de barre de menu Fichier/Édition/... — une vraie appli de jeu, pas un navigateur
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, // le jeu (renderer) n'a jamais accès direct à Node/Electron — seulement à window.electronAPI, exposé explicitement par preload.js
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}/`);
}

app.whenReady().then(createWindow).catch(err => {
  // sans ce filet, une erreur ici (ex: port déjà utilisé) restait
  // totalement silencieuse — l'appli se fermait sans aucun message,
  // rencontré pendant les tests de cette configuration.
  console.error('[avidite] échec au démarrage :', err);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// bouton "Quitter" dans les Paramètres (voir js/game.js/index.html) — n'existe
// et ne fonctionne QUE dans cette appli empaquetée (window.electronAPI absent
// dans un navigateur normal, voir preload.js).
ipcMain.handle('app:quit', () => app.quit());
