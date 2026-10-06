import { test } from "node:test";
import assert from "node:assert/strict";
import {
  keyOf, parseKey, addDays, isDayKey, mondayOf, textToCents, pressKey, centsToText,
  sum, budgetLevel, visibleDays, niceCeil, parsePhrase, makeBackup, readBackup, mergeDays,
} from "../js/core.js";

test("day keys round-trip and step across month ends", () => {
  assert.equal(keyOf(parseKey("2026-10-06")), "2026-10-06");
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.ok(isDayKey("2026-02-28"));
  assert.ok(!isDayKey("2026-02-30"));
  assert.ok(!isDayKey("hello"));
});

test("weeks start on Monday", () => {
  assert.equal(mondayOf("2026-10-06"), "2026-10-05"); // Tuesday
  assert.equal(mondayOf("2026-10-11"), "2026-10-05"); // Sunday
  assert.equal(mondayOf("2026-10-05"), "2026-10-05");
});

test("cash-register entry keeps the decimal fixed", () => {
  let c = 0;
  for (const k of ["1", "2", "5", "0"]) c = pressKey(c, k);
  assert.equal(c, 1250);
  assert.equal(centsToText(c), "12.50");
  assert.equal(pressKey(c, "del"), 125);
  assert.equal(pressKey(5, "00"), 500);
  assert.equal(pressKey(99999999, "1"), 99999999);
  assert.equal(textToCents("12.5"), 125);
  assert.equal(textToCents("0.07"), 7);
  assert.equal(textToCents(""), 0);
  assert.equal(centsToText(0), "");
});

test("totals skip archived purchases and avoid float drift", () => {
  const items = [{ amt: 0.1 }, { amt: 0.2 }, { amt: 5, archived: true }];
  assert.equal(sum(items), 0.3);
  assert.equal(sum(undefined), 0);
});

test("budget level", () => {
  assert.equal(budgetLevel(10, 0), "none");
  assert.equal(budgetLevel(10, 50), "ok");
  assert.equal(budgetLevel(40, 50), "warn");
  assert.equal(budgetLevel(51, 50), "over");
});

test("at most three day cards: selected, today, then most recent", () => {
  const days = { "2026-10-01": [{}], "2026-10-03": [{}], "2026-10-05": [{}], "2026-10-06": [{}] };
  assert.deepEqual(visibleDays(days, "2026-10-06", "2026-10-06"), ["2026-10-06", "2026-10-05", "2026-10-03"]);
  assert.deepEqual(visibleDays(days, "2026-10-01", "2026-10-06"), ["2026-10-06", "2026-10-05", "2026-10-01"]);
  assert.deepEqual(visibleDays({}, "2026-10-06", "2026-10-06"), ["2026-10-06"]);
});

test("chart axis maximum", () => {
  assert.equal(niceCeil(50), 50);
  assert.equal(niceCeil(51), 100);
  assert.equal(niceCeil(180), 200);
  assert.equal(niceCeil(0), 1);
});

test("spoken phrases become amount, category and note", () => {
  assert.deepEqual(parsePhrase("12.50 lunch at Chipotle"), { amount: 12.5, category: "Food", note: "Lunch Chipotle" });
  assert.deepEqual(parsePhrase("spent 8 dollars on gas at Shell"), { amount: 8, category: "Transport", note: "Gas Shell" });
  assert.equal(parsePhrase("20 dollars and 5 cents groceries").amount, 20.05);
  assert.equal(parsePhrase("$1,250 rent").amount, 1250);
  assert.equal(parsePhrase("$3.5 coffee").amount, 3.5);
  assert.equal(parsePhrase("coffee").amount, 0);
});

test("backups round-trip and reject other files", () => {
  const data = {
    days: { "2026-10-06": [{ id: "a", amt: 4.5, cat: "Food", note: "Coffee", t: 1 }, { id: "b", amt: 9, cat: "Fun", note: "", t: 2, archived: true }] },
    settings: { budget: 40, currency: "USD" },
  };
  const back = readBackup(JSON.stringify(makeBackup(data)));
  assert.deepEqual(back, data);
  assert.throws(() => readBackup("{}"), /isn't a Daily Spend backup/);
  assert.throws(() => readBackup("not json"), /isn't a Daily Spend backup/);
});

test("backup reading drops bad rows and fixes unknown categories", () => {
  const back = readBackup({ kind: "daily-spend-backup", days: { "2026-10-06": [{ id: "x", amt: 3, cat: "Pets" }, { amt: -1 }], "bad": [{ amt: 1 }] } });
  assert.deepEqual(Object.keys(back.days), ["2026-10-06"]);
  assert.equal(back.days["2026-10-06"].length, 1);
  assert.equal(back.days["2026-10-06"][0].cat, "Other");
});

test("restoring merges by id", () => {
  const cur = { "2026-10-06": [{ id: "a", amt: 1 }, { id: "b", amt: 2 }] };
  const inc = { "2026-10-06": [{ id: "b", amt: 5 }, { id: "c", amt: 3 }], "2026-10-05": [{ id: "d", amt: 7 }] };
  const out = mergeDays(cur, inc);
  assert.deepEqual(out["2026-10-06"].map((i) => [i.id, i.amt]), [["a", 1], ["b", 5], ["c", 3]]);
  assert.equal(out["2026-10-05"].length, 1);
});
