/** Calendar month grid + events (localStorage; syncs from desktop when paired). */

const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export function ym(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function ymd(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function eventsForDay(db, day) {
  return (db.events || []).filter((e) => e.event_date === day).sort((a, b) => (a.event_time || "").localeCompare(b.event_time || ""));
}

export function eventsInMonth(db, month) {
  const prefix = month || ym();
  return (db.events || []).filter((e) => String(e.event_date || "").startsWith(prefix));
}

export function addEvent(db, { title, event_date, event_time = "", note = "", color = "" }) {
  if (!title?.trim() || !event_date) return null;
  const row = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    title: title.trim(),
    event_date,
    event_time: (event_time || "").trim(),
    note: (note || "").trim(),
    color: color || "",
    created_at: new Date().toISOString(),
  };
  if (!Array.isArray(db.events)) db.events = [];
  db.events.push(row);
  db.events.sort((a, b) => `${a.event_date}${a.event_time}`.localeCompare(`${b.event_date}${b.event_time}`));
  return row;
}

export function deleteEvent(db, id) {
  db.events = (db.events || []).filter((e) => e.id !== id);
}

function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push(d);
  }
  return cells;
}

export function renderCalendar(root, db, state, { esc, onChange, persist }) {
  const view = state.calMonth || ym();
  const [y, m] = view.split("-").map(Number);
  const monthIdx = m - 1;
  const today = ymd();
  const sel = state.calDay || today;
  const monthEvents = eventsInMonth(db, view);
  const byDay = {};
  monthEvents.forEach((e) => {
    byDay[e.event_date] = (byDay[e.event_date] || 0) + 1;
  });
  const cells = monthGrid(y, monthIdx);
  const label = new Date(y, monthIdx, 1).toLocaleString(undefined, { month: "long", year: "numeric" }).toUpperCase();
  const dayEvents = eventsForDay(db, sel);

  root.innerHTML = `
    <div class="cal-wrap">
      <div class="cal-head">
        <button type="button" class="cal-nav" data-cal="prev">◀</button>
        <span class="cal-title">${esc(label)}</span>
        <button type="button" class="cal-nav" data-cal="next">▶</button>
      </div>
      <div class="cal-dow">${DOW.map((d) => `<span>${d}</span>`).join("")}</div>
      <div class="cal-grid">
        ${cells.map((d) => {
          const day = ymd(d);
          const off = d.getMonth() !== monthIdx;
          const dots = byDay[day] || 0;
          const cls = ["cal-cell", off && "off", day === today && "today", day === sel && "sel"].filter(Boolean).join(" ");
          return `<button type="button" class="${cls}" data-day="${day}"><span class="cal-num">${d.getDate()}</span>${dots ? `<span class="cal-dot">${dots > 3 ? "•••" : "•".repeat(dots)}</span>` : ""}</button>`;
        }).join("")}
      </div>
      <div class="cal-day-head">${esc(sel)}</div>
      <div class="cal-events">
        ${dayEvents.length ? dayEvents.map((e) => `
          <div class="cal-event" data-eid="${esc(e.id)}">
            <span class="cal-time">${esc(e.event_time || "ALL DAY")}</span>
            <span class="cal-ev-title">${esc(e.title)}</span>
            ${e.note ? `<p class="muted cal-note">${esc(e.note)}</p>` : ""}
            <button type="button" class="cal-del" data-del="${esc(e.id)}">×</button>
          </div>`).join("") : `<p class="muted">Nothing on the books. Add one below or tell Pip in CHAT.</p>`}
      </div>
      <form class="cal-add" id="cal-add">
        <input name="title" placeholder="Event title" required />
        <input name="time" placeholder="Time (optional) 14:30" />
        <input name="note" placeholder="Note" />
        <button type="submit" class="primary">ADD</button>
      </form>
    </div>
  `;

  root.querySelector('[data-cal="prev"]').onclick = () => {
    const d = new Date(y, monthIdx - 1, 1);
    state.calMonth = ym(d);
    onChange();
  };
  root.querySelector('[data-cal="next"]').onclick = () => {
    const d = new Date(y, monthIdx + 1, 1);
    state.calMonth = ym(d);
    onChange();
  };
  root.querySelectorAll("[data-day]").forEach((btn) => {
    btn.onclick = () => {
      state.calDay = btn.dataset.day;
      onChange();
    };
  });
  root.querySelectorAll("[data-del]").forEach((btn) => {
    btn.onclick = () => {
      deleteEvent(db, btn.dataset.del);
      persist();
      onChange();
    };
  });
  root.querySelector("#cal-add").onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    addEvent(db, {
      title: fd.get("title"),
      event_date: sel,
      event_time: fd.get("time"),
      note: fd.get("note"),
    });
    e.target.reset();
    persist();
    onChange();
  };
}

export async function syncEventsFromDesktop(settings, db) {
  if (!settings.desktop_paired || !settings.desktop_url) return false;
  try {
    const { httpLanGet } = await import("./net.js");
    const tok = String(settings.desktop_token || "").trim();
    const base = settings.desktop_url.replace(/\/+$/, "");
    const rows = await httpLanGet(`${base}/api/events`, 12000, tok ? { Cookie: `pip_gate=${tok}` } : {});
    if (Array.isArray(rows)) {
      db.events = rows.map((r) => ({
        id: String(r.id),
        title: r.title,
        event_date: r.event_date,
        event_time: r.event_time || "",
        note: r.note || "",
        color: r.color || "",
        created_at: r.created_at,
      }));
      return true;
    }
  } catch {
    /* local only */
  }
  return false;
}

export async function pushEventToDesktop(settings, event) {
  if (!settings.desktop_paired || !settings.desktop_url) return;
  try {
    const { httpLanPostJson } = await import("./net.js");
    const tok = String(settings.desktop_token || "").trim();
    const base = settings.desktop_url.replace(/\/+$/, "");
    await httpLanPostJson(
      `${base}/api/events`,
      tok ? { Cookie: `pip_gate=${tok}` } : {},
      {
        title: event.title,
        event_date: event.event_date,
        event_time: event.event_time,
        note: event.note,
      },
    );
  } catch {
    /* keep local */
  }
}
