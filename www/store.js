const KEY = "pip.phone.v1";

/** M2: once the encrypted sidecar is live (www/store-vault.js), chat/events
 *  must never be written to this plaintext blob again. The flag flips only
 *  after loadStoreVault() succeeds — initSecrets() saves BEFORE that point
 *  with a separately-loaded db, and stripping there would wipe plaintext
 *  chat before migration. */
let stripChatAtRest = false;
export function setStripChatAtRest(on) {
  stripChatAtRest = Boolean(on);
}

/** Secret fields must never persist in this blob (see www/secrets.js). Kept
 *  local here to avoid an import cycle (secrets.js imports this module). */
const SECRET_FIELDS = [
  "groq",
  "openrouter",
  "cerebras",
  "mistral",
  "gemini",
  "xai",
  "deepseek",
  "openai",
  "anthropic",
  "nvidia",
  "cloudflare",
  "cloudflare_account",
  "zai",
  "ollama",
  "desktop_token",
  "desktop_password",
];

export const KIT_LABELS = [
  ["full_name", "Full name"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["city", "City"],
  ["state", "State"],
  ["country", "Country"],
  ["artist_name", "Artist / project name"],
  ["one_liner", "One-liner"],
  ["bio_short", "Short bio"],
  ["bio_long", "Artist statement"],
  ["origin", "How this started"],
  ["why_festivals", "Why live / festivals"],
  ["materials", "What I make"],
  ["links", "Links"],
];

const emptyKit = () => Object.fromEntries(KIT_LABELS.map(([k]) => [k, ""]));

function blank() {
  return {
    kit: { ...emptyKit(), resume: "", digest: { sources: [], links_key: "" } },
    opps: [],
    chat: [],
    moments: [],
    events: [],
    meals: null,
    dirty: { answers: [] },
    settings: {
      operator: "Joshua",
      humor: 89,
      honesty: 90,
      privacy_mode: "secure",
      privacy_choice_v1: false,
      keysConfigured: false,
      brain_pin: "auto",
      chat_agent: "pip",
      // NOTE: API keys + desktop_token live in the secrets vault (www/secrets.js),
      // never in this blob. desktop_password is never persisted at all —
      // re-pairing requires re-entering it.
      desktop_url: "",
      desktop_paired: false,
      desktop_live: null,
      biometric_lock: true,
      biometric_native: false,
      lat: "",
      lon: "",
      city: "",
      vpn_url: "",
      vpn_host: "",
      vpn_note: "",
      proton_url: "",
      keepalive: false,
      briefings_on: true, // Phase 2 Briefing Engine (www/briefing.js)
      nudges_on: true,
      quiet_start: "22:00",
      quiet_end: "07:00",
      vpn_bypass: "ask", // M1: "ask" | "always" | "never" — Wi‑Fi bind when a VPN is active is never silent
      keys_synced_at: "",
      keys_synced_count: 0,
      ui_theme: null,
      ui_theme_name: "",
      brain_health: {},
    },
  };
}

export function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!raw || typeof raw !== "object") {
      // Fresh install: default SECURE, choice recorded — no prompt needed.
      const fresh = blank();
      fresh.settings.privacy_choice_v1 = true;
      return fresh;
    }
    const base = blank();
    const settings = { ...base.settings, ...(raw.settings || {}) };
    if (!String(settings.operator || "").trim()) settings.operator = "Joshua";
    // Defensive: strip any secret fields that survived in an old blob.
    for (const f of SECRET_FIELDS) {
      if (f in settings) delete settings[f];
    }
    const out = {
      ...base,
      ...raw,
      kit: { ...base.kit, ...(raw.kit || {}) },
      settings,
      opps: Array.isArray(raw.opps) ? raw.opps : [],
      chat: Array.isArray(raw.chat) ? raw.chat : [],
      moments: Array.isArray(raw.moments) ? raw.moments : [],
      events: Array.isArray(raw.events) ? raw.events : [],
      meals: raw.meals && typeof raw.meals === "object" ? raw.meals : null,
      opp_sync_at: raw.opp_sync_at || "",
      opp_digest: raw.opp_digest || null,
    };
    // Existing install that never made an explicit privacy choice:
    // app.js shows the one-time chooser. Transient — not persisted.
    if (!settings.privacy_choice_v1) out.needsPrivacyChoice = true;
    return out;
  } catch {
    return blank();
  }
}

export function save(data) {
  // Belt-and-braces: secrets live in the vault (www/secrets.js), never here.
  // Strip them on every write so no code path can persist key material.
  try {
    const s = data && data.settings;
    if (s) {
      for (const f of SECRET_FIELDS) {
        if (f in s) delete s[f];
      }
    }
  } catch {
    /* never let scrubbing break a save */
  }
  // M2: chat/events/runlog live in the encrypted sidecar (www/store-vault.js),
  // never in this plaintext blob — but ONLY once the sidecar is live. The
  // flag flips in loadStoreVault(); saves before that (e.g. initSecrets)
  // keep the plaintext so migration can't lose it.
  let out = data;
  if (stripChatAtRest) {
    try {
      out = { ...data, chat: [], events: [] };
    } catch {
      out = data;
    }
  }
  localStorage.setItem(KEY, JSON.stringify(out));
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
