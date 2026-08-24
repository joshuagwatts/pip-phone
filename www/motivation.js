import { SHADERS, SHADER_ORDER } from "./shaders.js";
import { wakeNext } from "./morning.js";

export const STEM_TAGS = {
  water: ["water", "drink", "eat", "lunch", "glass", "thirst", "ocean", "caustic", "aqua", "sip", "hydrate"],
  face: ["face", "splash", "wash", "cold", "rain", "wake", "skin"],
  mint: ["mint", "teeth", "fresh", "clean", "sparkle", "ice", "proceed"],
  breath: ["breath", "breathe", "patient", "patience", "inward", "audit", "honest", "still", "slow", "inhale", "exhale", "pause", "deep"],
  move: ["move", "going", "after", "body", "grind", "muscle", "run", "push", "act", "do", "next", "work"],
  sendoff: ["roses", "shine", "worth", "dream", "light", "love", "gold", "sun", "inspire", "awesome", "sunrise"],
  tunnel: ["tunnel", "speed", "hyperspace", "focus", "forward", "warp"],
  "bass-pulse": ["bass", "pulse", "kick", "music", "dance", "beat"],
};

const STANCES = [
  { id: "lunch", lo: 12, hi: 14, label: "LUNCH" },
  { id: "grind", lo: 14, hi: 16, label: "KEEP GOING" },
  { id: "still", lo: 16, hi: 18, label: "PATIENCE" },
  { id: "push", lo: 18, hi: 20, label: "THE WORK" },
  { id: "dusk", lo: 20, hi: 22, label: "WIND DOWN" },
];

const FLOW = { id: "flow", lo: 0, hi: 24, label: "PIP" };

const BEATS = {
  lunch: {
    inspire: ["Smell the roses.", "A good meal is already a win.", "Take care of the body first.", "Lunch is part of the work."],
    audit: ["Feed the body. Then the dream.", "Don't skip the simple things.", "You cannot pour from empty.", "Honest hunger first."],
    act: ["Eat like you matter.", "Sit down. Eat. Then return.", "Fuel first. Then Holowatts.", "One real meal. Then one real move."],
  },
  grind: {
    inspire: ["The days compound.", "Success is a few simple disciplines.", "Volume. Then skill. Then volume.", "Keep going.", "Take a leap of faith."],
    audit: ["Don't wish it easier. Wish you better.", "You don't need more information.", "Work a little on yourself too.", "Document the work. The rest is noise."],
    act: ["One more honest hour.", "Do what you can with this hour.", "Stay with the next inch.", "Put in the time.", "Send it. Apply. Ask."],
  },
  still: {
    inspire: ["Happy little progress.", "Patience is a skill.", "The garden doesn't shout. It grows.", "Macro patience. Micro care."],
    audit: ["Slow is how trees grow.", "There's no rush in the important stuff.", "Breathe before you add more.", "Stillness is a move."],
    act: ["Breathe. Then proceed.", "One careful stroke.", "Leave a little space.", "Go slow enough to stay kind."],
  },
  push: {
    inspire: ["Know your worth.", "The work is the love.", "Be so good they have to look.", "Make something they can walk into."],
    audit: ["Make it useful. Make it seen.", "Your taste is the strategy.", "What actually matters right now?", "Ship the honest version."],
    act: ["Stay with the thing in front of you.", "You don't need a speech. You need a step.", "Give more than you take today.", "Do the next small thing."],
  },
  dusk: {
    inspire: ["Shine on.", "You showed up. That's a life.", "Gratitude looks good on you.", "Let it be enough."],
    audit: ["You showed up. That's the whole day.", "Rest is part of the discipline.", "Tomorrow gets a well-fed you.", "Don't steal tonight from tomorrow."],
    act: ["Go smell the roses.", "Close the loop. Then rest.", "Leave the tools where you'll find them.", "Be done for today."],
  },
};

const HINTS = {
  wake: "TAP WHEN IT'S DONE",
  inspire: "TAP WHEN IT LANDS",
  audit: "TAP WHEN YOU'VE LOOKED",
  act: "TAP WHEN YOU'VE MOVED",
  pip: "PIP · STILL WITH YOU",
};

const POOL = {
  lunch: ["Eat. The work will wait.", "A good meal is part of the plan.", "Don't skip the simple things.", "Feed yourself like you matter.", "Fuel first. Then Holowatts.", "Hunger is a bad strategist.", "Sit. Eat. Then come back sharper."],
  grind: ["Success is a few simple disciplines.", "You don't need more information.", "Volume. Then skill. Then volume.", "Work a little on yourself too.", "Document the work. The rest is noise.", "Do what you can with this hour.", "Just put in the time."],
  still: ["Patience is a skill.", "Slow is how trees grow.", "Happy little accidents.", "There's no rush in the important stuff.", "Macro patience. Micro care.", "Leave room for the happy accident.", "Still water. Then the next stroke."],
  push: ["The work is the love.", "You don't need a speech. You need a step.", "Make it useful. Make it seen.", "Give more than you take today.", "Stay with the thing in front of you.", "Useful beats impressive.", "One honest piece, shipped."],
  dusk: ["You showed up. That's the whole day.", "Let it be enough.", "Rest is part of the discipline.", "Gratitude looks good on you.", "Tomorrow gets a well-fed you.", "Close it kindly.", "The night is allowed to be quiet."],
  flow: ["You can do this.", "I'm still here. No hurry.", "Keep your word to yourself.", "Plant something today.", "Be grateful you're in the room.", "The hour is still yours.", "Stay curious about the next inch."],
  any: [
    "You can do this.",
    "Don't wish it easier. Wish you better.",
    "Talent is a pursued interest.",
    "No mistakes. Just happy accidents.",
    "A little every day becomes a life.",
    "Simple. Not easy. Still simple.",
    "If it's useful, it's enough.",
    "You're allowed to enjoy this.",
    "The garden doesn't shout. It grows.",
    "Keep your word to yourself.",
    "The days compound. Be kind to them.",
    "Make something they can walk into.",
    "Your taste is the strategy.",
    "Ship the honest version.",
    "The live room is the point.",
    "Be so good they have to look.",
    "Work harder on yourself than the job.",
    "Do it for who you're becoming.",
    "Kindness is a strategy.",
    "Stay curious about the next inch.",
    "Take care of people, including you.",
    "Today's a good day to be decent.",
    "Make something you'd be proud to give.",
    "Plant. Water. Don't shout at the soil.",
    "One true sentence, then another.",
    "The work will wait for a glass of water.",
    "Drink water. Then the next move.",
    "Smell the roses.",
    "Go smell the roses.",
    "Take a leap of faith.",
    "Show up small. Stay anyway.",
    "Protect the hour you already opened.",
    "Done kindly beats perfect later.",
    "Leave it better than you found it.",
  ],
};

const KEY = "pip.phone.motiv.v1";
const HOT = /\b(unleash|harness|beast|devour|crush|dominate|savage|warrior|lock in|kill it|get after)\b/i;
let filling = false;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function hash(s) {
  let n = 2166136261;
  for (const ch of String(s)) n = Math.imul(n ^ ch.charCodeAt(0), 16777619);
  return n >>> 0;
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!raw || raw.date !== today()) return { date: today(), beats: {}, radio: {}, recent: [], queue: [], grown: [] };
    return {
      date: raw.date,
      beats: raw.beats || {},
      radio: raw.radio || {},
      recent: Array.isArray(raw.recent) ? raw.recent : [],
      queue: Array.isArray(raw.queue) ? raw.queue : [],
      grown: Array.isArray(raw.grown) ? raw.grown : [],
    };
  } catch {
    return { date: today(), beats: {}, radio: {}, recent: [], queue: [], grown: [] };
  }
}

function save(st) {
  localStorage.setItem(KEY, JSON.stringify(st));
}

function stance() {
  const h = new Date().getHours();
  return STANCES.find((s) => s.lo <= h && h < s.hi) || FLOW;
}

export function pickShader(text, kind = "", avoid = "") {
  const ordered = String(text || "").toLowerCase().match(/[a-z][a-z0-9_-]{1,24}/g) || [];
  const words = new Set(ordered);
  const bias = { inspire: ["sendoff"], audit: ["breath"], act: ["move", "water"], pip: ["sendoff", "move", "breath"] }[kind] || [];
  let best = SHADER_ORDER[0];
  let bestN = -1;
  const ranked = [];
  for (const stem of SHADER_ORDER) {
    const tags = new Set([stem, ...(STEM_TAGS[stem] || [])]);
    let score = 0;
    ordered.slice(0, 10).forEach((w, i) => {
      if (tags.has(w)) score += i < 2 ? 3.2 : 2;
    });
    if (words.has(stem)) score += 4;
    if (bias.includes(stem)) score += 0.8;
    ranked.push([score, stem]);
    if (score > bestN) {
      bestN = score;
      best = stem;
    }
  }
  ranked.sort((a, b) => b[0] - a[0]);
  if (avoid && SHADER_ORDER.length > 1) {
    const hits = ranked.filter(([sc, st]) => sc >= 2 && st !== avoid);
    if (hits.length) best = hits[0][1];
    else {
      const i = SHADER_ORDER.indexOf(avoid);
      best = SHADER_ORDER[(i + 1) % SHADER_ORDER.length];
    }
  }
  return { stem: best, source: SHADERS[best] };
}

function dailyBeats(st) {
  const pack = BEATS[st.id];
  if (!pack) return [];
  const seed = hash(today() + ":" + st.id);
  const pick = (arr, salt) => arr[(seed + salt) % arr.length];
  return [
    { shot: pick(pack.inspire, 3), kind: "inspire", vibe: "sendoff" },
    { shot: pick(pack.audit, 11), kind: "audit", vibe: "breath" },
    { shot: pick(pack.act, 19), kind: "act", vibe: "move" },
  ];
}

function cleanLine(text) {
  let line = String(text || "").split(/\n/)[0].trim().replace(/^["'`]+|["'`]+$/g, "");
  line = line.replace(/^pip\s*[:—-]\s*/i, "").replace(/\s+/g, " ").trim();
  const words = line.split(/\s+/).filter(Boolean);
  if (words.length > 14) line = words.slice(0, 14).join(" ");
  if (line.length > 72) line = line.slice(0, 69).trim() + "…";
  if (!line || HOT.test(line)) return "";
  return line;
}

function freshLine(id, recent, grown) {
  const seen = new Set((recent || []).map((x) => String(x).toLowerCase()));
  const pool = [...(grown || []), ...(POOL[id] || []), ...POOL.any];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.find((l) => l && !seen.has(l.toLowerCase())) || pool[0];
}

function kickFill(st) {
  const mem = load();
  if ((mem.queue || []).length >= 4 || filling) return;
  filling = true;
  import("./brain.js")
    .then((brain) => brain.sparkLine(mem.recent || [], st.label || st.id))
    .then((raw) => {
      const shot = cleanLine(raw);
      if (!shot) return;
      const now = load();
      const seen = new Set((now.recent || []).map((x) => String(x).toLowerCase()));
      if (seen.has(shot.toLowerCase())) return;
      if ((now.queue || []).some((q) => String(q.shot || "").toLowerCase() === shot.toLowerCase())) return;
      const last = (now.radio && now.radio.vibe) || "";
      now.queue = [...(now.queue || []), { shot, vibe: pickShader(shot, "pip", last).stem }].slice(-8);
      now.grown = [...(now.grown || []).filter((x) => x !== shot), shot].slice(-40);
      save(now);
    })
    .catch(() => {})
    .finally(() => {
      filling = false;
    });
}

export function snapshot() {
  const wake = wakeNext();
  if (wake) {
    return {
      phase: "wake",
      label: "WAKE",
      complete: false,
      next: wake,
      hint: HINTS.wake,
    };
  }
  const st = stance();
  const mem = load();
  const beats = dailyBeats(st);
  const idx = Number(mem.beats[st.id] || 0);
  kickFill(st);
  if (beats.length && idx < beats.length) {
    const beat = { ...beats[idx], stance: st.id };
    const hit = pickShader(beat.shot, beat.kind);
    if (hit.stem) beat.vibe = hit.stem;
    return { label: st.label, complete: false, next: beat, hint: HINTS[beat.kind] || "TAP" };
  }
  const radio = mem.radio && mem.radio.stance === st.id && mem.radio.shot
    ? mem.radio
    : advanceRadio(st, mem);
  return {
    label: st.label,
    complete: false,
    next: { shot: radio.shot, kind: "pip", vibe: radio.vibe, stance: st.id, radio: true },
    hint: HINTS.pip,
  };
}

function advanceRadio(st, mem) {
  const last = (mem.radio && mem.radio.vibe) || "";
  let shot = "";
  let vibe = "";
  const queue = [...(mem.queue || [])];
  if (queue.length) {
    const item = queue.shift();
    shot = cleanLine(item && item.shot);
    vibe = (item && item.vibe) || "";
  }
  if (!shot) shot = freshLine(st.id, mem.recent || [], mem.grown || []);
  if (HOT.test(shot)) return advanceRadio(st, { ...mem, recent: [...(mem.recent || []), shot], queue });
  if (!vibe || vibe === last) vibe = pickShader(shot, "pip", last).stem;
  mem.queue = queue;
  mem.radio = { stance: st.id, shot, vibe };
  mem.recent = [...(mem.recent || []), shot].slice(-40);
  mem.date = today();
  save(mem);
  kickFill(st);
  return mem.radio;
}

export function tap() {
  const wake = wakeNext();
  if (wake) {
    /* Wake checks go through checkWake in app.js — don't advance local beats. */
    return snapshot();
  }
  const st = stance();
  const mem = load();
  const beats = dailyBeats(st);
  const idx = Number(mem.beats[st.id] || 0);
  if (beats.length && idx < beats.length) {
    mem.beats[st.id] = idx + 1;
    mem.date = today();
    save(mem);
    return snapshot();
  }
  advanceRadio(st, mem);
  return snapshot();
}

/** Force next radio line + different shader — used if UI needs a hard nudge. */
export function bump() {
  const wake = wakeNext();
  if (wake) return snapshot();
  const st = stance();
  const mem = load();
  advanceRadio(st, mem);
  return snapshot();
}

export function shaderOf(stem) {
  return SHADERS[stem] || SHADERS.sendoff || SHADERS["bass-pulse"];
}
