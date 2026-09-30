/**
 * Convert golden expected outputs from shift-level to slot-level (1hr granularity).
 *
 * Reads each week-*-expected-output.json + corresponding week-*.json input,
 * expands assignments into hourly slots, writes week-*-expected-slots.json.
 *
 * SlotId convention: {dayAbbrev}-{role}-{hour}  (e.g. mon-barista-11)
 *
 * Usage: npx tsx scripts/convert-golden-to-slots.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const GOLDEN_DIR = path.resolve(__dirname, '../evals/golden/schedules');

const DAY_ABBREVS: Record<number, string> = {
  0: 'sun', 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat',
};

function getDayAbbrev(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  return DAY_ABBREVS[d.getUTCDay()];
}

function parseTime(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h + m / 60;
}

interface Shift {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  requiredRole: string;
  minStaff: number;
}

interface Assignment {
  shiftId: string;
  staffId: string;
  startTime?: string;
  endTime?: string;
}

interface Slot {
  slotId: string;
  staffId: string;
  date: string;
  hour: number;
  role: string;
}

// Find all week-*-expected-output.json files
const expectedFiles = fs.readdirSync(GOLDEN_DIR)
  .filter(f => f.match(/^week-.*-expected-output\.json$/))
  .sort();

for (const expectedFile of expectedFiles) {
  const weekPrefix = expectedFile.replace('-expected-output.json', '');
  const inputFile = weekPrefix + '.json';

  const inputPath = path.join(GOLDEN_DIR, inputFile);
  const expectedPath = path.join(GOLDEN_DIR, expectedFile);
  const outputPath = path.join(GOLDEN_DIR, weekPrefix + '-expected-slots.json');

  if (!fs.existsSync(inputPath)) {
    console.warn(`Skipping ${expectedFile}: no matching input file ${inputFile}`);
    continue;
  }

  const input = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf-8'));

  const shiftMap = new Map<string, Shift>();
  for (const s of input.shifts) {
    shiftMap.set(s.id, s);
  }

  const slots: Slot[] = [];

  for (const assignment of expected.assignments as Assignment[]) {
    const shift = shiftMap.get(assignment.shiftId);
    if (!shift) {
      console.warn(`  ${weekPrefix}: shift ${assignment.shiftId} not found in input`);
      continue;
    }

    // Determine actual start/end for this assignment
    const startHour = parseTime(assignment.startTime ?? shift.startTime);
    const endHour = parseTime(assignment.endTime ?? shift.endTime);
    const dayAbbrev = getDayAbbrev(shift.date);
    const role = shift.requiredRole;

    // Expand into hourly slots
    // A slot at hour H means coverage from H:00 to H+1:00
    // Include hour H if the assignment covers any part of [H, H+1)
    // Start from ceil of startHour, but if startHour is exactly on the hour, include it
    const firstHour = Math.ceil(startHour - 0.001); // handle floating point: 11.0 → 11
    const lastHour = Math.ceil(endHour - 0.001) - 1; // endTime 16:00 means last slot is 15

    for (let h = firstHour; h <= lastHour; h++) {
      slots.push({
        slotId: `${dayAbbrev}-${role}-${h}`,
        staffId: assignment.staffId,
        date: shift.date,
        hour: h,
        role,
      });
    }
  }

  // Sort by date, hour, role, staffId
  slots.sort((a, b) =>
    a.date.localeCompare(b.date) || a.hour - b.hour || a.role.localeCompare(b.role) || a.staffId.localeCompare(b.staffId)
  );

  fs.writeFileSync(outputPath, JSON.stringify({ slots }, null, 2) + '\n');
  console.log(`${weekPrefix}: ${expected.assignments.length} assignments → ${slots.length} slots → ${path.basename(outputPath)}`);
}

console.log('\nDone.');
