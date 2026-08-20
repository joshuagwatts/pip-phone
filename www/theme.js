/** UI theme — named colors, chat commands, CSS variables (mirrors app/theme.py). */

export const DEFAULT_THEME = {
  bg: "#0a0f0a",
  panel: "#101810",
  inset: "#0c120c",
  line: "#2f4a2a",
  line_bright: "#4a7a3a",
  phos: "#7dff5a",
  phos_dim: "#3f8f32",
  you: "#7dff5a",
  amber: "#d4a84b",
  warn: "#e07050",
  leak: "#ff3a3a",
  text: "#c5e0b4",
  muted: "#6d8a60",
  black: "#050805",
};

const THEME_VAR_KEYS = Object.keys(DEFAULT_THEME);

const NAMED = {
  "phthalo green": "#0d4f3c",
  "phalo green": "#0d4f3c",
  phthalo: "#0d4f3c",
  phalo: "#0d4f3c",
  phosphor: "#7dff5a",
  phos: "#7dff5a",
  "terminal green": "#7dff5a",
  "matrix green": "#00ff41",
  "phthalo blue": "#000f89",
  "phalo blue": "#000f89",
  cobalt: "#0047ab",
  ultramarine: "#3f00ff",
  "cadmium red": "#e30022",
  vermillion: "#e34234",
  crimson: "#dc143c",
  "burnt sienna": "#e97451",
  ochre: "#cc7722",
  amber: "#d4a84b",
  teal: "#008080",
  seafoam: "#93e9be",
  mint: "#98ff98",
  sage: "#9caf88",
  forest: "#228b22",
  emerald: "#50c878",
  jade: "#00a86b",
  lavender: "#b57edc",
  violet: "#8f00ff",
  magenta: "#ff00ff",
  rose: "#ff007f",
  coral: "#ff7f50",
  slate: "#708090",
  charcoal: "#36454f",
  midnight: "#191970",
  navy: "#000080",
  indigo: "#4b0082",
  cyan: "#00ffff",
  sky: "#87ceeb",
  rust: "#b7410e",
  copper: "#b87333",
  black: "#050805",
  white: "#f5f5f5",
  red: "#ff3a3a",
  green: "#7dff5a",
  blue: "#4a9eff",
  yellow: "#ffd700",
  orange: "#ff8c00",
  purple: "#9b59b6",
  pink: "#ff69b4",
};

const COLOR_NAMES = Object.keys(NAMED).sort((a, b) => b.length - a.length);
const COLOR_WORD = new RegExp(`\\b(${COLOR_NAMES.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "i");
const LOOK_WORDS =
  /\b(ui|theme|color|colour|palette|look|vibe|aesthetic|background|bg|accent|phos|phosphor|interface|screen|app|hud|paint|tint|hue|neon|pastel|skin)\b/i;
const SHIFT_CMD =
  /\b(warmer|cooler|darker|brighter|softer|more neon|too (?:dark|bright|green|blue|red|cold|warm))\b/i;
const NOT_THEME =
  /\b(apply|application|job|hail|storm|zillow|calendar|resume|cover letter|open call|deadline|opp)\b/i;
const THEME_CMD =
  /\b(change|make|set|paint|turn|switch|go|shift|recolor|recolour|theme|refresh|reload|reapply|update|fix|sync|want|need|use|try)\b.{0,48}\b(ui|theme|color|colour|colors|colours|background|bg|accent|phos|phosphor|palette|look|aesthetic|app|interface|screen|hud|vibe)\b|\b(ui|theme|palette|interface|app|hud)\b.{0,24}\b(to|as|→)\b|\b(phthalo|phalo|phosphor|terminal|matrix)\b.{0,12}\b(green|blue)\b|\b(make|paint|go|turn) (it|everything|the app|this|me)?\s*(more\s+)?(green|blue|pink|purple|red|orange|yellow|teal|amber|rose|cobalt|navy|cyan|magenta|violet|mint|forest|black|white|phthalo|phalo|phosphor)\b/i;
const REFRESH_CMD =
  /\b(refresh|reload|reapply|update|fix|sync)\b.{0,32}\b(ui|theme|color|colour|colors|colours|palette|look|accent|phos|phosphor|interface|screen|app)\b|\b(ui|theme|color|palette|colours|colors)\b.{0,16}\b(refresh|reload|reapply|fix)\b/i;
const RESET_CMD =
  /\b(reset|default|restore|undo|fix)\b.{0,24}\b(ui|theme|color|colour|palette|colors|green|phosphor)\b|\b(back to|return to)\b.{0,16}\b(default|green|phosphor)\b/i;

function hexToRgb(h) {
  const x = h.replace("#", "");
  return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)];
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b); const mn = Math.min(r, g, b);
  let h = 0; let s = 0; const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (mx === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h * 360, s, l];
}

function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  let r; let g; let b;
  if (s === 0) r = g = b = l;
  else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  const hx = (n) => Math.round(n * 255).toString(16).padStart(2, "0");
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}

function deriveFromAccent(accent, keepYou) {
  const [r, g, b] = hexToRgb(accent);
  const [h, s] = rgbToHsl(r, g, b);
  const sat = Math.min(Math.max(s * 0.55, 0.12), 0.45);
  const you =
    keepYou && String(keepYou).startsWith("#") ? keepYou : DEFAULT_THEME.you;
  return {
    phos: accent,
    phos_dim: hslToHex(h, sat * 0.7, 0.28),
    you,
    bg: hslToHex(h, sat * 0.35, 0.04),
    panel: hslToHex(h, sat * 0.28, 0.06),
    inset: hslToHex(h, sat * 0.22, 0.05),
    line: hslToHex(h, sat * 0.4, 0.18),
    line_bright: hslToHex(h, sat * 0.55, 0.28),
    text: hslToHex(h, sat * 0.25, 0.78),
    muted: hslToHex(h, sat * 0.2, 0.48),
    amber: DEFAULT_THEME.amber,
    warn: DEFAULT_THEME.warn,
    leak: DEFAULT_THEME.leak,
    black: hslToHex(h, sat * 0.2, 0.02),
  };
}

function parseDualColors(text) {
  const t = String(text || "");
  let youC = null;
  let uiC = null;
  const uiM = t.match(
    /\b(?:ui|hud|app|interface)\b(?:\s+\w+){0,6}\s+(?:in|to|as|be)?\s*(cyan|aqua|phosphor|phos|teal|green|amber|orange|#[0-9a-fA-F]{6}|[a-z][a-z\s-]{2,20})/i,
  );
  if (uiM) uiC = resolveColor(uiM[1]) || resolveColor(uiM[0]);
  const shortYou = t.match(/^\s*you\s+(phosphor|phos|cyan|amber|orange|green|#[0-9a-fA-F]{6})\s*$/i);
  if (shortYou) youC = resolveColor(shortYou[1]);
  const shortUi = t.match(/^\s*ui\s+(cyan|aqua|phosphor|phos|teal|green|#[0-9a-fA-F]{6})\s*$/i);
  if (shortUi) uiC = resolveColor(shortUi[1]) || uiC;
  if (!youC) {
    const youM =
      t.match(/\bi want (?:it|them|you|my responses?)\s+to\s+be\s+(phosphor|phos|cyan|green|#[0-9a-fA-F]{6})/i) ||
      t.match(/\b(?:make|set)\s+(?:it|them|you|my responses?)\s+(phosphor|phos|cyan|green|#[0-9a-fA-F]{6})/i) ||
      t.match(/\byou\s+(phosphor|phos|cyan|amber|orange|green|#[0-9a-fA-F]{6})\b/i) ||
      t.match(
        /\b(?:my\s+responses?|responses?)\b.{0,60}?\b(?:to\s+be)\s+(phosphor|phos|cyan|green|#[0-9a-fA-F]{6})/i,
      );
    if (youM) youC = resolveColor(youM[1]);
  }
  return { youC, uiC };
}

function searchBlob(text) {
  const raw = String(text || "");
  const hex = raw.match(/#([0-9a-fA-F]{6})\b/);
  if (hex) return { blob: "", hex: `#${hex[1].toLowerCase()}` };

  const target =
    raw.match(/\b(?:to|as|be|into)\s+(?:a\s+)?([a-z][a-z0-9\s-]{2,40})/i) ||
    raw.match(/\b((?:phthalo|phalo|phosphor)\s+(?:green|blue))\b/i) ||
    raw.match(/\b(?:make|paint|go|turn|want)\s+(?:it|everything|the app|this|the ui|the theme)?\s*([a-z][a-z0-9\s-]{2,30})/i);
  let blob = (target ? (target[1] || target[0]) : raw).toLowerCase();
  blob = blob.replace(/[^\w\s#-]/g, " ").replace(/\s+/g, " ").trim();
  blob = blob.replace(/\bnot\s+[a-z]+(?:\s+[a-z]+)?/g, " ");
  return { blob, hex: null };
}

function shiftAccent(hex, kind) {
  const [r, g, b] = hexToRgb(hex || DEFAULT_THEME.phos);
  let [h, s, l] = rgbToHsl(r, g, b);
  const k = String(kind || "").toLowerCase();
  if (/warm|too (cold|blue|green)/.test(k)) h = (h + 28) % 360;
  else if (/cool|too (warm|red|orange)/.test(k)) h = (h + 330) % 360;
  else if (/dark|too bright/.test(k)) l = Math.max(0.18, l * 0.72);
  else if (/bright|too dark/.test(k)) l = Math.min(0.72, l * 1.25 + 0.08);
  else if (/soft|pastel/.test(k)) {
    s = Math.max(0.25, s * 0.7);
    l = Math.min(0.68, l + 0.12);
  } else if (/neon/.test(k)) {
    s = Math.min(1, s * 1.3 + 0.15);
    l = Math.min(0.62, Math.max(0.45, l));
  }
  return hslToHex(h, Math.min(1, Math.max(0.2, s)), Math.min(0.75, Math.max(0.22, l)));
}

export function resolveColor(text) {
  const { blob, hex } = searchBlob(text);
  if (hex) return hex;
  const keys = Object.keys(NAMED).sort((a, b) => b.length - a.length);
  for (const name of keys) {
    if (blob.includes(name)) return NAMED[name];
  }
  const full = String(text || "").toLowerCase().replace(/[^\w\s#-]/g, " ").replace(/\s+/g, " ");
  for (const name of keys) {
    if (full.includes(name)) return NAMED[name];
  }
  return null;
}

export function clearThemeOverrides() {
  const root = document.documentElement;
  for (const k of THEME_VAR_KEYS) {
    root.style.removeProperty(`--${k.replace(/_/g, "-")}`);
  }
}

export function applyTheme(theme, { hardReset = false } = {}) {
  if (hardReset) clearThemeOverrides();
  const t = hardReset ? { ...DEFAULT_THEME } : { ...DEFAULT_THEME, ...(theme || {}) };
  const root = document.documentElement;
  for (const [k, v] of Object.entries(t)) {
    if (typeof v === "string" && v.startsWith("#")) {
      root.style.setProperty(`--${k.replace(/_/g, "-")}`, v);
    }
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && t.bg) meta.setAttribute("content", t.bg);
  document.body?.classList.toggle("theme-custom", !hardReset && Boolean(theme));
  return t;
}

export function resetTheme(settings) {
  clearThemeOverrides();
  settings.ui_theme = null;
  settings.ui_theme_name = "default";
  applyTheme(DEFAULT_THEME, { hardReset: true });
  return DEFAULT_THEME;
}

export function getStoredTheme(settings) {
  const raw = settings?.ui_theme;
  if (!raw || typeof raw !== "object") return { ...DEFAULT_THEME };
  return { ...DEFAULT_THEME, ...raw };
}

export function saveTheme(settings, theme, name = "") {
  settings.ui_theme = { ...DEFAULT_THEME, ...theme };
  if (name) settings.ui_theme_name = name;
  return settings.ui_theme;
}

function labelHint(text) {
  const { blob } = searchBlob(text);
  const keys = Object.keys(NAMED).sort((a, b) => b.length - a.length);
  for (const name of keys) {
    if (blob.includes(name)) return name;
  }
  const full = String(text || "").toLowerCase();
  for (const name of keys) {
    if (full.includes(name)) return name;
  }
  const m = text.match(/\b(to|as)\s+(.+)$/i);
  return m ? m[2].trim().replace(/[.!?]+$/, "") : "";
}

export function looksLikeThemeRequest(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (RESET_CMD.test(t) || REFRESH_CMD.test(t) || SHIFT_CMD.test(t)) return true;
  if (NOT_THEME.test(t) && !LOOK_WORDS.test(t)) return false;
  if (THEME_CMD.test(t)) return true;
  if (/\b(phthalo|phalo)\s+(green|blue)\b/i.test(t)) return true;
  if (LOOK_WORDS.test(t) && (resolveColor(t) || SHIFT_CMD.test(t))) return true;
  if (COLOR_WORD.test(t) && t.split(/\s+/).length <= 10) return true;
  if (resolveColor(t) && t.split(/\s+/).length <= 6) return true;
  return false;
}

function refreshStoredTheme(settings) {
  const name = settings.ui_theme_name || "default";
  const stored = settings?.ui_theme;
  if (!stored || typeof stored !== "object" || !stored.phos) {
    resetTheme(settings);
    return {
      ok: true,
      theme: DEFAULT_THEME,
      name: "default",
      reply: "No custom theme saved — phosphor green default is on.",
    };
  }
  const theme = getStoredTheme(settings);
  applyTheme(theme);
  return {
    ok: true,
    theme,
    name,
    reply: `Re-applied ${name} (${theme.phos}). Name a color to change it.`,
  };
}

/** Returns { ok, reply, theme, name } or null if not a theme command. */
export function tryThemeCommand(text, settings) {
  const t = String(text || "").trim();
  if (!t) return null;
  if (RESET_CMD.test(t)) {
    const theme = resetTheme(settings);
    return { ok: true, theme, name: "default", reply: "Back to phosphor green default. Cleared the bad palette." };
  }
  const { youC, uiC } = parseDualColors(t);
  if (youC || uiC) {
    const cur = getStoredTheme(settings);
    let theme = { ...cur };
    const bits = [];
    if (uiC) {
      theme = deriveFromAccent(uiC, youC || cur.you);
      bits.push(`HUD ${labelHint(t) || uiC} (${theme.phos})`);
    }
    if (youC) {
      theme = { ...theme, you: youC };
      bits.push(`YOU ${youC}`);
    }
    saveTheme(settings, theme, bits.join(" · ") || "custom");
    applyTheme(theme);
    return {
      ok: true,
      theme,
      name: settings.ui_theme_name || "custom",
      reply: `${bits.join(" · ")}. Say “you phosphor” / “ui cyan” anytime.`,
    };
  }
  const explicitPaint = Boolean(resolveColor(t) && /\b(make|paint|set|go|turn|want)\b/i.test(t) && COLOR_WORD.test(t) && !SHIFT_CMD.test(t));
  if (SHIFT_CMD.test(t) && !explicitPaint) {
    const current = getStoredTheme(settings);
    const color = shiftAccent(current.phos, t);
    const theme = deriveFromAccent(color, current.you);
    const label = (t.match(SHIFT_CMD) || ["shifted"])[0];
    saveTheme(settings, theme, label);
    applyTheme(theme);
    return {
      ok: true,
      theme,
      name: label,
      reply: `Shifted the HUD ${label} (${theme.phos}). YOU stays ${theme.you}.`,
    };
  }
  if (looksLikeThemeRequest(t) && resolveColor(t)) {
    const color = resolveColor(t);
    const cur = getStoredTheme(settings);
    const keep = /\b(everything|whole|all)\b/i.test(t) ? color : cur.you;
    const theme = deriveFromAccent(color, keep);
    if (/\b(everything|whole|all)\b/i.test(t)) theme.you = color;
    const label = labelHint(t) || color;
    saveTheme(settings, theme, label);
    applyTheme(theme);
    return {
      ok: true,
      theme,
      name: label,
      reply: `Painted the HUD in ${label} (${theme.phos}). YOU stays ${theme.you} — say “you phosphor” to change.`,
    };
  }
  if (REFRESH_CMD.test(t)) {
    return refreshStoredTheme(settings);
  }
  if (!looksLikeThemeRequest(t)) return null;
  return {
    ok: false,
    reply: "Chat colors: “you phosphor” · “ui cyan” · “you green ui cyan”. Or reset ui theme.",
  };
}

export function applyThemePayload(settings, payload) {
  if (!payload || typeof payload !== "object") return false;
  const theme = payload.theme || payload;
  if (!theme || !theme.phos) return false;
  saveTheme(settings, theme, payload.name || payload.theme_name || settings.ui_theme_name || "");
  applyTheme(theme);
  return true;
}

export function bootTheme(settings) {
  const stored = settings?.ui_theme;
  if (!stored || typeof stored !== "object") {
    clearThemeOverrides();
    return DEFAULT_THEME;
  }
  return applyTheme(getStoredTheme(settings));
}
