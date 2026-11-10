// Gera os ícones PNG do app (sem dependências): quadrado arredondado roxo com um disco de vinil.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const SS = 3; // supersampling para bordas suaves
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const p = pixel((x + (sx + .5) / SS) / size, (y + (sy + .5) / SS) / size);
        r += p[0] * p[3]; g += p[1] * p[3]; b += p[2] * p[3]; a += p[3];
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = a ? r / a : 0; raw[o + 1] = a ? g / a : 0; raw[o + 2] = a ? b / a : 0; raw[o + 3] = (a / (SS * SS)) * 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const ACCENT = [155, 107, 255], DARK = [18, 12, 34], GROOVE = [36, 28, 58], LIGHT = [238, 233, 255];
function design(maskable) {
  // maskable: fundo cheio e conteúdo menor (zona segura de 80%)
  const radius = maskable ? 0 : 0.22, scale = maskable ? 0.62 : 0.78;
  return (u, v) => {
    // quadrado arredondado
    const dx = Math.max(Math.abs(u - .5) - (.5 - radius), 0), dy = Math.max(Math.abs(v - .5) - (.5 - radius), 0);
    if (radius && Math.hypot(dx, dy) > radius) return [0, 0, 0, 0];
    const d = Math.hypot(u - .5, v - .5) / (scale / 2); // 1 = borda do disco
    if (d > 1) return [...ACCENT, 1];
    if (d > 0.36) { // vinil com sulcos e reflexo
      const groove = Math.sin(d * 70) > 0.55 ? GROOVE : DARK;
      const ang = Math.atan2(v - .5, u - .5);
      const shine = Math.max(0, Math.cos((ang + 0.8) * 2)) * 0.18;
      return [groove[0] + 255 * shine, groove[1] + 255 * shine, groove[2] + 255 * shine, 1];
    }
    if (d > 0.1) return [...ACCENT, 1]; // selo
    return [...LIGHT, 1]; // furo central
  };
}

const out = path.resolve(__dirname, '..', 'public');
fs.mkdirSync(out, { recursive: true });
for (const s of [192, 512]) {
  fs.writeFileSync(path.join(out, `icon-${s}.png`), png(s, design(false)));
  fs.writeFileSync(path.join(out, `icon-maskable-${s}.png`), png(s, design(true)));
}
fs.writeFileSync(path.join(out, 'apple-touch-icon.png'), png(180, design(true)));
fs.writeFileSync(path.join(out, 'favicon.png'), png(64, design(false)));
console.log('ícones gerados em', out);

// Ícones do APK (Android): substitui o ícone padrão do Capacitor
const res = path.resolve(__dirname, '..', 'android', 'app', 'src', 'main', 'res');
if (fs.existsSync(res)) {
  const dens = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  for (const [d, s] of Object.entries(dens)) {
    const dir = path.join(res, `mipmap-${d}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'ic_launcher.png'), png(s, design(false)));
    fs.writeFileSync(path.join(dir, 'ic_launcher_round.png'), png(s, design(false)));
    // camada da frente do ícone adaptativo (108dp, conteúdo na zona segura)
    fs.writeFileSync(path.join(dir, 'ic_launcher_foreground.png'), png(Math.round(s * 2.25), design(true)));
  }
  const bg = path.join(res, 'values', 'ic_launcher_background.xml');
  fs.writeFileSync(bg, '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#9B6BFF</color>\n</resources>\n');
  console.log('ícones do Android gerados em', res);

  // Tela de abertura (Android 10/11 usa estas imagens): fundo escuro com o disco no centro
  const BG = [15, 13, 23];
  const logo = design(false);
  const splashFiles = [];
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name === 'splash.png') splashFiles.push(p); } };
  walk(res);
  for (const file of splashFiles) {
    const head = fs.readFileSync(file).subarray(16, 24);
    const w = head.readUInt32BE(0), h = head.readUInt32BE(4);
    const size = Math.round(Math.min(w, h) * 0.28);
    const x0 = Math.round((w - size) / 2), y0 = Math.round((h - size) / 2);
    const SS = 2;
    const raw = Buffer.alloc((w * 4 + 1) * h);
    for (let y = 0; y < h; y++) {
      raw[y * (w * 4 + 1)] = 0;
      for (let x = 0; x < w; x++) {
        const o = y * (w * 4 + 1) + 1 + x * 4;
        let r = BG[0], g = BG[1], b = BG[2];
        if (x >= x0 && x < x0 + size && y >= y0 && y < y0 + size) {
          let ar = 0, ag = 0, ab = 0;
          for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
            const p = logo((x - x0 + (sx + .5) / SS) / size, (y - y0 + (sy + .5) / SS) / size);
            ar += p[0] * p[3] + BG[0] * (1 - p[3]); ag += p[1] * p[3] + BG[1] * (1 - p[3]); ab += p[2] * p[3] + BG[2] * (1 - p[3]);
          }
          r = ar / (SS * SS); g = ag / (SS * SS); b = ab / (SS * SS);
        }
        raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255;
      }
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
    fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
  }
  console.log(`${splashFiles.length} telas de abertura geradas`);
}
