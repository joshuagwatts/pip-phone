const KEY = "pip.phone.v1";

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
      brain_pin: "auto",
      groq: "",
      openrouter: "",
      cerebras: "",
      mistral: "",
      gemini: "",
      xai: "",
      desktop_url: "",
      desktop_token: "",
      desktop_password: "",
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
    if (!raw || typeof raw !== "object") return blank();
    const base = blank();
    const settings = { ...base.settings, ...(raw.settings || {}) };
    if (!String(settings.operator || "").trim()) settings.operator = "Joshua";
    return {
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
  } catch {
    return blank();
  }
}

export function save(data) {
  localStorage.setItem(KEY, JSON.stringify(data));
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
