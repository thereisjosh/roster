/**
 * NL availability parsing scorer — field-level F1 with time tolerance.
 *
 * Key metrics:
 * - Day accuracy ≥ 0.90
 * - Time accuracy ≥ 0.80 (with 30-minute tolerance)
 * - Overall F1 ≥ 0.85
 */

interface AvailabilityEntry {
  day: string;
  available: boolean;
  startTime?: string | null;
  endTime?: string | null;
  reason?: string | null;
}

interface ParsedOutput {
  entries: AvailabilityEntry[];
}

interface ExpectedCase {
  entries: AvailabilityEntry[];
}

const TIME_TOLERANCE_MINUTES = 30;

function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function timeWithinTolerance(actual: string | null | undefined, expected: string | null | undefined): boolean {
  if (!expected) return true; // no time constraint in expected — any actual time is ok
  if (!actual) return false; // expected has time but actual doesn't — fail
  const diff = Math.abs(parseTimeToMinutes(actual) - parseTimeToMinutes(expected));
  return diff <= TIME_TOLERANCE_MINUTES;
}

function scoreEntries(actual: AvailabilityEntry[], expected: AvailabilityEntry[]) {
  let dayMatches = 0;
  let timeMatches = 0;
  let totalExpected = expected.length;
  let totalActual = actual.length;
  let truePositives = 0;

  const actualByDay = new Map<string, AvailabilityEntry>();
  for (const entry of actual) {
    actualByDay.set(entry.day.toLowerCase(), entry);
  }

  for (const exp of expected) {
    const act = actualByDay.get(exp.day.toLowerCase());
    if (!act) continue;

    truePositives++;

    // Day + availability match
    if (act.available === exp.available) {
      dayMatches++;
    }

    // Time match (with tolerance)
    const startOk = timeWithinTolerance(act.startTime, exp.startTime);
    const endOk = timeWithinTolerance(act.endTime, exp.endTime);
    if (startOk && endOk) {
      timeMatches++;
    }
  }

  const precision = totalActual > 0 ? truePositives / totalActual : 0;
  const recall = totalExpected > 0 ? truePositives / totalExpected : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  const dayAccuracy = totalExpected > 0 ? dayMatches / totalExpected : 0;
  const timeAccuracy = totalExpected > 0 ? timeMatches / totalExpected : 0;

  return { f1, dayAccuracy, timeAccuracy, precision, recall };
}

export default function parsingScorer(output: string, context: { vars: { expected: string } }) {
  try {
    const parsed: ParsedOutput = JSON.parse(output);
    const expected: ExpectedCase = JSON.parse(context.vars.expected);

    if (!expected || !expected.entries) {
      return { pass: false, score: 0, reason: "No expected entries to compare" };
    }

    const { f1, dayAccuracy, timeAccuracy } = scoreEntries(parsed.entries ?? [], expected.entries);

    const pass = dayAccuracy >= 0.9 && timeAccuracy >= 0.8 && f1 >= 0.85;

    return {
      pass,
      score: f1,
      reason: `F1=${f1.toFixed(3)}, dayAccuracy=${dayAccuracy.toFixed(3)}, timeAccuracy=${timeAccuracy.toFixed(3)}`,
    };
  } catch (e) {
    return {
      pass: false,
      score: 0,
      reason: `Failed to parse output: ${e instanceof Error ? e.message : "unknown error"}`,
    };
  }
}
