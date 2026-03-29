const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const express = require('express');
const { autoUpdater } = require('electron-updater');

let mainWindow;
let localServer = null;

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

async function setupAutoUpdater() {
    autoUpdater.checkForUpdatesAndNotify();

    autoUpdater.on('update-available', (info) => {
        dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Update Available',
            message: 'A new version of ClickGo Display is available.',
            detail: `Version ${info.version} is ready to download.`,
            buttons: ['Install', 'Later'],
        }).then((result) => {
            if (result.response === 0) {
                autoUpdater.downloadUpdate();
            }
        });
    });

    autoUpdater.on('update-downloaded', (info) => {
        dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Update Ready',
            message: 'Update downloaded. The application will restart.',
            buttons: ['Restart', 'Later'],
        }).then((result) => {
            if (result.response === 0) {
                autoUpdater.quitAndInstall();
            }
        });
    });

    autoUpdater.on('error', (error) => {
        console.error('Auto-updater error:', error);
    });
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
