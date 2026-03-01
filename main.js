// main.js - Electron entry point for RPG Character Sheet
const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 900,
        minWidth: 1024,
        minHeight: 768,
        icon: path.join(__dirname, 'icon.ico'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            enableRemoteModule: false,
            partition: 'persist:rpg-sheet'
        },
        backgroundColor: '#667eea',
        title: 'RPG Character Sheet'
    });

    mainWindow.loadFile('index.html');

    // Create application menu
    const template = [
        {
            label: 'File',
            submenu: [
                {
                    label: 'New Character',
                    accelerator: 'CmdOrCtrl+N',
                    click: () => {
                        mainWindow.reload();
                    }
                },
                { type: 'separator' },
                {
                    label: 'Exit',
                    accelerator: 'CmdOrCtrl+Q',
                    click: () => {
                        app.quit();
                    }
                }
            ]
        },
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' }
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'About',
                    click: () => {
                        const { dialog } = require('electron');
                        dialog.showMessageBox(mainWindow, {
                            type: 'info',
                            title: 'About RPG Character Sheet',
                            message: 'RPG Character Sheet v2.0.2',
                            detail: 'Code and Design by Brewer Game Studios 2026.\n\n' +
                                'Compatible with the 5th Edition of the worlds most popular tabletop RPG.\n\n' +
                                'May your rolls always be with advantage.'
                        });
                    }
                },
                {
                    label: 'Contact Support',
                    click: () => {
                        const { shell } = require('electron');
                        shell.openExternal('mailto:BrewerGameStudios@Gmail.com');
                    }
                },
                {
                    label: 'Report a Bug',
                    click: () => {
                        const { shell } = require('electron');

                        // Define the email parameters
                        const email = 'BrewerGameStudios@Gmail.com';
                        const subject = encodeURIComponent('Bug Report: RPG Character Sheet v2.0.2');
                        const body = encodeURIComponent(
                            '--- BUG REPORT ---\n' +
                            'Description of Issue:\n\n' +
                            'Steps to Reproduce:\n\n' +
                            'Expected Result:\n\n' +
                            'Actual Result:\n\n' +
                            '--- System Info ---\n' +
                            'Platform: Windows (Electron App)\n' +
                            'Version: 2.0.2'
                        );

                        // This opens the default email client with everything filled out
                        shell.openExternal(`mailto:${email}?subject=${subject}&body=${body}`);
                    }
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});