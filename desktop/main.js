const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const express = require('express');
const { autoUpdater } = require('electron-updater');

let mainWindow;
let localServer = null;

// État global de la mise à jour
const updateState = { status: 'idle', progress: 0, version: null, error: null };

function startLocalServer(webBuildPath) {
    return new Promise((resolve, reject) => {
        const srv = express();
        const PORT = 8767;

        srv.use(express.static(webBuildPath));
        srv.get('*', (req, res) => {
            res.sendFile(path.join(webBuildPath, 'index.html'));
        });

        localServer = srv.listen(PORT, () => {
            console.log(`Local server started at http://localhost:${PORT}`);
            resolve(`http://localhost:${PORT}`);
        }).on('error', reject);
    });
}

function createWindow(url) {
    mainWindow = new BrowserWindow({
        width: 1920,
        height: 1080,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: false,
        },
        fullscreen: true,
        frame: false,
        kiosk: true,
    });

    mainWindow.loadURL(url);

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Open DevTools in development
    if (process.env.DEBUG) {
        mainWindow.webContents.openDevTools();
    }
}

// ── Helpers pour envoyer au renderer ──
function sendToRenderer(channel, ...args) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, ...args);
    }
}

// ── IPC Handlers ──
ipcMain.handle('updater-check', async () => {
    try {
        const result = await autoUpdater.checkForUpdates();
        if (!result || !result.updateInfo) return { status: 'noRelease' };
        return { status: 'ok', version: result.updateInfo.version };
    } catch (err) {
        const msg = err.message || '';
        let userMsg = 'Impossible de vérifier les mises à jour';
        if (msg.includes('404') || msg.includes('No published versions'))
            userMsg = 'Aucune version publiée trouvée';
        else if (msg.includes('401') || msg.includes('403'))
            userMsg = 'Accès refusé — le dépôt est peut-être privé';
        else if (msg.includes('ENOTFOUND') || msg.includes('network'))
            userMsg = 'Pas de connexion internet';
        updateState.status = 'error'; updateState.error = userMsg;
        sendToRenderer('updater-error', userMsg);
        return { status: 'error', message: userMsg };
    }
});

ipcMain.handle('updater-install', () => { autoUpdater.quitAndInstall(); });
ipcMain.handle('updater-status', () => ({ ...updateState }));
ipcMain.handle('app-version', () => app.getVersion());

async function setupAutoUpdater() {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => {
        console.log('[Updater] Vérification des mises à jour…');
        updateState.status = 'checking';
    });

    autoUpdater.on('update-available', (info) => {
        console.log(`[Updater] Mise à jour disponible : v${info.version}`);
        updateState.status = 'downloading'; updateState.version = info.version;
        sendToRenderer('updater-available', info.version);
    });

    autoUpdater.on('update-not-available', () => {
        console.log('[Updater] Aucune mise à jour disponible.');
        updateState.status = 'not-available';
        sendToRenderer('updater-not-available');
    });

    autoUpdater.on('download-progress', (progress) => {
        const pct = Math.round(progress.percent);
        console.log(`[Updater] Téléchargement : ${pct}%`);
        updateState.status = 'downloading'; updateState.progress = pct;
        sendToRenderer('updater-progress', pct);
    });

    autoUpdater.on('update-downloaded', (info) => {
        console.log(`[Updater] Téléchargé : v${info.version}`);
        updateState.status = 'downloaded'; updateState.version = info.version; updateState.progress = 100;
        sendToRenderer('updater-downloaded', info.version);
    });

    autoUpdater.on('error', (error) => {
        console.error('[Updater] Erreur :', error.message);
        updateState.status = 'error'; updateState.error = error.message;
        sendToRenderer('updater-error', error.message);
    });

    // Première vérification 15s après le démarrage, puis toutes les 2h
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 15_000);
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 2 * 60 * 60 * 1000);
}

async function init() {
    // En production : les fichiers sont dans resources/dist
    // En dev : les fichiers sont dans ../dist
    const webBuildPath = app.isPackaged
        ? path.join(process.resourcesPath, 'dist')
        : path.join(__dirname, '..', 'dist');

    if (!fs.existsSync(webBuildPath)) {
        console.error(`Web build not found at ${webBuildPath}`);
        dialog.showErrorBox(
            'Erreur',
            'Dossier web-build introuvable. Lancez : npm run build:web'
        );
        app.quit();
        return;
    }

    try {
        // Start local server
        const serverUrl = await startLocalServer(webBuildPath);

        // Create window
        createWindow(serverUrl);

        // Setup auto-updater
        await setupAutoUpdater();
    } catch (error) {
        console.error('Failed to start application:', error);
        dialog.showErrorBox('Error', `Failed to start application: ${error.message}`);
        app.quit();
    }
}

app.on('ready', init);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        init();
    }
});

// Cleanup on app quit
app.on('will-quit', () => {
    if (localServer) {
        localServer.close();
    }
});
