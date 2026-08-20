#!/usr/bin/env tsx
/**
 * Kiebitz availability checker.
 *
 * Every run:
 *  1. Scrapes the inselzeit.de page to extract a fresh v-office API token.
 *  2. Calls the v-office getCal API for unit 176608 (Arche Svea Kiebitz).
 *  3. Slices availability for August 2027.
 *  4. Writes www/status.json for the frontend.
 *  5. On first transition (all-unavailable → any-available) fires a ntfy.sh push.
 *     On fetch failure fires a warning push (once per failure streak).
 *
 * Usage:
 *   tsx checker.ts [--dry-run]
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const UNIT_PAGE_URL =
  "https://www.inselzeit.de/Deutschland/Nordsee/Ostfriesische.Inseln/Spiekeroog/Kiebitz";
const UNIT_ID = 176608;
const VOFFICE_API = "https://api2.v-office.com/api/json/getCal";
const NTFY_SERVER = "https://ntfy.sh";
const NTFY_TOPIC = "madeleine-kibitz";
const NTFY_WARN_TOPIC = "madeleine-kibitz"; // warnings go to same topic
const CHECK_MONTH = { year: 2027, month: 8 }; // August 2027

const STATE_PATH = "/var/lib/kibitz-checker/state.json";
const STATUS_PATH = path.join(__dirname, "www", "status.json");

const DRY_RUN = process.argv.includes("--dry-run");
const FAILURE_THRESHOLD = 3;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CalResponse {
  ok?: boolean;
  cal: {
    availability: string[];       // "Y" | "N" | "Q" per day from availabilityUpdate
    availabilityUpdate: string;   // ISO datetime, e.g. "2026-08-17T11:45:42Z"
    changeOver: string[];
    minStay: number[];
  };
}

interface DayStatus {
  date: string;   // YYYY-MM-DD
  available: boolean;
}

interface StatusJson {
  checked_at: string;   // ISO datetime
  any_available: boolean;
  days: DayStatus[];
}

interface State {
  was_available: boolean;
  notified: boolean;
  consecutive_failures: number;
  failure_notified: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function loadState(): State {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as State;
  } catch {
    return {
      was_available: false,
      notified: false,
      consecutive_failures: 0,
      failure_notified: false,
    };
  }
}

function saveState(state: State) {
  if (DRY_RUN) {
    log(`DRY-RUN: would save state: ${JSON.stringify(state)}`);
    return;
  }
  const dir = path.dirname(STATE_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = STATE_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  fs.renameSync(tmp, STATE_PATH);
}

function writeStatus(status: StatusJson) {
  if (DRY_RUN) {
    log(`DRY-RUN: would write status.json: any_available=${status.any_available}`);
    return;
  }
  fs.mkdirSync(path.dirname(STATUS_PATH), { recursive: true });
  const tmp = STATUS_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(status, null, 2), "utf8");
  fs.renameSync(tmp, STATUS_PATH);
  log(`Wrote status.json (any_available=${status.any_available})`);
}

async function ntfyPush(payload: Record<string, unknown>) {
  if (DRY_RUN) {
    log(`DRY-RUN: would push ntfy: ${JSON.stringify(payload)}`);
    return;
  }
  const resp = await fetch(NTFY_SERVER, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    log(`ntfy push failed: ${resp.status} ${await resp.text()}`);
  } else {
    log(`ntfy pushed: ${payload["title"]}`);
  }
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

async function fetchToken(): Promise<string> {
  const resp = await fetch(UNIT_PAGE_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0",
    },
  });
  if (!resp.ok) throw new Error(`Page fetch failed: ${resp.status}`);
  const html = await resp.text();
  const match = html.match(/token:\s*'(eyJ[^']+)'/);
  if (!match) throw new Error("Could not extract v-office token from page HTML");
  return match[1];
}

async function fetchCalendar(token: string): Promise<CalResponse["cal"]> {
  const data = JSON.stringify({ unit: UNIT_ID });
  const url = new URL(VOFFICE_API);
  url.searchParams.set("actionName", "getCal");
  url.searchParams.set("lang", "de");
  url.searchParams.set("token", token);
  url.searchParams.set("data", data);

  const resp = await fetch(url.toString(), {
    headers: { Referer: UNIT_PAGE_URL },
  });
  if (!resp.ok) throw new Error(`API fetch failed: ${resp.status}`);
  const json = (await resp.json()) as CalResponse;
  if (json.ok === false) throw new Error(`API error: ${JSON.stringify(json)}`);
  return json.cal;
}

function sliceMonth(
  cal: CalResponse["cal"],
  year: number,
  month: number
): DayStatus[] {
  // The availability array starts at midnight of the availabilityUpdate date (UTC).
  const baseDate = new Date(cal.availabilityUpdate.split("T")[0] + "T00:00:00Z");

  // Days in the target month
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const result: DayStatus[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const target = new Date(Date.UTC(year, month - 1, day));
    const idx = Math.round(
      (target.getTime() - baseDate.getTime()) / 86_400_000
    );
    const code = idx >= 0 && idx < cal.availability.length
      ? cal.availability[idx]
      : "N";
    result.push({
      date: target.toISOString().slice(0, 10),
      available: code === "Y",
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (DRY_RUN) log("--- DRY RUN MODE ---");

  const state = loadState();

  let days: DayStatus[];
  let anyAvailable: boolean;

  try {
    log("Fetching token from inselzeit.de...");
    const token = await fetchToken();
    log("Fetching calendar from v-office API...");
    const cal = await fetchCalendar(token);
    log(`Calendar fetched (availabilityUpdate=${cal.availabilityUpdate}, length=${cal.availability.length})`);

    days = sliceMonth(cal, CHECK_MONTH.year, CHECK_MONTH.month);
    anyAvailable = days.some((d) => d.available);

    const availableDays = days.filter((d) => d.available).map((d) => d.date);
    log(
      `August 2027: any_available=${anyAvailable}` +
        (availableDays.length ? ` (${availableDays.join(", ")})` : "")
    );

    // Reset failure state on success
    state.consecutive_failures = 0;
    state.failure_notified = false;

  } catch (err) {
    log(`ERROR: ${(err as Error).message}`);
    state.consecutive_failures += 1;
    log(`Consecutive failures: ${state.consecutive_failures}`);

    if (
      state.consecutive_failures >= FAILURE_THRESHOLD &&
      !state.failure_notified
    ) {
      await ntfyPush({
        topic: NTFY_WARN_TOPIC,
        title: "Kibitz-Checker: Fetch-Fehler",
        message: `Checker schlaegt seit ${state.consecutive_failures} Laeufen fehl: ${(err as Error).message}`,
        priority: 4,
        tags: ["warning"],
      });
      state.failure_notified = true;
    }

    saveState(state);
    process.exit(1);
  }

  // Write frontend status
  writeStatus({
    checked_at: new Date().toISOString(),
    any_available: anyAvailable,
    days,
  });

  // Notification logic: fire exactly once on first false→true transition
  if (anyAvailable && !state.notified) {
    const availDays = days.filter((d) => d.available).map((d) => d.date);
    log("Transition detected: sending ntfy push...");
    await ntfyPush({
      topic: NTFY_TOPIC,
      title: "Kiebitz auf Spiekeroog ist verfuegbar!",
      message:
        `August 2027 hat freie Tage: ${availDays.join(", ")}.\n` +
        `Jetzt buchen: ${UNIT_PAGE_URL}`,
      click: UNIT_PAGE_URL,
      actions: [
        { action: "view", label: "Jetzt buchen", url: UNIT_PAGE_URL },
      ],
      tags: ["beach_with_umbrella", "calendar"],
      priority: 5,
    });
    state.notified = true;
  } else if (!anyAvailable && state.notified) {
    // Dates became unavailable again (e.g. booking cancelled then re-blocked)
    // Reset so we notify again if it opens back up.
    log("Was notified before but now unavailable again — resetting notified flag.");
    state.notified = false;
  }

  state.was_available = anyAvailable;
  saveState(state);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
