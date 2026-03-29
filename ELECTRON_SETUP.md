# ClickGo Display - Electron Desktop Wrapper

## Overview
This directory contains the Electron wrapper for the ClickGo-Display React Native Expo app, enabling it to run as a cross-platform desktop application.

## Structure
```
desktop/
├── main.js           # Electron main process
├── preload.js        # Security preload script
└── package.json      # Desktop app dependencies and build config
```

## File Descriptions

### desktop/main.js
The main Electron process that:
- Starts an Express static server serving the Expo web build (`../dist/`)
- Creates a fullscreen, frameless, kiosk-mode BrowserWindow
- Implements auto-updates from GitHub releases via `electron-updater`
- Manages graceful shutdown and server cleanup
- Provides user dialogs for update notifications
- Uses context isolation for security

**Key Features:**
- Runs on port 8767
- Fullscreen and kiosk mode for kiosk displays
- Auto-update checks with user prompts
- DevTools support via DEBUG environment variable
- Proper error handling and logging

### desktop/preload.js
A minimal preload script that maintains security by:
- Enforcing context isolation (no nodeIntegration)
- Providing a boundary between main and renderer processes

### desktop/package.json
Desktop application configuration with:
- Electron 32.x and electron-builder 24.x dependencies
- Express and electron-updater support
- Build scripts for Expo web export and packaging
- Windows NSIS installer configuration
- GitHub release auto-update provider

**Build Configuration:**
- **Product Name:** ClickGo Display
- **Package Name:** clickgo-display-desktop
- **Windows Target:** NSIS installer
- **Artifact Name:** ClickGo-Display-Setup.exe
- **App ID:** com.clickgo.display

## Setup Instructions

### Prerequisites
- Node.js and npm installed
- Expo CLI available
- GitHub personal access token (for auto-updates from private repos)

### Installation
1. Navigate to the desktop directory:
   ```bash
   cd desktop
   npm install
   ```

2. From the root directory, build the web export:
   ```bash
   npm run build:web
   ```
   This exports the React Native app to `../dist/` for serving.

### Development
Run the Electron app in development mode:
```bash
cd desktop
npm start
```

To enable DevTools, set the DEBUG environment variable:
```bash
DEBUG=1 npm start
```

### Building for Distribution

#### Build the Windows installer:
```bash
cd desktop
npm run build
```

This will:
1. Export the Expo web build to `../dist/`
2. Package everything with electron-builder
3. Create `ClickGo-Display-Setup.exe` in `desktop/dist_build/`

#### Manual build steps:
```bash
# Build web export
npm run build:web

# Create installer
cd desktop
npm run dist
```

## GitHub Auto-Update Configuration

The app is configured to check for updates from:
- **Owner:** clickgo-interactive
- **Repo:** ClickGo-Display
- **Update Source:** GitHub releases

### Setting Up Updates
1. Create releases on GitHub with version tags (e.g., v1.0.1)
2. Attach the `ClickGo-Display-Setup.exe` file to each release
3. Users will be notified automatically when updates are available

### Environment Setup
For auto-updates to work with private repositories, ensure a GitHub token is available:
```bash
export GH_TOKEN=your_github_token
npm run dist
```

## Port Configuration
- **Local Server Port:** 8767
- This can be modified in `desktop/main.js` (line 13)

## Troubleshooting

### Web build not found
Ensure you've run `npm run build:web` from the root directory before starting Electron.

### Auto-updater errors
Check the console logs. Verify GitHub releases exist with the correct version tags.

### Kiosk mode issues
On some systems, fullscreen + kiosk mode may behave differently. Modify the BrowserWindow options in `main.js` if needed:
- Remove `kiosk: true` if it causes issues
- Adjust `fullscreen: true` to `maximized: true` for testing

## Security Notes
- Context isolation is enabled for security
- Node integration is disabled in the renderer process
- Static file serving is restricted to the build directory
- All navigation defaults to serve `index.html` for SPA routing

## Next Steps
1. Install dependencies: `cd desktop && npm install`
2. Build the web export: `npm run build:web` (from root)
3. Test locally: `cd desktop && npm start`
4. Create a GitHub release to test auto-updates
5. Build the installer: `npm run build` (from desktop)
