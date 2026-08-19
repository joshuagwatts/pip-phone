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
    dirty: { answers: [] },
    settings: {
      operator: "Joshua",
      humor: 89,
      honesty: 90,
      groq: "",
      openrouter: "",
      cerebras: "",
      mistral: "",
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
