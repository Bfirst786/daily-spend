import {
  CATS, keyOf, parseKey, addDays, mondayOf, textToCents, pressKey, centsToText, MAX_CENTS,
  live, sum, budgetLevel, visibleDays, niceCeil, parsePhrase, makeBackup, readBackup, mergeDays,
  activeProjects, findProjectByName, projectTotals, untagProject, mergeProjects,
} from "./core.js";

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");
const todayKey = () => keyOf(new Date());
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const icon = (name, cls = "i") => `<svg class="${cls}"><use href="#i-${name}"/></svg>`;

// ---------- state + storage (this device only) ----------
const STORE_KEY = "daily-spend:v1";
const INSTALL_KEY = "daily-spend:install-dismissed";

const state = {
  days: {},                         // "YYYY-MM-DD" -> [{id, amt, cat, note, t, archived?}]
  settings: { budget: 50, currency: "USD", projects: [] },
  selected: todayKey(),
  cat: "Food",
  proj: "",                         // project picked in the add form (sticky between adds)
  showArchivedProjects: false,
  open: new Set([todayKey()]),      // expanded day cards
  showArchived: new Set(),
  editing: null,
  olderOpen: false,
};

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) { const o = JSON.parse(raw); state.days = o.days || {}; Object.assign(state.settings, o.settings || {}); }
  } catch (e) { /* start empty */ }
}
let askedPersist = false;
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ days: state.days, settings: state.settings }));
  } catch (e) {
    $("mode").textContent = "Couldn't save. Your phone may be out of storage.";
    return;
  }
  // Ask the browser not to clear this app's data when space runs low.
  if (!askedPersist && navigator.storage && navigator.storage.persist) { askedPersist = true; navigator.storage.persist().catch(() => {}); }
}

// ---------- formatting ----------
function fmt(n, compact) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: state.settings.currency, maximumFractionDigits: compact ? 0 : 2, minimumFractionDigits: compact ? 0 : undefined }).format(n);
  } catch (e) { return n.toFixed(compact ? 0 : 2); }
}
const dayTotal = (k) => sum(state.days[k]);
function dayLabel(k, long) {
  const t = todayKey();
  if (k === t) return "Today";
  if (k === addDays(t, -1)) return "Yesterday";
  return parseKey(k).toLocaleDateString(undefined, long ? { weekday: "long", month: "short", day: "numeric" } : { weekday: "short", month: "short", day: "numeric" });
}

// ---------- cash-register amount box ----------
function cashInput(el) {
  el.cents = 0;
  const toEnd = () => setTimeout(() => { const n = el.value.length; try { el.setSelectionRange(n, n); } catch (e) {} }, 0);
  el.setCents = (c) => { el.cents = Math.max(0, Math.min(MAX_CENTS, Math.round(c))); el.value = centsToText(el.cents); };
  el.addEventListener("input", () => { el.cents = textToCents(el.value); el.value = centsToText(el.cents); toEnd(); });
  el.addEventListener("focus", toEnd);
  el.addEventListener("click", toEnd);
  el.addEventListener("paste", (e) => {
    const txt = (e.clipboardData && e.clipboardData.getData("text")) || "";
    const m = txt.replace(/,/g, "").match(/\d+(\.\d+)?/);
    if (m) { e.preventDefault(); el.setCents(parseFloat(m[0]) * 100); }
  });
  return el;
}

// ---------- changes ----------
function addItem({ cents, cat, note, day, proj }) {
  const k = day || state.selected;
  const at = k === todayKey() ? new Date() : new Date(parseKey(k).setHours(12, 0, 0, 0));
  const item = { id: newId(), amt: cents / 100, cat, note: (note || "").trim(), t: at.getTime() };
  if (proj && projectById(proj)) item.proj = proj;
  state.days[k] = [...(state.days[k] || []), item];
  state.open.add(k);
  save(); render();
  return item;
}
function replaceItem(oldDay, id, patch, newDay) {
  const items = state.days[oldDay] || [];
  const it = items.find((i) => i.id === id);
  if (!it) return;
  const updated = { ...it, ...patch };
  if (!updated.archived) delete updated.archived;
  if (!updated.proj) delete updated.proj;
  if (newDay && newDay !== oldDay) {
    state.days[oldDay] = items.filter((i) => i.id !== id);
    if (!state.days[oldDay].length) delete state.days[oldDay];
    state.days[newDay] = [...(state.days[newDay] || []), updated];
    state.open.add(newDay);
  } else {
    state.days[oldDay] = items.map((i) => (i.id === id ? updated : i));
  }
  save(); render();
}
function removeItem(day, id) {
  state.days[day] = (state.days[day] || []).filter((i) => i.id !== id);
  if (!state.days[day].length) delete state.days[day];
  save(); render();
}
function selectDay(d) { state.selected = d; state.open.add(d); }

// ---------- dialog + toast ----------
let modalResolve = null;
function ask({ title, text, ok, danger }) {
  $("modalTitle").textContent = title;
  $("modalText").textContent = text;
  $("modalOk").textContent = ok;
  $("modalOk").className = "btn" + (danger ? " danger" : "");
  $("modal").hidden = false;
  $("modalCancel").focus();
  return new Promise((res) => { modalResolve = res; });
}
function closeModal(ok) { $("modal").hidden = true; if (modalResolve) { modalResolve(ok); modalResolve = null; } }
$("modalCancel").onclick = () => closeModal(false);
$("modalOk").onclick = () => closeModal(true);
$("modal").addEventListener("click", (e) => { if (e.target === $("modal")) closeModal(false); });

let toastTimer, toastUndo = null;
function toast(text, undo) {
  $("toastText").textContent = text;
  $("toastUndo").hidden = !undo;
  toastUndo = undo || null;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $("toast").hidden = true; toastUndo = null; }, 5000);
}
$("toastUndo").onclick = () => { if (toastUndo) toastUndo(); $("toast").hidden = true; toastUndo = null; };

// ---------- render ----------
function render() {
  const k = state.selected, t = todayKey();
  const isToday = k === t;
  $("dayLabel").textContent = dayLabel(k);
  $("next").disabled = k >= t;
  $("spentLabel").textContent = isToday ? "Spent today" : "Spent " + dayLabel(k);
  $("addTitle").textContent = isToday ? "Add a purchase" : "Add a purchase to " + dayLabel(k);

  const items = live(state.days[k]);
  const total = sum(items), budget = Number(state.settings.budget) || 0;
  const level = budgetLevel(total, budget);
  const cls = level === "over" ? " over" : level === "warn" ? " warn" : "";
  $("spent").textContent = fmt(total);
  for (const m of [$("meter"), $("qMeter")]) {
    m.className = "meter" + cls;
    m.firstElementChild.style.width = (budget > 0 ? Math.min(100, (total / budget) * 100) : 0) + "%";
  }
  $("statusPill").className = "pill" + cls;
  $("statusPill").textContent = { none: "No budget set", over: "Over budget", warn: "Close to limit", ok: "On track" }[level];
  $("leftText").textContent = budget <= 0 ? "Set a daily budget below"
    : total > budget ? `${fmt(total - budget)} over ${fmt(budget)}` : `${fmt(budget - total)} left of ${fmt(budget)}`;
  $("countText").textContent = items.length + (items.length === 1 ? " purchase" : " purchases");

  const sel = parseKey(k);
  const monday = mondayOf(k);
  let wk = 0; for (let i = 0; i < 7; i++) wk += dayTotal(addDays(monday, i));
  const mPrefix = k.slice(0, 7);
  let mo = 0; const catTotals = {};
  Object.entries(state.days).forEach(([dk, its]) => {
    if (!dk.startsWith(mPrefix)) return;
    live(its).forEach((i) => { mo += Number(i.amt) || 0; catTotals[i.cat] = (catTotals[i.cat] || 0) + (Number(i.amt) || 0); });
  });
  const daysElapsed = mPrefix === t.slice(0, 7) ? new Date().getDate() : new Date(sel.getFullYear(), sel.getMonth() + 1, 0).getDate();
  $("wk").textContent = fmt(wk, true);
  $("mo").textContent = fmt(mo, true);
  $("avg").textContent = fmt(mo / Math.max(1, daysElapsed), true);

  renderDays();
  renderChart(t);
  renderCats(catTotals, mo, sel);
  renderProjects();
  fillProjectSelect($("proj"), state.proj, true);
  fillProjectSelect($("qProj"), state.proj, false);
  renderQuick();
}

function renderDays() {
  const box = $("days");
  box.replaceChildren();
  const shown = visibleDays(state.days, state.selected, todayKey());
  shown.forEach((d) => box.append(dayCard(d)));

  const others = Object.keys(state.days).filter((d) => (state.days[d] || []).length && !shown.includes(d)).sort().reverse();
  $("olderWrap").hidden = others.length === 0;
  $("olderBtn").textContent = (state.olderOpen ? "Hide" : "Show") + ` ${others.length} earlier ${others.length === 1 ? "day" : "days"}`;
  $("olderBtn").setAttribute("aria-expanded", String(state.olderOpen));
  const older = $("older");
  older.hidden = !state.olderOpen;
  older.replaceChildren();
  if (!state.olderOpen) return;
  const byMonth = {};
  others.forEach((d) => (byMonth[d.slice(0, 7)] ||= []).push(d));
  Object.entries(byMonth).forEach(([m, ds]) => {
    const wrap = document.createElement("div"); wrap.className = "month";
    const lab = document.createElement("div"); lab.className = "label";
    lab.textContent = `${parseKey(m + "-01").toLocaleDateString(undefined, { month: "long", year: "numeric" })} · ${fmt(ds.reduce((s, d) => s + dayTotal(d), 0), true)}`;
    wrap.append(lab);
    ds.forEach((d) => {
      const b = document.createElement("button"); b.className = "orow"; b.type = "button";
      const a = document.createElement("span"); a.textContent = dayLabel(d);
      const c = document.createElement("span"); c.textContent = `${live(state.days[d]).length} · ${fmt(dayTotal(d))}`;
      b.append(a, c);
      b.onclick = () => { selectDay(d); state.olderOpen = false; render(); scrollToDay(d); };
      wrap.append(b);
    });
    older.append(wrap);
  });
}
function scrollToDay(d) {
  const el = document.querySelector(`[data-day="${d}"]`);
  if (el) el.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

function dayCard(d) {
  const all = (state.days[d] || []).slice().sort((a, b) => a.t - b.t);
  const act = all.filter((i) => !i.archived), arch = all.filter((i) => i.archived);
  const open = state.open.has(d);
  const g = document.createElement("div");
  g.className = "dgroup" + (open ? " open" : "");
  g.dataset.day = d;
  const head = document.createElement("button");
  head.type = "button"; head.className = "dhead"; head.setAttribute("aria-expanded", String(open));
  head.innerHTML = `<span class="dname"></span><span class="dmeta"><span></span>${icon("chev", "i chev")}</span>`;
  head.querySelector(".dname").textContent = dayLabel(d, true);
  head.querySelector(".dmeta span").textContent = `${act.length} · ${fmt(sum(act))}`;
  head.onclick = () => { if (open) state.open.delete(d); else { state.open.add(d); state.selected = d; } render(); };
  g.append(head);
  if (!open) return g;

  const body = document.createElement("div"); body.className = "dbody";
  const ul = document.createElement("ul"); ul.className = "receipt";
  act.forEach((it) => ul.append(itemRow(d, it)));
  if (state.showArchived.has(d)) arch.forEach((it) => ul.append(itemRow(d, it)));
  body.append(ul);
  if (!act.length) {
    const e = document.createElement("div"); e.className = "empty";
    e.textContent = d === todayKey() ? "Nothing logged today. Enter an amount above, or open Quick log." : "Nothing logged for this day.";
    body.append(e);
  } else {
    const tot = document.createElement("div"); tot.className = "total";
    const a = document.createElement("span"); a.textContent = "TOTAL";
    const b = document.createElement("span"); b.textContent = fmt(sum(act));
    tot.append(a, b); body.append(tot);
  }
  if (arch.length) {
    const bar = document.createElement("div"); bar.className = "archbar";
    const s = document.createElement("span");
    s.textContent = `${arch.length} archived · ${fmt(arch.reduce((x, i) => x + Number(i.amt), 0))} not counted`;
    const showing = state.showArchived.has(d);
    const b = document.createElement("button"); b.type = "button"; b.className = "linkbtn"; b.textContent = showing ? "Hide" : "Show";
    b.onclick = () => { showing ? state.showArchived.delete(d) : state.showArchived.add(d); render(); };
    bar.append(s, b); body.append(bar);
  }
  g.append(body);
  return g;
}

function itemRow(d, it) {
  const li = document.createElement("li");
  if (state.editing === it.id) { li.append(editor(d, it)); return li; }
  const row = document.createElement("div");
  row.className = "item" + (it.archived ? " archived" : "");
  const time = document.createElement("span"); time.className = "time edit-target";
  time.textContent = new Date(it.t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const what = document.createElement("span"); what.className = "what edit-target";
  what.textContent = it.note || it.cat;
  if (it.note) { const s = document.createElement("small"); s.textContent = it.cat; what.append(s); }
  const p = it.proj && projectById(it.proj);
  if (p) { const tag = document.createElement("span"); tag.className = "ptag"; tag.textContent = p.name; what.append(tag); }
  const amt = document.createElement("span"); amt.className = "amt edit-target"; amt.textContent = fmt(Number(it.amt));
  const startEdit = () => { state.editing = it.id; render(); };
  [time, what, amt].forEach((el) => { el.onclick = startEdit; });
  what.tabIndex = 0;
  what.setAttribute("role", "button");
  what.setAttribute("aria-label", `Edit ${it.note || it.cat}, ${fmt(Number(it.amt))}`);
  what.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); startEdit(); } };

  const acts = document.createElement("span"); acts.className = "acts";
  const arc = document.createElement("button"); arc.type = "button";
  arc.innerHTML = icon(it.archived ? "restore" : "archive");
  arc.title = it.archived ? "Restore" : "Archive";
  arc.setAttribute("aria-label", arc.title);
  arc.onclick = () => {
    const was = !!it.archived;
    replaceItem(d, it.id, { archived: !was });
    toast(was ? "Restored to totals" : "Archived · not counted in totals", () => replaceItem(d, it.id, { archived: was }));
  };
  const del = document.createElement("button"); del.type = "button"; del.className = "del";
  del.innerHTML = icon("trash"); del.title = "Delete"; del.setAttribute("aria-label", "Delete");
  del.onclick = async () => {
    const ok = await ask({
      title: "Delete purchase?",
      text: `${fmt(Number(it.amt))} · ${it.note || it.cat}. This can't be undone. To keep it but leave it out of your totals, archive it instead.`,
      ok: "Delete", danger: true,
    });
    if (ok) { removeItem(d, it.id); toast("Deleted"); }
  };
  acts.append(arc, del);
  row.append(time, what, amt, acts);
  li.append(row);
  return li;
}

function editor(d, it) {
  const f = document.createElement("form"); f.className = "editor";
  f.innerHTML = `
    <div class="grid2">
      <label><span class="label">Amount</span><input class="cash" type="text" inputmode="numeric" name="amt"></label>
      <label><span class="label">Category</span><select name="cat"></select></label>
    </div>
    <div class="grid2">
      <label><span class="label">Note</span><input type="text" name="note" maxlength="80"></label>
      <label><span class="label">Project</span><select name="proj"></select></label>
    </div>
    <div class="grid2">
      <label><span class="label">Date</span><input type="date" name="day"></label>
      <label><span class="label">Time</span><input type="time" name="time"></label>
    </div>
    <div class="btns"><button type="button" class="btn ghost" data-a="cancel">Cancel</button><button type="submit" class="btn">Save</button></div>`;
  const amt = cashInput(f.querySelector('[name="amt"]'));
  amt.setCents(Number(it.amt) * 100);
  const sel = f.querySelector('[name="cat"]');
  CATS.forEach((c) => { const o = document.createElement("option"); o.textContent = c; sel.append(o); });
  sel.value = it.cat;
  f.querySelector('[name="note"]').value = it.note || "";
  const projSel = f.querySelector('[name="proj"]');
  fillProjectSelect(projSel, it.proj || "", false);
  const dayIn = f.querySelector('[name="day"]'); dayIn.value = d; dayIn.max = todayKey();
  const tm = new Date(it.t); f.querySelector('[name="time"]').value = `${pad(tm.getHours())}:${pad(tm.getMinutes())}`;
  const cancel = () => { state.editing = null; render(); };
  f.querySelector('[data-a="cancel"]').onclick = cancel;
  f.onkeydown = (e) => { if (e.key === "Escape") cancel(); };
  f.onsubmit = (e) => {
    e.preventDefault();
    if (!amt.cents) { amt.focus(); return; }
    const newDay = dayIn.value && dayIn.value <= todayKey() ? dayIn.value : d;
    const [hh, mm] = (f.querySelector('[name="time"]').value || "12:00").split(":").map(Number);
    const t = parseKey(newDay); t.setHours(hh || 0, mm || 0, 0, 0);
    state.editing = null;
    replaceItem(d, it.id, { amt: amt.cents / 100, cat: sel.value, note: f.querySelector('[name="note"]').value.trim(), t: t.getTime(), proj: projSel.value }, newDay);
    toast("Saved");
  };
  setTimeout(() => amt.focus(), 0);
  return f;
}

function renderChart(t) {
  const keys = []; for (let i = 13; i >= 0; i--) keys.push(addDays(t, -i));
  const vals = keys.map(dayTotal);
  const budget = Number(state.settings.budget) || 0;
  const top = niceCeil(Math.max(budget, ...vals, 1));
  const W = 520, H = 190, L = 44, R = 8, T = 10, B = 26;
  const cw = (W - L - R) / keys.length, y = (v) => T + (H - T - B) * (1 - v / top);
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Spending per day for the last 14 days");
  const el = (tag, attrs, text) => { const e = document.createElementNS(ns, tag); for (const a in attrs) e.setAttribute(a, attrs[a]); if (text != null) e.textContent = text; svg.append(e); return e; };
  [0, top / 2, top].forEach((v) => {
    el("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: "var(--line)", "stroke-width": 1 });
    el("text", { x: L - 6, y: y(v) + 3, "text-anchor": "end" }, fmt(v, true));
  });
  keys.forEach((k, i) => {
    const v = vals[i], x = L + i * cw + cw * 0.18, w = cw * 0.64;
    const over = budget > 0 && v > budget;
    const bar = el("rect", {
      x, y: y(v), width: w, height: Math.max(0, y(0) - y(v)), rx: 3,
      fill: over ? "var(--over)" : k === state.selected ? "var(--accent)" : "var(--accent-soft)",
      stroke: k === state.selected ? "var(--accent)" : "none", style: "cursor:pointer",
    });
    const tt = document.createElementNS(ns, "title"); tt.textContent = `${dayLabel(k)}: ${fmt(v)}`; bar.append(tt);
    bar.addEventListener("click", () => { selectDay(k); render(); scrollToDay(k); });
    if (i % 2 === 1 || i === 13) el("text", { x: L + i * cw + cw / 2, y: H - 8, "text-anchor": "middle" }, String(parseKey(k).getDate()));
  });
  if (budget > 0) {
    el("line", { x1: L, x2: W - R, y1: y(budget), y2: y(budget), stroke: "var(--warn)", "stroke-width": 1.5, "stroke-dasharray": "4 4" });
    el("text", { x: W - R, y: y(budget) - 4, "text-anchor": "end" }, "budget");
  }
  $("chart").replaceChildren(svg);
}

function renderCats(totals, mo, sel) {
  $("monthTitle").textContent = sel.toLocaleDateString(undefined, { month: "long" }) + " by category";
  const box = $("cats"); box.replaceChildren();
  const rows = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  if (!rows.length) {
    const p = document.createElement("div"); p.className = "empty";
    p.textContent = "Categories show up here once you log purchases this month.";
    box.append(p); return;
  }
  const max = rows[0][1];
  rows.forEach(([c, v]) => {
    const r = document.createElement("div"); r.className = "cat";
    const n = document.createElement("span"); n.textContent = c;
    const b = document.createElement("div"); b.className = "bar";
    const i = document.createElement("i"); i.style.width = (v / max) * 100 + "%"; b.append(i);
    const a = document.createElement("span"); a.className = "num"; a.textContent = `${fmt(v, true)} · ${Math.round((v / mo) * 100)}%`;
    r.append(n, b, a); box.append(r);
  });
}

function renderChips(boxId) {
  const box = $(boxId); box.replaceChildren();
  CATS.forEach((c) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "chip"; b.textContent = c;
    b.setAttribute("aria-pressed", String(c === state.cat));
    b.addEventListener("click", () => { state.cat = c; renderChips("chips"); renderChips("qChips"); renderQuick(); });
    box.append(b);
  });
}
function syncSettingsInputs() {
  if (document.activeElement !== $("budget")) $("budget").value = state.settings.budget;
  $("currency").value = state.settings.currency;
}

// ---------- add form ----------
const amtEl = cashInput($("amt"));
$("addForm").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!amtEl.cents) { amtEl.focus(); return; }
  addItem({ cents: amtEl.cents, cat: state.cat, note: $("note").value, proj: state.proj });
  amtEl.setCents(0); $("note").value = "";
  setStatus($("capStatus"), "");
  amtEl.focus();
});

function setStatus(el, text, err) {
  el.hidden = !text;
  el.className = "status" + (err ? " err" : "");
  el.textContent = text || "";
}

// Say it: speech (where the browser allows it) or the keyboard's dictation mic -> amount, category, note.
function fillFromPhrase(text) {
  if (!text.trim()) return;
  const p = parsePhrase(text);
  if (!(p.amount > 0)) {
    $("phrase").value = text;
    setStatus($("capStatus"), `Heard "${text.trim().slice(0, 80)}" but couldn't find an amount. Fix the text below and tap Fill in, or try "5 dollars for lunch".`, true);
    return;
  }
  amtEl.setCents(p.amount * 100);
  if (p.category) { state.cat = p.category; renderChips("chips"); renderChips("qChips"); }
  if (p.note) $("note").value = p.note.slice(0, 80);
  setStatus($("capStatus"), `Filled in ${fmt(p.amount)}${p.category ? " · " + p.category : ""}. Check it, then tap Add.`);
  $("phraseRow").hidden = true; $("phrase").value = "";
}
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const speakLabel = $("speakBtn").querySelector("span");
function useDictation() {
  setStatus($("capStatus"), 'Tap the box below, then tap the microphone on your keyboard and say it, e.g. "12.50 lunch at Chipotle".');
  $("phrase").focus();
}
$("speakBtn").onclick = () => {
  $("phraseRow").hidden = false;
  if (!SR) { useDictation(); return; }
  try {
    const rec = new SR();
    rec.lang = navigator.language || "en-US";
    rec.interimResults = true;
    rec.onresult = (e) => {
      const txt = Array.from(e.results).map((r) => r[0].transcript).join(" ");
      $("phrase").value = txt;
      if (e.results[e.results.length - 1].isFinal) fillFromPhrase(txt);
    };
    rec.onerror = () => useDictation();
    rec.onend = () => { speakLabel.textContent = "Say it"; };
    rec.start();
    speakLabel.textContent = "Listening…";
    setStatus($("capStatus"), "Listening. Say the amount and what it was.");
  } catch (e) { useDictation(); }
};
$("phraseGo").onclick = () => fillFromPhrase($("phrase").value);
$("phrase").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); fillFromPhrase($("phrase").value); } });

// ---------- Quick log (full screen keypad) ----------
let qCents = 0, quickPushed = false;
function renderQuick() {
  if ($("quick").hidden) return;
  const k = state.selected;
  $("qDay").textContent = dayLabel(k);
  $("qSpent").textContent = fmt(dayTotal(k)) + " spent";
  $("qAmount").textContent = (qCents / 100).toFixed(2);
  $("qAmount").classList.toggle("zero", !qCents);
  const addBtn = $("keypad").querySelector(".add");
  if (addBtn) { addBtn.disabled = !qCents; addBtn.textContent = qCents ? `Add ${fmt(qCents / 100)} · ${state.cat}` : "Enter an amount"; }
  const ul = $("qList"); ul.replaceChildren();
  live(state.days[k]).slice().sort((a, b) => b.t - a.t).slice(0, 6).forEach((i) => {
    const li = document.createElement("li");
    const a = document.createElement("span"); a.textContent = i.note || i.cat;
    const b = document.createElement("span"); b.textContent = fmt(Number(i.amt));
    li.append(a, b); ul.append(li);
  });
}
function buildKeypad() {
  const kp = $("keypad");
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "del"].forEach((k) => {
    const b = document.createElement("button"); b.type = "button";
    if (k === "del") { b.innerHTML = icon("del"); b.setAttribute("aria-label", "Backspace"); } else b.textContent = k;
    b.onclick = () => keyIn(k);
    kp.append(b);
  });
  const add = document.createElement("button"); add.type = "button"; add.className = "add";
  add.onclick = quickAdd; kp.append(add);
}
function keyIn(k) { qCents = pressKey(qCents, k); renderQuick(); }
function quickAdd() {
  if (!qCents) return;
  const day = state.selected;
  const added = addItem({ cents: qCents, cat: state.cat, note: $("qNote").value, proj: state.proj });
  toast(`Added ${fmt(added.amt)}`, () => removeItem(day, added.id));
  qCents = 0; $("qNote").value = "";
  renderQuick();
}
function openQuick() {
  if (!$("quick").hidden) return;
  $("quick").hidden = $("quickBackdrop").hidden = false;
  document.body.classList.add("locked");
  $("main").setAttribute("aria-hidden", "true");
  qCents = 0; renderChips("qChips"); renderQuick();
  if (location.hash !== "#log") { history.pushState(null, "", "#log"); quickPushed = true; }
  $("closeQuick").focus();
}
function closeQuick(fromHistory) {
  if ($("quick").hidden) return;
  $("quick").hidden = $("quickBackdrop").hidden = true;
  document.body.classList.remove("locked");
  $("main").removeAttribute("aria-hidden");
  if (!fromHistory && location.hash === "#log") {
    if (quickPushed) history.back(); else history.replaceState(null, "", location.pathname + location.search);
  }
  quickPushed = false;
  $("openQuick").focus();
}
$("openQuick").onclick = openQuick;
$("closeQuick").onclick = () => closeQuick(false);
window.addEventListener("hashchange", () => { if (location.hash === "#log") openQuick(); else closeQuick(true); });
document.addEventListener("keydown", (e) => {
  if (!$("modal").hidden) { if (e.key === "Escape") closeModal(false); return; }
  if ($("quick").hidden) return;
  if (e.target === $("qNote")) { if (e.key === "Enter") { e.preventDefault(); quickAdd(); } if (e.key === "Escape") $("qNote").blur(); return; }
  if (e.target.tagName === "BUTTON" && (e.key === "Enter" || e.key === " ")) return;
  if (/^[0-9]$/.test(e.key)) { keyIn(e.key); e.preventDefault(); }
  else if (e.key === "Backspace") { keyIn("del"); e.preventDefault(); }
  else if (e.key === "Enter") { quickAdd(); e.preventDefault(); }
  else if (e.key === "Escape") closeQuick(false);
});

// ---------- projects ----------
const projects = () => (state.settings.projects ||= []);
const projectById = (id) => projects().find((p) => p.id === id) || null;

function createProject(name) {
  const clean = String(name || "").trim().replace(/\s+/g, " ").slice(0, 40);
  if (!clean) return null;
  const existing = findProjectByName(projects(), clean);
  if (existing) { if (existing.archived) delete existing.archived; save(); return existing; }
  const p = { id: newId(), name: clean };
  projects().push(p);
  save();
  return p;
}

/** Fill a project <select>. Shows an archived project only when it's the current value. */
function fillProjectSelect(sel, current, allowNew) {
  if (!sel || document.activeElement === sel) return;
  sel.replaceChildren();
  const opt = (value, label) => { const o = document.createElement("option"); o.value = value; o.textContent = label; sel.append(o); };
  opt("", "No project");
  activeProjects(projects()).forEach((p) => opt(p.id, p.name));
  const cur = current && projectById(current);
  if (cur && cur.archived) opt(cur.id, cur.name + " (archived)");
  if (allowNew) opt("__new", "+ New project…");
  sel.value = cur ? cur.id : "";
}

$("proj").addEventListener("change", () => {
  if ($("proj").value === "__new") {
    $("proj").value = state.proj;
    $("newProjRow").hidden = false;
    $("newProj").focus();
    return;
  }
  state.proj = $("proj").value;
  fillProjectSelect($("qProj"), state.proj, false);
});
$("qProj").addEventListener("change", () => { state.proj = $("qProj").value; });
function createFromAddForm() {
  const p = createProject($("newProj").value);
  if (!p) { $("newProj").focus(); return; }
  state.proj = p.id;
  $("newProj").value = ""; $("newProjRow").hidden = true;
  $("proj").blur();
  render();
  toast(`Project "${p.name}" selected`);
}
$("newProjGo").onclick = createFromAddForm;
$("newProj").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); createFromAddForm(); }
  if (e.key === "Escape") { $("newProjRow").hidden = true; }
});
$("projForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const p = createProject($("projName").value);
  if (!p) { $("projName").focus(); return; }
  $("projName").value = "";
  render();
  toast(`Added project "${p.name}"`);
});

function projectRow(p, totals) {
  const row = document.createElement("div");
  row.className = "proj" + (p.archived ? " archived" : "");
  const info = document.createElement("div");
  const name = document.createElement("div"); name.className = "pname"; name.textContent = p.name;
  const meta = document.createElement("div"); meta.className = "pmeta";
  const t = totals[p.id];
  meta.textContent = t
    ? `${t.count} ${t.count === 1 ? "purchase" : "purchases"} · ${fmt(t.total)} · ${t.first === t.last ? dayLabel(t.first) : dayLabel(t.first) + " – " + dayLabel(t.last)}`
    : "No purchases yet";
  info.append(name, meta);
  const acts = document.createElement("span"); acts.className = "acts";
  const arc = document.createElement("button"); arc.type = "button";
  arc.innerHTML = icon(p.archived ? "restore" : "archive");
  arc.title = p.archived ? "Restore project" : "Archive project";
  arc.setAttribute("aria-label", `${arc.title} ${p.name}`);
  arc.onclick = () => {
    const was = !!p.archived;
    if (was) delete p.archived; else { p.archived = true; if (state.proj === p.id) state.proj = ""; }
    save(); render();
    toast(was ? `Restored "${p.name}"` : `Archived "${p.name}" · its purchases keep the tag`, () => {
      if (was) p.archived = true; else delete p.archived;
      save(); render();
    });
  };
  const del = document.createElement("button"); del.type = "button"; del.className = "del";
  del.innerHTML = icon("trash"); del.title = "Delete project";
  del.setAttribute("aria-label", `Delete project ${p.name}`);
  del.onclick = async () => {
    const n = t ? t.count : 0;
    const ok = await ask({
      title: `Delete "${p.name}"?`,
      text: (n ? `Its ${n} ${n === 1 ? "purchase stays" : "purchases stay"} in your history but lose the project tag. ` : "")
        + "This can't be undone. To hide it but keep the option to bring it back, archive it instead.",
      ok: "Delete project", danger: true,
    });
    if (!ok) return;
    state.days = untagProject(state.days, p.id).days;
    state.settings.projects = projects().filter((x) => x.id !== p.id);
    if (state.proj === p.id) state.proj = "";
    save(); render();
    toast(`Deleted "${p.name}"`);
  };
  acts.append(arc, del);
  row.append(info, acts);
  return row;
}

function renderProjects() {
  const totals = projectTotals(state.days);
  const active = activeProjects(projects());
  const archived = projects().filter((p) => p.archived).sort((a, b) => a.name.localeCompare(b.name));
  const list = $("projList"); list.replaceChildren();
  if (!active.length) {
    const e = document.createElement("div"); e.className = "empty";
    e.textContent = "No projects yet. Add one here, or pick + New project… when adding a purchase.";
    list.append(e);
  }
  active.forEach((p) => list.append(projectRow(p, totals)));
  $("projArchWrap").hidden = !archived.length;
  $("projArchToggle").textContent = `${state.showArchivedProjects ? "Hide" : "Show"} ${archived.length} archived ${archived.length === 1 ? "project" : "projects"}`;
  const al = $("projArchList"); al.hidden = !state.showArchivedProjects; al.replaceChildren();
  if (state.showArchivedProjects) archived.forEach((p) => al.append(projectRow(p, totals)));
}
$("projArchToggle").onclick = () => { state.showArchivedProjects = !state.showArchivedProjects; render(); };

// ---------- backup ----------
$("exportBtn").onclick = async () => {
  const name = `daily-spend-backup-${todayKey()}.json`;
  const json = JSON.stringify(makeBackup(state), null, 1);
  const file = new File([json], name, { type: "application/json" });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: "Daily Spend backup" });
      setStatus($("backupStatus"), "Backup ready. Keep it somewhere safe, like Files, iCloud Drive, Google Drive or your email.");
      return;
    }
  } catch (e) {
    if (e && e.name === "AbortError") return;
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  setStatus($("backupStatus"), `Saved ${name} to your downloads.`);
};
$("importInput").onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  try {
    const data = readBackup(await f.text());
    const n = Object.values(data.days).reduce((s, items) => s + items.length, 0);
    const ok = await ask({
      title: "Restore backup?",
      text: `This adds ${n} ${n === 1 ? "purchase" : "purchases"} from ${Object.keys(data.days).length} days. Purchases already on this phone are kept.`,
      ok: "Restore",
    });
    if (!ok) return;
    state.days = mergeDays(state.days, data.days);
    const { projects: incomingProjects, ...rest } = data.settings;
    Object.assign(state.settings, rest);
    if (incomingProjects) state.settings.projects = mergeProjects(projects(), incomingProjects);
    save(); syncSettingsInputs(); render();
    setStatus($("backupStatus"), `Restored ${n} ${n === 1 ? "purchase" : "purchases"}.`);
  } catch (err) {
    setStatus($("backupStatus"), err.message || "That file couldn't be read.", true);
  }
};

// ---------- install prompt ----------
const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
function dismissedRecently() {
  try { return Date.now() - Number(localStorage.getItem(INSTALL_KEY) || 0) < 14 * 864e5; } catch (e) { return false; }
}
let deferredInstall = null;
if (!standalone && !dismissedRecently()) {
  if (isIOS) {
    $("installText").textContent = "Install Daily Spend: tap the Share button in Safari, then “Add to Home Screen”.";
    $("installBanner").hidden = false;
  }
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstall = e;
    $("installBtn").hidden = false;
    $("installBanner").hidden = false;
  });
}
$("installBtn").onclick = async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  await deferredInstall.userChoice.catch(() => null);
  deferredInstall = null;
  $("installBanner").hidden = true;
};
$("installDismiss").onclick = () => {
  $("installBanner").hidden = true;
  try { localStorage.setItem(INSTALL_KEY, String(Date.now())); } catch (e) {}
};
window.addEventListener("appinstalled", () => { $("installBanner").hidden = true; });

// ---------- other controls ----------
$("prev").addEventListener("click", () => { selectDay(addDays(state.selected, -1)); render(); });
$("next").addEventListener("click", () => { if (state.selected < todayKey()) { selectDay(addDays(state.selected, 1)); render(); } });
$("olderBtn").onclick = () => { state.olderOpen = !state.olderOpen; render(); };
$("budget").addEventListener("input", () => { state.settings.budget = Math.max(0, parseFloat($("budget").value) || 0); save(); render(); });
$("currency").addEventListener("change", () => { state.settings.currency = $("currency").value; save(); render(); });

// A new day starts while the app sits open (or in the background).
let lastToday = todayKey();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  const t = todayKey();
  if (t !== lastToday) { if (state.selected === lastToday) selectDay(t); lastToday = t; render(); }
});

// ---------- which copy is this? ----------
// On iPhone the home-screen app and a Safari tab keep separate data, so say which one is open.
function showWhere() {
  const el = $("mode");
  el.replaceChildren();
  if (standalone) {
    el.textContent = "Installed app · saved on this phone";
    return;
  }
  const tag = document.createElement("span");
  tag.className = "webtag";
  tag.textContent = "Web version";
  const txt = document.createTextNode(isIOS ? " Not the installed app · " : " Saved in this browser · ");
  const a = document.createElement("a");
  a.href = "install.html";
  a.textContent = "Install it";
  el.append(tag, txt, a);
}

// ---------- start ----------
showWhere();
load();
renderChips("chips");
buildKeypad();
syncSettingsInputs();
render();
if (location.hash === "#log") openQuick();

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
