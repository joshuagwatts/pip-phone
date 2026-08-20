/** Meal plan on phone — local store, syncs from paired desktop. */

import { httpLanGet } from "./net.js";
import { desktopConfigured } from "./desktop.js";
import { uid } from "./store.js";

const SLOTS = ["breakfast", "lunch", "dinner", "snack"];

const SLOT_HEAD = /^\s*(?:\*\*|__|#+\s*|\d+[.)]\s*|[-*•]\s*)*(breakfast|lunch|dinner|snack)\b\*?\*?\s*[:\-–—]?\s*(.*)$/im;
const SLOT_INLINE =
  /\b(breakfast|lunch|dinner|snack)\s*[:\-–—]\s*(.+?)(?=(?:\s*[;,]\s*)?\b(?:breakfast|lunch|dinner|snack)\s*[:\-–—]|$)/gi;

export function today() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function blankMeals() {
  return {
    targets: { kcal: 2200, protein_g: 150, carbs_g: 220, fat_g: 70, notes: "" },
    wanted: [],
    plan: [],
    shopping: [],
    plan_date: today(),
    remaining: { targets: {}, planned: {}, remaining: {} },
  };
}

function parseIngredients(text) {
  return String(text || "")
    .split(/[\n,;]+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function planTotals(rows) {
  return {
    kcal: (rows || []).reduce((n, r) => n + (Number(r.kcal) || 0), 0),
    protein_g: (rows || []).reduce((n, r) => n + (Number(r.protein_g) || 0), 0),
    carbs_g: (rows || []).reduce((n, r) => n + (Number(r.carbs_g) || 0), 0),
    fat_g: (rows || []).reduce((n, r) => n + (Number(r.fat_g) || 0), 0),
  };
}

function planRowsToday(state) {
  const day = today();
  const rows = state.plan || [];
  if ((state.plan_date || day) !== day) {
    return rows.filter((r) => (r.plan_date || r.date) === day);
  }
  return rows.filter((r) => {
    const pd = r.plan_date || r.date;
    return !pd || pd === day;
  });
}

function shoppingToday(state) {
  const day = today();
  return (state.shopping || []).filter((s) => !s.for_date || s.for_date === day);
}

function remainingMacros(state) {
  const targets = state.targets || blankMeals().targets;
  const planned = planTotals(planRowsToday(state));
  return {
    targets,
    planned,
    remaining: {
      kcal: targets.kcal - planned.kcal,
      protein_g: targets.protein_g - planned.protein_g,
      carbs_g: targets.carbs_g - planned.carbs_g,
      fat_g: targets.fat_g - planned.fat_g,
    },
  };
}

function splitDish(text) {
  let t = String(text || "").replace(/\s+/g, " ").trim().replace(/[.;]+$/, "");
  for (const sep of [" — ", " – ", " - ", ": ", " ("]) {
    const idx = t.indexOf(sep);
    if (idx >= 3) return [t.slice(0, idx).trim(), t.slice(idx + sep.length).trim()];
  }
  const low = t.toLowerCase();
  const wi = low.indexOf(" with ");
  if (wi >= 3) return [t.slice(0, wi).trim(), t.slice(wi + 6).trim()];
  return [t, ""];
}

export function parseMenu(text) {
  const slots = {};
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  let current = null;
  const extras = Object.fromEntries(SLOTS.map((s) => [s, []]));
  for (const line of lines) {
    const m = line.trim().match(SLOT_HEAD);
    if (m) {
      current = m[1].toLowerCase();
      const dish = (m[2] || "").trim().replace(/\*+/g, "");
      if (dish) {
        const [name, ing] = splitDish(dish);
        slots[current] = { name, ingredients: ing };
      }
      continue;
    }
    if (current && line.trim() && !line.trim().match(SLOT_HEAD)) {
      extras[current].push(line.trim().replace(/^[-* ]+/, ""));
    }
  }
  for (const slot of SLOTS) {
    const extra = extras[slot].join(", ");
    if (!extra) continue;
    if (slots[slot]) {
      slots[slot].ingredients = [slots[slot].ingredients, extra].filter(Boolean).join(", ");
    } else {
      const [name, ing] = splitDish(extra);
      slots[slot] = { name, ingredients: ing };
    }
  }
  if (Object.keys(slots).length < 2) {
    const blob = String(text || "").replace(/\s+/g, " ");
    let m;
    SLOT_INLINE.lastIndex = 0;
    while ((m = SLOT_INLINE.exec(blob))) {
      const [name, ing] = splitDish(m[2].trim().replace(/[.,;]+$/, ""));
      if (name) slots[m[1].toLowerCase()] = { name, ingredients: ing };
    }
  }
  return slots;
}

function ensureMeals(db) {
  if (!db.meals || typeof db.meals !== "object") db.meals = blankMeals();
  if (!Array.isArray(db.meals.wanted)) db.meals.wanted = [];
  if (!Array.isArray(db.meals.plan)) db.meals.plan = [];
  if (!Array.isArray(db.meals.shopping)) db.meals.shopping = [];
  if (!db.meals.targets) db.meals.targets = blankMeals().targets;
  db.meals.plan_date = db.meals.plan_date || today();
  db.meals.remaining = remainingMacros(db.meals);
  return db.meals;
}

export function mealSnapshot(db) {
  const m = ensureMeals(db);
  m.remaining = remainingMacros(m);
  return {
    plan_date: today(),
    targets: m.targets,
    wanted: m.wanted,
    plan: planRowsToday(m),
    shopping: shoppingToday(m),
    remaining: m.remaining,
    stored_plan_date: m.plan_date || today(),
  };
}

function addShopping(state, planDate, text) {
  for (const ing of parseIngredients(text)) {
    if (!state.shopping.some((s) => s.name.toLowerCase() === ing.toLowerCase() && s.for_date === planDate)) {
      state.shopping.push({
        id: uid(),
        name: ing,
        quantity: "",
        checked: false,
        source: "meals",
        for_date: planDate,
      });
    }
  }
}

export function addWantedMeal(db, name, ingredients = "", macros = {}) {
  const m = ensureMeals(db);
  const row = {
    id: uid(),
    name: String(name || "").trim(),
    ingredients: String(ingredients || "").trim(),
    kcal: Number(macros.kcal) || 0,
    protein_g: Number(macros.protein_g) || 0,
    carbs_g: Number(macros.carbs_g) || 0,
    fat_g: Number(macros.fat_g) || 0,
    notes: String(macros.notes || "").trim(),
  };
  m.wanted.unshift(row);
  return row;
}

export function deleteWantedMeal(db, mealId) {
  const m = ensureMeals(db);
  m.wanted = m.wanted.filter((w) => w.id !== mealId);
}

export function clearWantedMeals(db) {
  ensureMeals(db).wanted = [];
}

export function clearDayPlan(db, planDate = today()) {
  const m = ensureMeals(db);
  m.plan = m.plan.filter((p) => p.plan_date !== planDate);
  m.shopping = m.shopping.filter((s) => !(s.source === "meals" && s.for_date === planDate));
  m.plan_date = planDate;
}

export function planDay(db, planDate = today()) {
  const m = ensureMeals(db);
  if (!m.wanted.length) {
    return { ok: false, error: "No wanted meals yet. Tell Pip what you want to eat." };
  }
  clearDayPlan(db, planDate);
  const wanted = [...m.wanted].reverse();
  for (let i = 0; i < SLOTS.length && i < wanted.length; i++) {
    const meal = wanted[i];
    m.plan.push({
      id: uid(),
      plan_date: planDate,
      slot: SLOTS[i],
      meal_name: meal.name,
      wanted_meal_id: meal.id,
      ingredients: meal.ingredients,
      kcal: meal.kcal,
      protein_g: meal.protein_g,
      carbs_g: meal.carbs_g,
      fat_g: meal.fat_g,
    });
    addShopping(m, planDate, meal.ingredients);
  }
  m.plan_date = planDate;
  m.remaining = remainingMacros(m);
  return { ok: true, plan: m.plan, note: "Planned from meals you want." };
}

export function setDayPlan(db, slots, { planDate = today(), diet = "" } = {}) {
  const m = ensureMeals(db);
  const specs = {};
  for (const slot of SLOTS) {
    if (slots[slot]?.name) specs[slot] = slots[slot];
  }
  if (!Object.keys(specs).length) {
    return { ok: false, error: "No meals given." };
  }
  if (Object.keys(specs).length >= 2) {
    clearDayPlan(db, planDate);
    m.wanted = [];
  }
  if (diet) m.targets.notes = diet;
  for (const slot of SLOTS) {
    const spec = specs[slot];
    if (!spec) continue;
    const meal = addWantedMeal(db, spec.name, spec.ingredients || "", spec);
    m.plan = m.plan.filter((p) => !(p.plan_date === planDate && p.slot === slot));
    m.plan.push({
      id: uid(),
      plan_date: planDate,
      slot,
      meal_name: meal.name,
      wanted_meal_id: meal.id,
      ingredients: meal.ingredients,
      kcal: meal.kcal,
      protein_g: meal.protein_g,
      carbs_g: meal.carbs_g,
      fat_g: meal.fat_g,
    });
    addShopping(m, planDate, meal.ingredients);
  }
  m.plan_date = planDate;
  m.remaining = remainingMacros(m);
  return { ok: true, plan: m.plan.filter((p) => p.plan_date === planDate) };
}

export function setShoppingChecked(db, itemId, checked) {
  const m = ensureMeals(db);
  const row = m.shopping.find((s) => s.id === itemId);
  if (row) row.checked = Boolean(checked);
}

export function mealBrief(db) {
  const snap = mealSnapshot(db);
  const lines = [];
  if (snap.targets?.notes) lines.push(`Diet: ${snap.targets.notes}`);
  lines.push(`Targets: ${snap.targets.kcal} kcal / P${snap.targets.protein_g}g`);
  for (const p of snap.plan || []) {
    lines.push(`${p.slot}: ${p.meal_name}${p.ingredients ? ` (${p.ingredients})` : ""}`);
  }
  if (!(snap.plan || []).length) lines.push("No plan today yet.");
  return lines.join("\n");
}

const MEAL_HINT =
  /\b(meals?|breakfast|lunch|dinner|snack|grocery|groceries|macros?|kcal|vegan|vegetarian|what to eat|meal plan|menu for today|eat today)\b/i;
const PLAN_CMD = /\b(plan|replan|build|make)\b.{0,20}\b(meals?|menu|today)\b/i;
const CLEAR_CMD = /\bclear\b.{0,16}\b(wanted|meals?|plan|today)\b/i;
const DIET_CMD = /\b(vegan|vegetarian|keto|paleo)\b/i;

export function looksLikeMealRequest(text) {
  return MEAL_HINT.test(String(text || ""));
}

export function tryMealCommand(text, db) {
  const t = String(text || "").trim();
  if (!t || !looksLikeMealRequest(t)) return null;

  if (CLEAR_CMD.test(t)) {
    if (/wanted/.test(t)) {
      clearWantedMeals(db);
      return { ok: true, reply: "Cleared wanted meals. Name what you want next.", switchTab: "meals" };
    }
    clearDayPlan(db);
    return { ok: true, reply: "Cleared today's plan. Replan when ready.", switchTab: "meals" };
  }

  if (PLAN_CMD.test(t)) {
    const out = planDay(db);
    if (!out.ok) return { ok: false, reply: out.error, switchTab: "meals" };
    return { ok: true, reply: "Replanned today from your wanted list. Check MEALS.", switchTab: "meals" };
  }

  const menu = parseMenu(t);
  if (Object.keys(menu).length) {
    const diet = DIET_CMD.exec(t)?.[1] || "";
    const out = setDayPlan(db, menu, { diet });
    if (!out.ok) return { ok: false, reply: out.error };
    const names = Object.entries(menu)
      .map(([slot, spec]) => `${slot}: ${spec.name}`)
      .join(" · ");
    return {
      ok: true,
      reply: `Wrote the MEALS tab — ${names}. Shopping list updated.`,
      switchTab: "meals",
    };
  }

  const wantMatch = t.match(/\b(?:want|craving|add)\s+(?:to eat\s+)?(.+?)(?:\s+for\s+(breakfast|lunch|dinner|snack))?[.!?]*$/i);
  if (wantMatch) {
    const name = wantMatch[1].trim();
    const slot = wantMatch[2]?.toLowerCase();
    addWantedMeal(db, name);
    if (slot) {
      setDayPlan(db, { [slot]: { name } });
      return { ok: true, reply: `${slot}: ${name} is on the plan.`, switchTab: "meals" };
    }
    return { ok: true, reply: `Saved ${name} to wanted meals. Say replan today or name all four slots.`, switchTab: "meals" };
  }

  // Open-ended meal talk → brain chat (with mealBrief context).
  return null;
}

export async function syncMealsFromDesktop(settings, db) {
  if (!desktopConfigured(settings)) return mealSnapshot(db);
  try {
    const tok = String(settings.desktop_token || "").trim();
    const base = String(settings.desktop_url || "").replace(/\/+$/, "");
    const headers =
      tok && tok !== "loopback"
        ? {
            Cookie: `pip_gate=${tok}`,
            "X-Pip-Token": tok,
            Authorization: `Bearer ${tok}`,
          }
        : {};
    const remote = await httpLanGet(`${base}/api/meals`, 8000, headers);
    if (!remote || !remote.targets) return mealSnapshot(db);

    const local = ensureMeals(db);
    const remotePlan = remote.plan || [];
    const remoteWanted = remote.wanted || [];
    const remoteHasPlan = remotePlan.length > 0;
    const localHasPlan = planRowsToday(local).length > 0;

    // Never wipe a good local plan with an empty desktop day.
    if (remoteHasPlan || !localHasPlan) {
      db.meals = {
        targets: remote.targets,
        wanted: remoteWanted.length ? remoteWanted : local.wanted,
        plan: remotePlan,
        shopping: remote.shopping || [],
        plan_date: remote.plan_date || today(),
        remaining: remote.remaining || remainingMacros({ targets: remote.targets, plan: remotePlan }),
      };
    } else {
      local.targets = remote.targets || local.targets;
      if (remoteWanted.length > (local.wanted || []).length) local.wanted = remoteWanted;
      local.remaining = remainingMacros(local);
      db.meals = local;
    }
  } catch {
    /* local meals stay */
  }
  return mealSnapshot(db);
}
