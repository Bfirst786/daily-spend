// Pure logic shared by the app and the tests. No DOM access in this file.

export const CATS = ["Food", "Groceries", "Transport", "Shopping", "Bills", "Fun", "Health", "Other"];

export const CAT_WORDS = {
  Food: /\b(lunch|dinner|breakfast|coffee|cafe|restaurant|pizza|burger|taco|starbucks|chipotle|mcdonald'?s?|snack|drink|bar|beer|tea|takeout|doordash|ubereats)\b/i,
  Groceries: /\b(grocer|grocery|groceries|supermarket|costco|walmart|kroger|aldi|safeway|trader joe'?s?|whole foods|milk|bread|eggs)\b/i,
  Transport: /\b(gas|fuel|uber|lyft|taxi|bus|train|metro|subway|parking|toll|transit|fare)\b/i,
  Shopping: /\b(amazon|target|clothes|shirt|shoes|store|mall)\b/i,
  Bills: /\b(bill|rent|electric|water|internet|phone|insurance|subscription|netflix|spotify)\b/i,
  Fun: /\b(movie|cinema|concert|game|ticket|bowling|show)\b/i,
  Health: /\b(pharmacy|doctor|medicine|cvs|walgreens|gym|dentist|clinic)\b/i,
};

// ---- dates (local time, "YYYY-MM-DD" keys) ----
const pad = (n) => String(n).padStart(2, "0");
export const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseKey = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
export const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return keyOf(d); };
export const isDayKey = (k) => typeof k === "string" && /^\d{4}-\d{2}-\d{2}$/.test(k) && keyOf(parseKey(k)) === k;
export const mondayOf = (k) => addDays(k, -((parseKey(k).getDay() + 6) % 7));

// ---- cash-register entry: digits fill from the right, the decimal point stays fixed ----
export const MAX_CENTS = 99999999;
/** Turn whatever is in the box into cents: "12.5" -> 125, "1,250" -> 1250. */
export function textToCents(text) {
  const digits = String(text).replace(/\D/g, "").replace(/^0+/, "").slice(0, 8);
  return digits ? parseInt(digits, 10) : 0;
}
/** Apply one keypad key ("0"-"9", "00", or "del") to an amount in cents. */
export function pressKey(cents, key) {
  if (key === "del") return Math.floor(cents / 10);
  const next = cents * Math.pow(10, key.length) + Number(key);
  return next <= MAX_CENTS ? next : cents;
}
export const centsToText = (c) => (c ? (c / 100).toFixed(2) : "");

// ---- totals ----
export const live = (items) => (items || []).filter((i) => !i.archived);
export const sum = (items) => Math.round(live(items).reduce((s, i) => s + (Number(i.amt) || 0), 0) * 100) / 100;

/** Status of a day's total against the daily budget. */
export function budgetLevel(total, budget) {
  if (!(budget > 0)) return "none";
  const r = total / budget;
  return r > 1 ? "over" : r >= 0.8 ? "warn" : "ok";
}

/**
 * Which days get a full card in the Purchases list: the selected day, today,
 * then the most recent days that have entries — at most `max`, newest first.
 */
export function visibleDays(days, selected, today, max = 3) {
  const withData = Object.keys(days).filter((d) => (days[d] || []).length).sort().reverse();
  const out = [selected];
  if (selected !== today) out.push(today);
  for (const d of withData) { if (out.length >= max) break; if (!out.includes(d)) out.push(d); }
  return out.sort().reverse();
}

/** A round axis maximum at or above v: 1, 2, 2.5, 5 × 10^n. */
export function niceCeil(v) {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v - 1e-9) return m * p;
  return 10 * p;
}

/**
 * Read a spoken or typed phrase like "12.50 lunch at Chipotle",
 * "$8 for gas" or "20 dollars and 5 cents groceries".
 */
export function parsePhrase(text) {
  let s = " " + String(text || "").trim() + " ";
  let amount = 0;
  let m = s.match(/(\d+)\s*dollars?(?:\s*(?:and\s*)?(\d{1,2})\s*cents?)?/i);
  if (m) { amount = Number(m[1]) + (m[2] ? Number(m[2]) / 100 : 0); s = s.replace(m[0], " "); }
  else {
    m = s.match(/[$£€₹]?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/);
    if (m) { amount = Number(m[1].replace(/,/g, "")) + (m[2] ? Number(m[2].padEnd(2, "0")) / 100 : 0); s = s.replace(m[0], " "); }
  }
  let category = null;
  for (const [c, re] of Object.entries(CAT_WORDS)) if (re.test(text)) { category = c; break; }
  const note = s.replace(/\b(i\s+)?(spent|paid|bought|for|on|at|was|it)\b/gi, " ").replace(/[$£€₹]/g, " ").replace(/\s+/g, " ").trim();
  return { amount: Math.round(amount * 100) / 100, category, note: note ? note[0].toUpperCase() + note.slice(1) : "" };
}

// ---- backup files ----
export const BACKUP_KIND = "daily-spend-backup";

export function makeBackup(data, now = new Date()) {
  return { kind: BACKUP_KIND, version: 1, exportedAt: now.toISOString(), days: data.days, settings: data.settings };
}

/** Validate and clean a backup file. Throws an Error with a readable message when it isn't one. */
export function readBackup(json) {
  let o;
  try { o = typeof json === "string" ? JSON.parse(json) : json; } catch (e) { throw new Error("That file isn't a Daily Spend backup."); }
  if (!o || o.kind !== BACKUP_KIND || typeof o.days !== "object" || o.days === null) throw new Error("That file isn't a Daily Spend backup.");
  const days = {};
  for (const [k, items] of Object.entries(o.days)) {
    if (!isDayKey(k) || !Array.isArray(items)) continue;
    const clean = items
      .filter((i) => i && Number(i.amt) > 0)
      .map((i) => {
        const item = {
          id: String(i.id || Math.random().toString(36).slice(2)),
          amt: Math.round(Number(i.amt) * 100) / 100,
          cat: CATS.includes(i.cat) ? i.cat : "Other",
          note: String(i.note || "").slice(0, 80),
          t: Number(i.t) || parseKey(k).setHours(12, 0, 0, 0),
        };
        if (i.archived) item.archived = true;
        return item;
      });
    if (clean.length) days[k] = clean;
  }
  const s = o.settings || {};
  const settings = {};
  if (Number(s.budget) >= 0) settings.budget = Number(s.budget);
  if (typeof s.currency === "string" && /^[A-Z]{3}$/.test(s.currency)) settings.currency = s.currency;
  return { days, settings };
}

/** Merge imported days into existing ones; items with the same id are replaced, others kept. */
export function mergeDays(current, incoming) {
  const out = { ...current };
  for (const [k, items] of Object.entries(incoming)) {
    const byId = new Map((out[k] || []).map((i) => [i.id, i]));
    for (const i of items) byId.set(i.id, i);
    out[k] = [...byId.values()];
  }
  return out;
}
