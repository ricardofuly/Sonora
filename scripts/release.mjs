#!/usr/bin/env node
// Gera e publica uma release do Sonora no GitHub.
//
//   npm run release -- 1.2.0 --notes "O que mudou"          (só a interface mudou → live update no celular)
//   npm run release -- 1.2.0 --native --notes "O que mudou" (código Android mudou → APK novo)
//
// Arquivos publicados na release (o app baixa daqui):
//   Sonora-Setup-<v>.exe, .blockmap, latest.yml   → atualização do desktop (electron-updater)
//   Sonora-<v>.apk                                 → app Android completo
//   sonora-web-<v>.zip                             → só a interface (live update no Android)
//   update.json                                    → o que o app Android consulta
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'ricardofuly/Sonora';
const run = (cmd, opts = {}) => { console.log(`\n> ${cmd}`); execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts }); };
const args = process.argv.slice(2);
const version = args.find(a => /^\d+\.\d+\.\d+$/.test(a));
const native = args.includes('--native');
const notesIdx = args.indexOf('--notes');
const notes = notesIdx >= 0 ? args[notesIdx + 1] : '';
const skipPublish = args.includes('--dry-run');

if (!version) { console.error('Informe a versão, ex.: npm run release -- 1.2.0 [--native] [--notes "..."]'); process.exit(1); }
if (!fs.existsSync(path.join(ROOT, 'android', 'keystore.properties'))) { console.error('Falta android/keystore.properties (chave de assinatura do APK).'); process.exit(1); }

// 1) versão
const pkgFile = path.join(ROOT, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
pkg.version = version;
fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
const nativeFile = path.join(ROOT, 'android', 'native-version.txt');
let nativeCode = parseInt(fs.readFileSync(nativeFile, 'utf8'), 10);
if (native) { nativeCode += 1; fs.writeFileSync(nativeFile, `${nativeCode}\n`); }
console.log(`Sonora ${version} — código nativo ${nativeCode}${native ? ' (novo APK)' : ''}`);

const out = path.join(ROOT, 'release');
fs.mkdirSync(out, { recursive: true });

// 2) interface + pacote do live update
run('npx vite build');
const webZip = path.join(out, `sonora-web-${version}.zip`);
fs.rmSync(webZip, { force: true });
const sevenZip = path.join(ROOT, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
run(`"${sevenZip}" a -tzip "${webZip}" .\\*`, { cwd: path.join(ROOT, 'dist') });

// 3) APK assinado
run('npx cap sync android');
// caminho completo: no Windows o diretório atual pode não estar no caminho de busca de executáveis
const gradle = `"${path.join(ROOT, 'android', process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')}"`;
const gradleOpts = {
  cwd: path.join(ROOT, 'android'),
  env: { ...process.env, JAVA_HOME: process.env.JAVA_HOME || 'C:\\Program Files\\Android\\Android Studio\\jbr' },
};
try { run(`${gradle} assembleRelease --no-daemon -q`, gradleOpts); }
catch { console.log('Gradle falhou; tentando de novo uma vez…'); run(`${gradle} assembleRelease --no-daemon`, gradleOpts); }
const apkOut = path.join(out, `Sonora-${version}.apk`);
fs.copyFileSync(path.join(ROOT, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'), apkOut);

// 4) instalador do Windows (gera também latest.yml para o electron-updater)
run('npx electron-builder --win --publish never', { env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } });

// 5) manifesto lido pelo app Android
const dl = name => `https://github.com/${REPO}/releases/download/v${version}/${name}`;
const manifest = {
  version,
  notes,
  date: new Date().toISOString(),
  web: { url: dl(path.basename(webZip)), minNativeCode: nativeCode },
  android: { versionCode: nativeCode, url: dl(path.basename(apkOut)) },
};
fs.writeFileSync(path.join(out, 'update.json'), JSON.stringify(manifest, null, 2));

const assets = [
  `Sonora-Setup-${version}.exe`, `Sonora-Setup-${version}.exe.blockmap`, 'latest.yml',
  path.basename(apkOut), path.basename(webZip), 'update.json',
].map(f => path.join(out, f));
for (const a of assets) if (!fs.existsSync(a)) { console.error(`Arquivo não gerado: ${a}`); process.exit(1); }

if (skipPublish) { console.log('\n--dry-run: nada foi publicado. Arquivos em release/.'); process.exit(0); }

// 6) commit da versão, tag e release no GitHub
run('git add package.json package-lock.json android/native-version.txt');
try { run(`git commit -m "Versão ${version}"`); } catch { /* nada para commitar */ }
run(`git tag -a v${version} -m "Sonora ${version}"`);
run('git push origin HEAD --follow-tags');
const notesFile = path.join(out, 'notes.md');
fs.writeFileSync(notesFile, `${notes || `Sonora ${version}`}\n\n` +
  `**Windows:** baixe \`Sonora-Setup-${version}.exe\`. Quem já tem o app recebe a atualização sozinho.\n\n` +
  `**Android:** baixe \`Sonora-${version}.apk\`. Quem já tem o app recebe a atualização sozinho.\n`);
run(`gh release create v${version} ${assets.map(a => `"${a}"`).join(' ')} -R ${REPO} --title "Sonora ${version}" --notes-file "${notesFile}"`);
console.log(`\nRelease publicada: https://github.com/${REPO}/releases/tag/v${version}`);
