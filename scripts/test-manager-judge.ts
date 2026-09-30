/**
 * Quick test: do manager golden schedules pass the LLM judge?
 *
 * Runs all 6 golden schedules through the GPT-4.1-mini judge and reports
 * per-dimension scores. Manager's own schedules should score 4-5/5.
 *
 * Usage: npx tsx scripts/test-manager-judge.ts
 */
import dotenv from "dotenv";
import { readFileSync } from "fs";
import { resolve } from "path";

dotenv.config({ path: resolve(__dirname, "..", ".env") });

import scheduleJudge from "../evals/scorers/schedule-judge";

const goldenDir = resolve(__dirname, "../evals/golden/schedules");

// Inline the transform logic (mirrors evals/transforms/compute-eligibility.js)
function computeTransformVars(inputJson: string) {
  const data = JSON.parse(inputJson);
  const shifts = data.shifts || [];
  const staff = data.staff || [];

  // Time-range availability helpers (mirrors lib/scheduling/validator.ts)
  function parseTimeToHours(time: string): number {
    const [h, m] = time.split(':').map(Number);
    return h + m / 60;
  }

  function isAvailableForShiftLocal(s: any, shift: any, minShiftHours: number = 3): boolean {
    if (!s.availability || s.availability.length === 0) {
      return !s.unavailable.includes(shift.id);
    }
    const windows = s.availability.filter((w: any) => w.day === shift.date);
    if (windows.length === 0) return false;
    let totalOverlap = 0;
    for (const w of windows) {
      const overlapStart = Math.max(parseTimeToHours(w.startTime), parseTimeToHours(shift.startTime));
      const overlapEnd = Math.min(parseTimeToHours(w.endTime), parseTimeToHours(shift.endTime));
      totalOverlap += Math.max(0, overlapEnd - overlapStart);
    }
    return totalOverlap >= minShiftHours;
  }

  const minShiftHours = data.businessConfig?.minShiftHours ?? 3;

  const guide = shifts.map((shift: any) => {
    const eligible = staff
      .filter((s: any) => s.qualifications.includes(shift.requiredRole))
      .filter((s: any) => isAvailableForShiftLocal(s, shift, minShiftHours))
      .map((s: any) => s.id);
    const slack = eligible.length - shift.minStaff;
    return { id: shift.id, role: shift.requiredRole, min: shift.minStaff, eligible, slack };
  }).sort((a: any, b: any) => a.slack - b.slack);

  const infeasibleShifts: any[] = [];
  const lines = guide.map((g: any) => {
    if (g.slack === 0) {
      return g.id + ' (' + g.role + ', min ' + g.min + '): [' + g.eligible.join(', ') + '] ** FORCED **';
    } else if (g.slack < 0) {
      infeasibleShifts.push(g);
      return g.id + ' (' + g.role + ', min ' + g.min + ', only ' + g.eligible.length + ' eligible): [' + g.eligible.join(', ') + '] !! INFEASIBLE !!';
    } else {
      return g.id + ' (' + g.role + ', min ' + g.min + ', ' + g.eligible.length + ' eligible): [' + g.eligible.join(', ') + '] — assign ' + g.min + '+ from this list';
    }
  });

  if (infeasibleShifts.length > 0) {
    lines.push('');
    lines.push('INFEASIBLE SHIFTS SUMMARY — assign ALL eligible staff to these:');
    for (const g of infeasibleShifts) {
      lines.push('  ' + g.id + ': min ' + g.min + ', only ' + g.eligible.length + ' eligible → assign [' + g.eligible.join(', ') + ']');
    }
  }

  const eligibility_guide = lines.join('\n');

  // Staffing plan
  const ftHours = data.businessConfig?.fullTimeHours;
  const shiftDuration: Record<string, number> = {};
  for (const shift of shifts) {
    const [sh, sm] = shift.startTime.split(':').map(Number);
    const [eh, em] = shift.endTime.split(':').map(Number);
    let hours = (eh * 60 + em - sh * 60 - sm) / 60;
    if (shift.breakMinutes) hours -= shift.breakMinutes / 60;
    shiftDuration[shift.id] = hours;
  }

  const staffEligibility: Record<string, { shifts: string[]; totalAvailableHours: number }> = {};
  for (const s of staff) {
    staffEligibility[s.id] = { shifts: [], totalAvailableHours: 0 };
  }
  for (const g of guide) {
    for (const sid of g.eligible) {
      staffEligibility[sid].shifts.push(g.id);
      staffEligibility[sid].totalAvailableHours += shiftDuration[g.id] || 0;
    }
  }

  const budgetLines = staff.map((s: any) => {
    const type = s.employmentType === 'full-time' ? 'full-time' : 'part-time';
    const maxH = s.maxWeeklyHours;
    const hardMax = (type === 'full-time' && ftHours) ? ftHours.max : maxH;
    const eligShifts = staffEligibility[s.id].shifts;
    const availH = staffEligibility[s.id].totalAvailableHours;
    return '  ' + s.id + ': ' + type + ', max ' + maxH + 'h' +
      (type === 'full-time' && ftHours ? ' (hard ceiling ' + hardMax + 'h)' : '') +
      ', ' + availH + 'h across ' + eligShifts.length + ' eligible shifts: [' + eligShifts.join(', ') + ']';
  });

  const preSolvedLines: string[] = [];
  const remainingLines: string[] = [];
  for (const g of guide) {
    if (g.slack === 0) {
      preSolvedLines.push('  FORCED: ' + g.id + ' → [' + g.eligible.join(', ') + '] (exactly ' + g.min + ' eligible = ' + g.min + ' needed)');
    } else if (g.slack < 0) {
      preSolvedLines.push('  INFEASIBLE: ' + g.id + ' → [' + g.eligible.join(', ') + '] (need ' + g.min + ', only ' + g.eligible.length + ' eligible — assign all)');
    } else {
      remainingLines.push('  ' + g.id + ' (min ' + g.min + ', ' + g.eligible.length + ' eligible): [' + g.eligible.join(', ') + '] — pick ' + g.min + '+ considering hour budgets');
    }
  }

  const staffing_plan_parts = ['STAFF HOUR BUDGETS:'];
  staffing_plan_parts.push(...budgetLines);
  if (preSolvedLines.length > 0) {
    staffing_plan_parts.push('');
    staffing_plan_parts.push('PRE-SOLVED ASSIGNMENTS (copy these directly into output):');
    staffing_plan_parts.push(...preSolvedLines);
  }
  if (remainingLines.length > 0) {
    staffing_plan_parts.push('');
    staffing_plan_parts.push('REMAINING SHIFTS TO SOLVE:');
    staffing_plan_parts.push(...remainingLines);
  }
  const staffing_plan = staffing_plan_parts.join('\n');

  // Scheduling parameters
  let scheduling_params = '';
  const bc = data.businessConfig;
  if (bc) {
    const parts: string[] = [];
    if (bc.breakRules) {
      const breaks = bc.breakRules.map((b: any) =>
        `${b.name}: ${b.durationMinutes}min`
      ).join('; ');
      parts.push(`Break rules: ${breaks}`);
    }
    if (bc.fullTimeHours) {
      parts.push(`Full-time hours: TARGET ${bc.fullTimeHours.target}h/week, HARD MAX ${bc.fullTimeHours.max}h`);
    }
    if (bc.roleMinimumsPerShift) {
      const mins = bc.roleMinimumsPerShift.map((r: any) => `at least ${r.min} ${r.role} per shift`).join('; ');
      parts.push(`Role minimums: ${mins}`);
    }
    if (bc.maxConsecutiveDays) parts.push(`Max consecutive days: ${bc.maxConsecutiveDays}`);
    if (bc.closedDays) {
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      parts.push(`Closed: ${bc.closedDays.map((d: number) => dayNames[d] || d).join(', ')}`);
    }
    scheduling_params = parts.join('\n');
  }

  // Business rules from preferenceRules
  let business_rules = '';
  const pr = data.preferenceRules;
  if (pr && pr.length > 0) {
    business_rules = pr.map((r: any) => {
      const prefix = r.ruleType === 'hard' ? 'MUST' : 'PREFER';
      return `${prefix}: ${r.ruleText}`;
    }).join('\n');
  }

  return { input: inputJson, eligibility_guide, staffing_plan, scheduling_params, business_rules };
}

const weeks = ["week-23feb", "week-2mar", "week-9mar", "week-16mar", "week-23mar", "week-30mar"];

async function main() {
  let allPass = true;
  const results: { week: string; pass: boolean; scores: Record<string, number> }[] = [];

  for (const week of weeks) {
    const inputJson = readFileSync(resolve(goldenDir, `${week}.json`), "utf-8");
    const expectedJson = readFileSync(resolve(goldenDir, `${week}-expected-output.json`), "utf-8");

    const vars = computeTransformVars(inputJson);
    const result = await scheduleJudge(expectedJson, { vars });

    const scores = result.namedScores ?? {};
    results.push({ week, pass: result.pass, scores });

    const dimStr = [
      `Operational=${((scores.judgeOperational ?? 0) * 4 + 1).toFixed(0)}/5`,
      `SoftRules=${((scores.judgeSoftRules ?? 0) * 4 + 1).toFixed(0)}/5`,
      `Fairness=${((scores.judgeFairness ?? 0) * 4 + 1).toFixed(0)}/5`,
    ].join(", ");

    const icon = result.pass ? "PASS" : "FAIL";
    console.log(`${icon}  ${week}: composite=${result.score?.toFixed(3)}  ${dimStr}`);
    console.log(`      ${result.reason?.substring(0, 300)}`);
    console.log();

    if (!result.pass) allPass = false;
  }

  // Summary
  const passed = results.filter((r) => r.pass).length;
  console.log(`--- Summary: ${passed}/${results.length} golden schedules passed ---`);

  if (!allPass) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
