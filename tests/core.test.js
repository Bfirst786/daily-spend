import { test } from "node:test";
import assert from "node:assert/strict";
import {
  keyOf, parseKey, addDays, isDayKey, mondayOf, textToCents, pressKey, centsToText,
  sum, budgetLevel, visibleDays, niceCeil, parsePhrase, wordsToDigits,
  cleanProjects, activeProjects, findProjectByName, projectTotals, untagProject, mergeProjects, makeBackup, readBackup, mergeDays,
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

test("spelled-out amounts from speech", () => {
  assert.deepEqual(parsePhrase("five dollars for McDonald's"), { amount: 5, category: "Food", note: "McDonald's" });
  assert.deepEqual(parsePhrase("Five dollars for McDonald’s"), { amount: 5, category: "Food", note: "McDonald’s" });
  assert.equal(parsePhrase("twelve fifty lunch").amount, 12.5);
  assert.equal(parsePhrase("nine ninety nine Netflix").amount, 9.99);
  assert.equal(parsePhrase("twenty five dollars and fifty cents groceries").amount, 25.5);
  assert.equal(parsePhrase("a dollar coffee").amount, 1);
  assert.equal(parsePhrase("one hundred twenty five rent").amount, 125);
  assert.equal(parsePhrase("one thousand two hundred rent").amount, 1200);
  assert.equal(parsePhrase("five point two five snack").amount, 5.25);
  assert.equal(parsePhrase("seven bucks parking").amount, 7);
  assert.equal(parsePhrase("fifty cents gum").amount, 0.5);
  assert.equal(parsePhrase("5 dollars for 2 coffees").category, "Food");
});

test("number words become digits without touching other words", () => {
  assert.equal(wordsToDigits("twenty-five dollars"), "25 dollars");
  assert.equal(wordsToDigits("someone bought a tent"), "someone bought a tent");
  assert.equal(wordsToDigits("a buck"), "1 buck");
});

test("project totals skip archived purchases and track the date range", () => {
  const days = {
    "2026-10-01": [{ id: "a", amt: 40, proj: "p1" }, { id: "b", amt: 5 }],
    "2026-10-04": [{ id: "c", amt: 12.5, proj: "p1" }, { id: "d", amt: 99, proj: "p1", archived: true }, { id: "e", amt: 3, proj: "p2" }],
  };
  assert.deepEqual(projectTotals(days), {
    p1: { total: 52.5, count: 2, first: "2026-10-01", last: "2026-10-04" },
    p2: { total: 3, count: 1, first: "2026-10-04", last: "2026-10-04" },
  });
});

test("deleting a project untags its purchases and reports changed days", () => {
  const days = { "2026-10-01": [{ id: "a", amt: 1, proj: "p1" }], "2026-10-02": [{ id: "b", amt: 2 }] };
  const { days: out, changed } = untagProject(days, "p1");
  assert.deepEqual(changed, ["2026-10-01"]);
  assert.equal(out["2026-10-01"][0].proj, undefined);
  assert.equal(days["2026-10-01"][0].proj, "p1"); // original untouched
});

test("project lists: sorting, lookup, cleaning, merging", () => {
  const list = [{ id: "1", name: "paint living room" }, { id: "2", name: "Bathroom", archived: true }, { id: "3", name: "Garden" }];
  assert.deepEqual(activeProjects(list).map((p) => p.name), ["Garden", "paint living room"]);
  assert.equal(findProjectByName(list, "  Paint   Living Room ").id, "1");
  assert.equal(findProjectByName(list, "garage"), null);
  assert.deepEqual(cleanProjects([{ id: "x", name: "  A " }, { id: "x", name: "dup" }, { name: "no id" }, { id: "y", name: "" }]), [{ id: "x", name: "A" }]);
  assert.deepEqual(mergeProjects([{ id: "1", name: "Old" }], [{ id: "1", name: "New", archived: true }, { id: "2", name: "B" }]),
    [{ id: "1", name: "New", archived: true }, { id: "2", name: "B" }]);
});

test("backups keep projects and project tags", () => {
  const data = {
    days: { "2026-10-06": [{ id: "a", amt: 4.5, cat: "Shopping", note: "Paint", t: 1, proj: "p1" }] },
    settings: { budget: 40, currency: "USD", projects: [{ id: "p1", name: "Paint living room" }, { id: "p2", name: "Old job", archived: true }] },
  };
  assert.deepEqual(readBackup(JSON.stringify(makeBackup(data))), data);
});
