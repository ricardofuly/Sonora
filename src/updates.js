// Atualizações automáticas a partir das releases do GitHub.
// - Desktop (Electron): electron-updater baixa e instala o instalador novo (ver electron/main.mjs).
// - Android: lê update.json da última release; se a parte nativa mudou, baixa o APK novo;
//   se só a interface mudou, baixa o pacote web e aplica sem reinstalar (live update).
import { isNative, Sonora } from './native.js';

export const REPO = 'ricardofuly/Sonora';
export const MANIFEST_URL = `https://github.com/${REPO}/releases/latest/download/update.json`;
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
export const isDesktop = typeof window !== 'undefined' && !!window.sonoraUpdates;

export function compareVersions(a, b) {
  const x = String(a || '0').split(/[.-]/), y = String(b || '0').split(/[.-]/);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const p = parseInt(x[i] || '0', 10) || 0, q = parseInt(y[i] || '0', 10) || 0;
    if (p !== q) return p > q ? 1 : -1;
  }
  return 0;
}

/** Android: compara a versão instalada com a última release. */
export async function checkMobileUpdate() {
  const info = await Sonora.getAppInfo();
  const res = await fetch(`${MANIFEST_URL}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Não foi possível ler as atualizações (HTTP ${res.status})`);
  const u = await res.json();
  if (u.android && Number(u.android.versionCode) > Number(info.versionCode)) {
    return { type: 'apk', version: u.version, url: u.android.url, notes: u.notes, info };
  }
  const webOk = !u.web?.minNativeCode || Number(u.web.minNativeCode) <= Number(info.versionCode);
  if (u.web && webOk && compareVersions(u.version, info.bundleVersion) > 0) {
    return { type: 'web', version: u.version, url: u.web.url, notes: u.notes, info };
  }
  return { type: 'none', version: info.bundleVersion, info };
}

/** Confirma que a interface atual abriu bem (evita voltar para a versão anterior). */
export function confirmBundleWorks() {
  if (isNative) Sonora.notifyReady().catch(() => {});
}

export const downloadWebUpdate = u => Sonora.applyWebBundle({ url: u.url, version: u.version, reloadNow: false });
export const activateWebUpdate = () => Sonora.activateBundle();
export const installApkUpdate = u => Sonora.installApk({ url: u.url });
