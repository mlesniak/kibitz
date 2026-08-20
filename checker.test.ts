/**
 * Tests for sliceMonth — the core logic that maps the raw v-office
 * availability array into per-day statuses for a given month.
 *
 * Run with: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { sliceMonth, type CalData } from "./lib.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a CalData where every day is unavailable ("N") except the ones
 *  explicitly listed as available dates (YYYY-MM-DD). */
function makeCal(base: string, totalDays: number, availableDates: string[]): CalData {
  const baseMs = new Date(base + "T00:00:00Z").getTime();
  const availability: string[] = Array(totalDays).fill("N");
  for (const d of availableDates) {
    const idx = Math.round((new Date(d + "T00:00:00Z").getTime() - baseMs) / 86_400_000);
    availability[idx] = "Y";
  }
  return { availabilityUpdate: base + "T00:00:00Z", availability };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("all days unavailable → any_available is false", () => {
  const cal = makeCal("2026-08-17", 1095, []);
  const days = sliceMonth(cal, 2027, 8);
  assert.equal(days.length, 31);
  assert.equal(days.every(d => !d.available), true);
});

test("single available day is detected", () => {
  const cal = makeCal("2026-08-17", 1095, ["2027-08-15"]);
  const days = sliceMonth(cal, 2027, 8);
  const available = days.filter(d => d.available);
  assert.equal(available.length, 1);
  assert.equal(available[0].date, "2027-08-15");
});

test("multiple available days are all detected", () => {
  const dates = ["2027-08-01", "2027-08-10", "2027-08-31"];
  const cal = makeCal("2026-08-17", 1095, dates);
  const days = sliceMonth(cal, 2027, 8);
  const available = days.filter(d => d.available).map(d => d.date);
  assert.deepEqual(available, dates);
});

test("correct number of days in August (31)", () => {
  const cal = makeCal("2026-08-17", 1095, []);
  const days = sliceMonth(cal, 2027, 8);
  assert.equal(days.length, 31);
});

test("dates are in correct YYYY-MM-DD format and sequential", () => {
  const cal = makeCal("2026-08-17", 1095, []);
  const days = sliceMonth(cal, 2027, 8);
  assert.equal(days[0].date, "2027-08-01");
  assert.equal(days[30].date, "2027-08-31");
  for (let i = 1; i < days.length; i++) {
    const prev = new Date(days[i - 1].date).getTime();
    const curr = new Date(days[i].date).getTime();
    assert.equal(curr - prev, 86_400_000, `gap between day ${i} and ${i+1} is not 1 day`);
  }
});

test("Q code (changeover) counts as unavailable", () => {
  const cal = makeCal("2026-08-17", 1095, []);
  // Manually set a Q code on Aug 5
  const baseMs = new Date("2026-08-17T00:00:00Z").getTime();
  const idx = Math.round((new Date("2027-08-05T00:00:00Z").getTime() - baseMs) / 86_400_000);
  cal.availability[idx] = "Q";
  const days = sliceMonth(cal, 2027, 8);
  assert.equal(days.find(d => d.date === "2027-08-05")?.available, false);
});

test("day beyond array end is treated as unavailable", () => {
  // Array only covers up to 2027-07-31 (not reaching August at all)
  const cal: CalData = {
    availabilityUpdate: "2027-07-01T00:00:00Z",
    availability: Array(30).fill("Y"), // all Y but too short
  };
  const days = sliceMonth(cal, 2027, 8);
  assert.equal(days.every(d => !d.available), true);
});

test("first available → transition detected (any_available true)", () => {
  // Simulates the scenario the checker watches for:
  // was all-red, now one day is green
  const cal = makeCal("2026-08-17", 1095, ["2027-08-20"]);
  const days = sliceMonth(cal, 2027, 8);
  const anyAvailable = days.some(d => d.available);
  assert.equal(anyAvailable, true);
});
