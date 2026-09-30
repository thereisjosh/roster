/**
 * Preference ceiling scorer for promptfoo evals.
 *
 * Checks structural rule satisfaction and baseline quality metrics.
 * Used alongside slot-scorer.ts to measure how rule count affects schedule quality.
 *
 * Structural-hard rules are checked deterministically where possible.
 * Reports: structuralRulesSatisfied, ruleCount, baselineQualityDelta.
 */

interface Slot {
  slotId: string;
  staffId: string;
  date: string;
  hour: number;
  role?: string;
}

interface SlotOutput {
  slots: Slot[];
}

interface ScorerResult {
  pass: boolean;
  score: number;
  namedScores?: Record<string, number>;
  reason: string;
}

interface PreferenceRule {
  ruleType: "hard" | "soft" | "temporary";
  ruleText: string;
  confidence: number;
}

export default function preferenceCeilingScorer(
  output: string,
  context: { vars: { input?: string; ruleCount?: string } },
): ScorerResult {
  try {
    const schedule: SlotOutput = JSON.parse(output);

    if (!schedule.slots || schedule.slots.length === 0) {
      return { pass: false, score: 0, reason: "LLM output has no slots" };
    }

    const ruleCount = parseInt(context.vars.ruleCount || "0", 10);
    let inputData: any = null;
    if (context.vars.input) {
      try {
        inputData = JSON.parse(context.vars.input);
      } catch { /* ignore */ }
    }

    const preferenceRules: PreferenceRule[] = inputData?.preferenceRules ?? [];
    const hardRules = preferenceRules.filter((r) => r.ruleType === "hard");
    const softRules = preferenceRules.filter((r) => r.ruleType !== "hard");

    // --- Structural hard rule checks ---
    let hardSatisfied = 0;
    let hardChecked = 0;
    const violations: string[] = [];
    const violatedRuleIndices: number[] = [];

    // Group slots by staff+date for analysis
    const staffDateSlots = new Map<string, Map<string, number[]>>();
    for (const slot of schedule.slots) {
      const date = slot.date ?? slot.slotId.split("-").slice(0, 3).join("-");
      const hour = slot.hour ?? parseInt(slot.slotId.split("-").pop()!, 10);
      if (!staffDateSlots.has(slot.staffId)) {
        staffDateSlots.set(slot.staffId, new Map());
      }
      const dateMap = staffDateSlots.get(slot.staffId)!;
      if (!dateMap.has(date)) dateMap.set(date, []);
      dateMap.get(date)!.push(hour);
    }

    // Group slots by date+hour for co-scheduling checks
    const dateHourStaff = new Map<string, Set<string>>();
    const dateHourRoles = new Map<string, Map<string, string>>();
    for (const slot of schedule.slots) {
      const date = slot.date ?? slot.slotId.split("-").slice(0, 3).join("-");
      const hour = slot.hour ?? parseInt(slot.slotId.split("-").pop()!, 10);
      const key = `${date}::${hour}`;
      if (!dateHourStaff.has(key)) dateHourStaff.set(key, new Set());
      dateHourStaff.get(key)!.add(slot.staffId);
      if (!dateHourRoles.has(key)) dateHourRoles.set(key, new Map());
      dateHourRoles.get(key)!.set(slot.staffId, slot.role ?? "unknown");
    }

    // Check: max daily hours (sh-09: no more than 10h/day)
    for (let ri = 0; ri < hardRules.length; ri++) {
      const rule = hardRules[ri];
      const ruleIdx = preferenceRules.indexOf(rule);
      if (rule.ruleText.includes("more than 10 hours in a single day")) {
        hardChecked++;
        let passed = true;
        for (const [staffId, dateMap] of staffDateSlots) {
          for (const [date, hours] of dateMap) {
            if (hours.length > 10) {
              violations.push(`rule[${ruleIdx}]: ${staffId} has ${hours.length}h on ${date} (max 10)`);
              passed = false;
            }
          }
        }
        if (passed) hardSatisfied++;
        else violatedRuleIndices.push(ruleIdx);
      }
    }

    // Check: consecutive days (sh-02: no more than 6 consecutive)
    for (let ri = 0; ri < hardRules.length; ri++) {
      const rule = hardRules[ri];
      const ruleIdx = preferenceRules.indexOf(rule);
      if (rule.ruleText.includes("consecutive days")) {
        hardChecked++;
        let passed = true;
        for (const [staffId, dateMap] of staffDateSlots) {
          const dates = [...dateMap.keys()].sort();
          let consecutive = 1;
          for (let i = 1; i < dates.length; i++) {
            const prev = new Date(dates[i - 1] + "T00:00:00Z").getTime();
            const curr = new Date(dates[i] + "T00:00:00Z").getTime();
            if (curr - prev === 86400000) {
              consecutive++;
              if (consecutive > 6) {
                violations.push(`rule[${ruleIdx}]: ${staffId} has ${consecutive} consecutive days`);
                passed = false;
                break;
              }
            } else {
              consecutive = 1;
            }
          }
        }
        if (passed) hardSatisfied++;
        else violatedRuleIndices.push(ruleIdx);
      }
    }

    // Check: part-time max 25h (sh-07)
    for (let ri = 0; ri < hardRules.length; ri++) {
      const rule = hardRules[ri];
      const ruleIdx = preferenceRules.indexOf(rule);
      if (rule.ruleText.includes("Part-time") && rule.ruleText.includes("25 hours")) {
        hardChecked++;
        let passed = true;
        if (inputData?.staff) {
          const ptStaff = inputData.staff.filter((s: any) => s.employmentType === "part-time");
          for (const s of ptStaff) {
            const dateMap = staffDateSlots.get(s.id);
            if (!dateMap) continue;
            let total = 0;
            dateMap.forEach((hours) => { total += hours.length; });
            if (total > 25) {
              violations.push(`rule[${ruleIdx}]: ${s.id}: part-time with ${total}h (max 25)`);
              passed = false;
            }
          }
        }
        if (passed) hardSatisfied++;
        else violatedRuleIndices.push(ruleIdx);
      }
    }

    const structuralScore = hardChecked > 0 ? hardSatisfied / hardChecked : 1.0;

    // Basic quality: total slots scheduled, unique staff used
    const totalSlots = schedule.slots.length;
    const uniqueStaff = new Set(schedule.slots.map((s) => s.staffId)).size;
    const totalStaff = inputData?.staff?.length ?? 0;
    const staffUtilization = totalStaff > 0 ? uniqueStaff / totalStaff : 0;

    // Pass if structural rules mostly satisfied and schedule isn't empty
    const pass = structuralScore >= 0.8 && totalSlots > 0;

    return {
      pass,
      score: structuralScore,
      namedScores: {
        structuralRulesSatisfied: structuralScore,
        hardRulesChecked: hardChecked,
        hardRulesPassed: hardSatisfied,
        totalRulesInjected: ruleCount,
        totalHardRules: hardRules.length,
        totalSoftRules: softRules.length,
        slotsScheduled: totalSlots,
        staffUtilization,
        violatedRuleCount: violatedRuleIndices.length,
      },
      reason: `Ceiling eval (${ruleCount} rules): structural=${structuralScore.toFixed(2)} (${hardSatisfied}/${hardChecked} hard rules), ${totalSlots} slots, ${uniqueStaff}/${totalStaff} staff used${violatedRuleIndices.length > 0 ? ` | violatedRuleIndices: [${violatedRuleIndices.join(",")}]` : ""}${violations.length > 0 ? " | VIOLATIONS: " + violations.slice(0, 5).join("; ") : ""}`,
    };
  } catch (e) {
    return {
      pass: false,
      score: 0,
      reason: `Failed to score: ${e instanceof Error ? e.message : "unknown error"}`,
    };
  }
}
