// Temas: cores de base. A cor de destaque (accent) é escolhida à parte.
export const THEMES = {
  noite:     { name: 'Noite',      dark: true,  bg: '#0f0d17', panel: '#17142a', surface: '#1d1934', surface2: '#2a2548', surface3: '#3a3460', hover: '#231f3d', border: '#3a3360', bar: '#0b0912', text: '#eee9ff', muted: '#8f88aa' },
  breu:      { name: 'Breu',       dark: true,  bg: '#000000', panel: '#0c0c0c', surface: '#141414', surface2: '#1f1f1f', surface3: '#2b2b2b', hover: '#1a1a1a', border: '#2a2a2a', bar: '#000000', text: '#f2f2f2', muted: '#8a8a8a' },
  grafite:   { name: 'Grafite',    dark: true,  bg: '#16181d', panel: '#1d2027', surface: '#252932', surface2: '#2e333e', surface3: '#3a404d', hover: '#2a2f39', border: '#363c48', bar: '#111317', text: '#e8ebf1', muted: '#8b93a3' },
  oceano:    { name: 'Oceano',     dark: true,  bg: '#07131c', panel: '#0c1d2a', surface: '#112636', surface2: '#163246', surface3: '#1f4058', hover: '#132c3e', border: '#1f3d52', bar: '#050e15', text: '#e3f3ff', muted: '#7d9bb0' },
  floresta:  { name: 'Floresta',   dark: true,  bg: '#0b130e', panel: '#111d15', surface: '#16261c', surface2: '#1d3224', surface3: '#284331', hover: '#1a2c20', border: '#274030', bar: '#070d09', text: '#e6f5ea', muted: '#86a38f' },
  vinho:     { name: 'Vinho',      dark: true,  bg: '#160a0e', panel: '#211016', surface: '#2a141c', surface2: '#371a25', surface3: '#4a2333', hover: '#301720', border: '#45202f', bar: '#0f0609', text: '#fbe9ee', muted: '#b08390' },
  claro:     { name: 'Claro',      dark: false, bg: '#f6f5fb', panel: '#ffffff', surface: '#eeecf6', surface2: '#ffffff', surface3: '#e6e2f3', hover: '#e9e6f4', border: '#d9d4ea', bar: '#ffffff', text: '#1c1830', muted: '#6c6782' },
  areia:     { name: 'Areia',      dark: false, bg: '#f7f1e8', panel: '#fffaf2', surface: '#efe6d8', surface2: '#fffaf2', surface3: '#e6dac7', hover: '#ece2d2', border: '#dccfba', bar: '#fffaf2', text: '#2b2418', muted: '#7d705c' },
};

export const ACCENTS = [
  { name: 'Lavanda', color: '#9b6bff' }, { name: 'Verde', color: '#2ecc71' }, { name: 'Ciano', color: '#22c3e6' },
  { name: 'Azul', color: '#4d7cff' }, { name: 'Rosa', color: '#ff5fa2' }, { name: 'Vermelho', color: '#ff4d5a' },
  { name: 'Laranja', color: '#ff8a3d' }, { name: 'Âmbar', color: '#f5b52e' }, { name: 'Menta', color: '#3ee0b0' },
];

export const DEFAULT_APPEARANCE = { theme: 'noite', accent: '#9b6bff', radius: 'rounded', density: 'comfortable', effects: true };

// Texto escuro ou claro sobre a cor de destaque, conforme o contraste
function onColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.32 ? '#120c18' : '#ffffff';
}

export function applyAppearance(a) {
  const t = THEMES[a.theme] || THEMES.noite;
  const root = document.documentElement;
  const vars = {
    '--bg': t.bg, '--panel': t.panel, '--surface': t.surface, '--surface-2': t.surface2, '--surface-3': t.surface3,
    '--hover': t.hover, '--border': t.border, '--bar': t.bar, '--text': t.text, '--muted': t.muted,
    '--accent': a.accent, '--on-accent': onColor(a.accent),
    '--radius': { sharp: '3px', rounded: '10px', round: '18px' }[a.radius] || '10px',
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.dataset.mode = t.dark ? 'dark' : 'light';
  root.dataset.density = a.density;
  root.dataset.effects = a.effects ? 'on' : 'off';
  root.style.colorScheme = t.dark ? 'dark' : 'light';
}
