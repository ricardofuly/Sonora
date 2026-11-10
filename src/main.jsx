import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import '@fontsource-variable/inter';
import './styles.css';
import './mobile.css';
import './native.css';
import { isNative } from './native.js';

// App de desktop (Electron): ativa a barra de título integrada
if (new URLSearchParams(location.search).has('desktop')) {
  document.documentElement.dataset.desktop = '';
  sessionStorage.setItem('sonora.desktop', '1');
} else if (sessionStorage.getItem('sonora.desktop')) {
  document.documentElement.dataset.desktop = '';
}
createRoot(document.getElementById('root')).render(<App />);

// PWA (só no navegador): o service worker só funciona em localhost ou HTTPS.
// No APK os arquivos já estão dentro do app, então não precisa.
if (!isNative && 'serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
