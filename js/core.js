// Pure logic shared by the app and the tests. No DOM access in this file.

export const CATS = ["Food", "Groceries", "Transport", "Shopping", "Bills", "Fun", "Health", "Other"];

export const CAT_WORDS = {
  Food: /\b(lunch|dinner|breakfast|coffee|cafe|restaurant|pizza|burger|taco|starbucks|chipotle|mcdonald(?:'|’)?s?|snack|drink|bar|beer|tea|takeout|doordash|ubereats)(?:e?s)?\b/i,
  Groceries: /\b(grocer|grocery|groceries|supermarket|costco|walmart|kroger|aldi|safeway|trader joe'?s?|whole foods|milk|bread|eggs)(?:e?s)?\b/i,
  Transport: /\b(gas|fuel|uber|lyft|taxi|bus|train|metro|subway|parking|toll|transit|fare)(?:e?s)?\b/i,
  Shopping: /\b(amazon|target|clothes|shirt|shoes|store|mall)(?:e?s)?\b/i,
  Bills: /\b(bill|rent|electric|water|internet|phone|insurance|subscription|netflix|spotify)(?:e?s)?\b/i,
  Fun: /\b(movie|cinema|concert|game|ticket|bowling|show)(?:e?s)?\b/i,
  Health: /\b(pharmacy|doctor|medicine|cvs|walgreens|gym|dentist|clinic)(?:e?s)?\b/i,
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

// ---- spoken numbers -> digits ----
const UNITS = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const isNumWord = (w) => w in UNITS || w in TENS || w === "hundred" || w === "thousand" || w === "point";

/** Turn one run of number words into digits: "twenty five" -> "25", "twelve fifty" -> "12.50", "five point two five" -> "5.25". */
function runToDigits(words) {
  const segs = [];
  let total = 0, cur = 0, any = false, last = null, decimals = null;
  for (const w of words) {
    if (decimals !== null) {                       // after "point": read digits one at a time
      if (w in UNITS && UNITS[w] < 10) decimals += String(UNITS[w]);
      else if (w in TENS) decimals += String(TENS[w]);
      continue;
    }
    if (w === "point") { decimals = ""; continue; }
    if (w === "hundred") { cur = (cur || 1) * 100; last = "hundred"; any = true; continue; }
    if (w === "thousand") { total += (cur || 1) * 1000; cur = 0; last = "thousand"; any = true; continue; }
    const v = w in TENS ? TENS[w] : UNITS[w];
    const joins = !any || last === "hundred" || last === "thousand" || (last === "tens" && v < 10 && cur % 10 === 0);
    if (!joins) { segs.push(total + cur); total = 0; cur = 0; }
    cur += v; any = true; last = w in TENS ? "tens" : "unit";
  }
  segs.push(total + cur);
  if (decimals) return `${segs[0]}.${decimals}`;
  // "twelve fifty" / "five oh five": a second group under 100 is cents
  if (segs.length >= 2 && segs[1] < 100) return `${segs[0]}.${String(segs[1]).padStart(2, "0")}`;
  return String(segs[0]);
}

/** Replace spelled-out numbers in a phrase with digits; "a dollar" becomes "1 dollar". */
export function wordsToDigits(text) {
  const tokens = String(text || "").replace(/\ban?\s+(dollar|buck|hundred|thousand)\b/gi, "one $1").split(/(\s+|-)/);
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i].toLowerCase().replace(/[.,!?]$/, "");
    if (!isNumWord(w) || w === "point") { out.push(tokens[i]); continue; }
    const run = [];
    let j = i;
    for (; j < tokens.length; j++) {
      const t = tokens[j].toLowerCase().replace(/[.,!?]$/, "");
      if (/^(\s+|-)$/.test(tokens[j])) continue;
      if (isNumWord(t)) { run.push(t); continue; }
      if (t === "and" && j + 2 < tokens.length && isNumWord(tokens[j + 2].toLowerCase())) continue;
      break;
    }
    while (j > i && /^(\s+|-)$/.test(tokens[j - 1])) j--;   // keep the space after the run
    out.push(runToDigits(run));
    i = j - 1;
  }
  return out.join("");
}

/**
 * Read a spoken or typed phrase like "12.50 lunch at Chipotle", "$8 for gas",
 * "five dollars for McDonald's", "twelve fifty groceries" or "20 dollars and 5 cents".
 */
export function parsePhrase(text) {
  let s = " " + wordsToDigits(text).trim() + " ";
  let amount = 0;
  let m = s.match(/(\d+(?:\.\d{1,2})?)\s*(?:dollars?|bucks?)(?:\s*(?:and\s*)?(\d{1,2})(?:\s*cents?)?)?/i);
  if (m) { amount = Number(m[1]) + (m[2] ? Number(m[2]) / 100 : 0); s = s.replace(m[0], " "); }
  else if ((m = s.match(/(?:^|\s)(\d{1,2})\s*cents?\b/i))) {
    amount = Number(m[1]) / 100; s = s.replace(m[0], " ");
  } else if ((m = s.match(/[$£€₹]\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/) || s.match(/(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/))) {
    amount = Number(m[1].replace(/,/g, "")) + (m[2] ? Number(m[2].padEnd(2, "0")) / 100 : 0); s = s.replace(m[0], " ");
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
