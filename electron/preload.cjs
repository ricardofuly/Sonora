// Ponte segura entre a página e a janela: só expõe os controles da janela.
const { contextBridge, ipcRenderer } = require('electron');

// Atualizações automáticas do app de desktop
contextBridge.exposeInMainWorld('sonoraUpdates', {
  get: () => ipcRenderer.invoke('update:get'),
  check: () => ipcRenderer.invoke('update:check'),
  install: () => ipcRenderer.send('update:install'),
  onStatus: cb => {
    const h = (_e, s) => cb(s);
    ipcRenderer.on('update:status', h);
    return () => ipcRenderer.removeListener('update:status', h);
  },
});

contextBridge.exposeInMainWorld('sonoraWindow', {
  minimize: () => ipcRenderer.send('win:minimize'),
  toggleMaximize: () => ipcRenderer.send('win:toggle-maximize'),
  close: () => ipcRenderer.send('win:close'),
  isMaximized: () => ipcRenderer.invoke('win:is-maximized'),
  onMaximizeChange: cb => {
    const h = (_e, v) => cb(v);
    ipcRenderer.on('win:maximized', h);
    return () => ipcRenderer.removeListener('win:maximized', h);
  },
});
