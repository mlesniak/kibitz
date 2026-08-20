/**
 * Pure, side-effect-free logic extracted from checker.ts.
 * Imported by both checker.ts and the test suite.
 */

export interface CalData {
  availability: string[];     // "Y" | "N" | "Q" per day from availabilityUpdate
  availabilityUpdate: string; // ISO datetime, e.g. "2026-08-17T11:45:42Z"
}

export interface DayStatus {
  date: string;      // YYYY-MM-DD
  available: boolean;
}

/**
 * Slice the flat availability array into per-day statuses for the given month.
 *
 * The array index 0 corresponds to the date in availabilityUpdate (UTC date).
 * "Y" means available; anything else ("N", "Q", or out-of-bounds) means not.
 */
export function sliceMonth(
  cal: CalData,
  year: number,
  month: number, // 1-based
): DayStatus[] {
  const baseDate = new Date(cal.availabilityUpdate.split("T")[0] + "T00:00:00Z");
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const result: DayStatus[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const target = new Date(Date.UTC(year, month - 1, day));
    const idx = Math.round(
      (target.getTime() - baseDate.getTime()) / 86_400_000,
    );
    const code =
      idx >= 0 && idx < cal.availability.length
        ? cal.availability[idx]
        : "N";
    result.push({
      date: target.toISOString().slice(0, 10),
      available: code === "Y",
    });
  }
  return result;
}
