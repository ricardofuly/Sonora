// Sonora para desktop: roda o servidor dentro do app e abre a interface numa janela própria.
import { app, BrowserWindow, Tray, Menu, nativeImage, shell, Notification, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.join(here, '..');

// Só uma janela do Sonora por vez: abrir de novo traz a existente para frente
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

app.setAppUserModelId('com.sonora.player');

let win = null;
let tray = null;
let quitting = false;
let server = null;
let trayHintShown = false;

async function startServer() {
  process.env.SONORA_APP_DIR = APP_DIR;
  process.env.SONORA_DATA_DIR = app.getPath('userData'); // %APPDATA%\Sonora
  // Porta fixa 3001 (para o celular achar sempre o mesmo endereço); se estiver ocupada, usa outra livre
  const net = await import('node:net');
  const free = await new Promise(res => {
    const s = net.createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true))).listen(3001, '0.0.0.0');
  });
  process.env.PORT = free ? '3001' : '0';
  server = await import(new URL('../server.js', import.meta.url).href);
  return server.ready;
}

const mediaKey = action => server?.sendEvent('mediakey', { action });

function iconPath() { return path.join(APP_DIR, 'dist', 'icon-512.png'); }

function createWindow(port) {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 380, minHeight: 560,
    backgroundColor: '#0f0d17',
    title: 'Sonora',
    icon: iconPath(),
    autoHideMenuBar: true,
    frame: false, // a barra de título é desenhada pelo próprio Sonora
    show: false,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      backgroundThrottling: false, // continua tocando com a janela minimizada ou na bandeja
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.setMenu(null);
  win.loadURL(`http://localhost:${port}/?desktop=1`);
  win.once('ready-to-show', () => win.show());
  const sendMax = () => win.webContents.send('win:maximized', win.isMaximized());
  win.on('maximize', sendMax);
  win.on('unmaximize', sendMax);

  // links externos (YouTube, Discord etc.) abrem no navegador
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`http://localhost:${port}`)) { e.preventDefault(); shell.openExternal(url); }
  });

  // fechar a janela só esconde: a música continua e o Sonora fica na bandeja
  win.on('close', e => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
    if (!trayHintShown && Notification.isSupported()) {
      trayHintShown = true;
      new Notification({ title: 'Sonora continua tocando', body: 'Ele está na bandeja, perto do relógio. Clique com o botão direito no ícone para sair.', icon: iconPath() }).show();
    }
  });
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createTray() {
  const img = nativeImage.createFromPath(iconPath()).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip('Sonora');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir Sonora', click: showWindow },
    { type: 'separator' },
    { label: 'Tocar / Pausar', click: () => mediaKey('playpause') },
    { label: 'Próxima', click: () => mediaKey('next') },
    { label: 'Anterior', click: () => mediaKey('prev') },
    { type: 'separator' },
    { label: 'Sair', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', showWindow);
}

// Botões da barra de título do Sonora
ipcMain.on('win:minimize', () => win?.minimize());
ipcMain.on('win:toggle-maximize', () => { if (!win) return; win.isMaximized() ? win.unmaximize() : win.maximize(); });
ipcMain.on('win:close', () => win?.close()); // passa pelo "close": esconde na bandeja
ipcMain.handle('win:is-maximized', () => !!win?.isMaximized());

// ---------- Atualização automática (releases do GitHub) ----------
let updateStatus = { state: 'idle', version: null, progress: 0, error: null };
let autoUpdater = null;
function setUpdate(patch) {
  updateStatus = { ...updateStatus, ...patch };
  win?.webContents.send('update:status', updateStatus);
}
async function initUpdates() {
  if (!app.isPackaged) { setUpdate({ state: 'dev' }); return; } // só no app instalado
  const mod = await import('electron-updater');
  autoUpdater = (mod.default || mod).autoUpdater;
  autoUpdater.autoDownload = true;           // baixa em segundo plano
  autoUpdater.autoInstallOnAppQuit = true;   // instala ao sair do app
  autoUpdater.on('checking-for-update', () => setUpdate({ state: 'checking', error: null }));
  autoUpdater.on('update-not-available', () => setUpdate({ state: 'latest' }));
  autoUpdater.on('update-available', i => setUpdate({ state: 'downloading', version: i.version, progress: 0 }));
  autoUpdater.on('download-progress', p => setUpdate({ state: 'downloading', progress: p.percent / 100 }));
  autoUpdater.on('update-downloaded', i => {
    setUpdate({ state: 'ready', version: i.version, progress: 1 });
    if (Notification.isSupported()) {
      const n = new Notification({ title: `Sonora ${i.version} pronto para instalar`, body: 'Será instalado quando você sair do app. Clique para reiniciar agora.', icon: iconPath() });
      n.on('click', () => { quitting = true; autoUpdater.quitAndInstall(); });
      n.show();
    }
  });
  autoUpdater.on('error', e => setUpdate({ state: 'error', error: String(e?.message || e).split('\n')[0].slice(0, 200) }));
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 8000);                 // logo depois de abrir
  setInterval(check, 4 * 60 * 60 * 1000);  // e a cada 4 horas
}
ipcMain.handle('update:get', () => ({ ...updateStatus, current: app.getVersion() }));
ipcMain.handle('update:check', async () => { if (autoUpdater) await autoUpdater.checkForUpdates().catch(() => {}); return { ...updateStatus, current: app.getVersion() }; });
ipcMain.on('update:install', () => { if (autoUpdater && updateStatus.state === 'ready') { quitting = true; autoUpdater.quitAndInstall(); } });

app.on('second-instance', showWindow);
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { /* continua na bandeja */ });

app.whenReady().then(async () => {
  try {
    const port = await startServer();
    createTray();
    createWindow(port);
    initUpdates();
  } catch (e) {
    const { dialog } = await import('electron');
    dialog.showErrorBox('Sonora', `Não foi possível iniciar o Sonora:\n\n${e?.stack || e}`);
    app.exit(1);
  }
});
