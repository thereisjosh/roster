/**
 * Prompt builder — uses the compressed slot-based prompt template
 * with pre-computed eligibility data for schedule generation.
 */

import type { ScheduleInput } from "./validator";
import type { PreferenceRuleRecord } from "./assembler";
import type { BusinessConfig } from "@/lib/db/schema";
import type { WikiContext } from "@/lib/knowledge/types";
import type { StaffRelationshipRecord } from "@/lib/relationships/query";
import type { StaffSkillRecord, ShiftCompositionRuleRecord } from "@/lib/skills/query";
import { computeEligibility } from "./compute-eligibility";

export type VariationType = "cost_optimised" | "fairness_optimised" | "balanced";

/**
 * SYSTEM_TEMPLATE — stable across all 3 variation calls.
 * Contains business config, eligibility data, and solving instructions.
 * Variable sections (variation_guidance, staffing_plan, etc.) are in USER_TEMPLATE.
 */
const SYSTEM_TEMPLATE = `You are a workforce scheduling AI for a shift-based business. Generate an optimal weekly schedule by assigning staff to hourly time slots.

SCHEDULING PARAMETERS:
{{scheduling_params}}

ADDITIONAL BUSINESS RULES:
{{business_rules}}

{{eligibility_guide}}

DATA FORMAT NOTES:
- The COVERAGE REQUIREMENTS list is pre-computed from availability data — trust it and ONLY assign from eligible lists
- Any assignment of a person to a slot NOT in their eligible list is an automatic failure
- Staff who appear in multiple consecutive slot-hours can be assigned across those slots freely

SOLVING STRATEGY:
1. Review the COVERAGE REQUIREMENTS above. Each line shows a slot-hour, the min/max staff needed, and who is eligible.
2. For each slot-hour, assign eligible staff. Output one slot entry per staff member per hour.
3. Start with the most constrained slot-hours (fewest eligible staff relative to minStaff).
3b. FULL-TIME TARGETS: For each FT staff member, the FULL-TIME STAFF section shows their per-day slot target (~N slots/day).
    Assign them as continuous blocks each day. On days with MORE eligible slots than the per-day target, TRIM from the start or end.
    FT PRIORITY ranges: assign all listed FT staff, but stagger start/end times so each person works ~N slots/day (not every slot).
    For example, if 2 FT chefs share a 9-slot range with target ~9, one works h11-h19 (9 slots) and the other h13-h19 (7 slots).
    Distribute total weekly hours evenly across eligible days — do NOT front-load weekdays and trim weekends.
    Do this BEFORE part-time staff.
4. Track each person's accumulated hours — do NOT exceed fullTimeHours.max for full-time staff.
5. After building the schedule, VERIFY every assignment: confirm the staffId appears in the eligible list for that time range.
6. VERIFY COVERAGE: Check every slot-hour. If assigned staff < minStaff AND eligible staff exist, this is a CRITICAL ERROR — add eligible staff until minStaff is met.

COVERAGE STRATEGY:
- When eligible staff = minStaff, assignment is forced — assign all of them
- When eligible < minStaff (infeasible), assign ALL eligible — partial > none
- When eligible > minStaff: FIRST assign staff to reach minStaff (mandatory). THEN apply optimization:
  * FT staff: assign to meet their per-day slot target (see FULL-TIME STAFF section)
  * Stay within maxStaff for each slot-hour
- FT PRIORITY slots: assign FT staff but respect their per-day slot target

HOURS GUIDANCE:
- HARD MAX is fullTimeHours.max net hours — if you exceed this, the schedule is invalid.
  Use the per-day target and Day breakdown (~N slots/day, varying by day) to distribute hours. Trim from days with the most eligible slots if over budget.

{{hours_tracking}}

{{date_mapping}}

{{constraint_tiers}}

OUTPUT FORMAT (JSON only, no explanation):
{
  "assignments": [
    {
      "staffId": "wilson",
      "role": "barista",
      "date": "YYYY-MM-DD",
      "hours": [11, 12, 13, 14]
    }
  ],
  "warnings": ["string"],
  "metadata": {
    "totalStaffHours": 0,
    "totalLaborCost": 0,
    "coveragePercent": 100
  }
}

Group consecutive hours into a single entry per staff member per role per day.`;

/**
 * USER_TEMPLATE — varies per variation call.
 * Contains optimization guidance, staffing plan, and fairness/coverage rules.
 */
const USER_TEMPLATE = `{{variation_guidance}}

STAFFING PLAN (pre-computed hour budgets):
{{staffing_plan}}

3c. {{fairness_check}}

COVERAGE (part-time):
- {{pt_coverage_rule}}

FT HOURS RULE:
- {{ft_hours_rule}}

{{soft_goals}}

Generate the schedule now. Respond with ONLY the JSON output, no markdown fences or explanation.`;

interface BuildPromptOptions {
  input: ScheduleInput;
  variationType: VariationType;
  preferenceRules: PreferenceRuleRecord[];
  weights: { costWeight: number; fairnessWeight: number; preferenceWeight: number };
  config?: BusinessConfig;
  retryViolations?: string[];
  wikiContext?: WikiContext;
  relationships?: StaffRelationshipRecord[];
  staffSkills?: StaffSkillRecord[];
  compositionRules?: ShiftCompositionRuleRecord[];
}

/**
 * Builds the system prompt — stable sections only (no variation-specific content).
 * Identical across all 3 variation calls, enabling prompt caching.
 */
export function buildSystemPrompt(options: {
  input: ScheduleInput;
  variationType: VariationType;
  preferenceRules: PreferenceRuleRecord[];
  config: BusinessConfig;
  wikiContext?: WikiContext;
  relationships?: StaffRelationshipRecord[];
  staffSkills?: StaffSkillRecord[];
  compositionRules?: ShiftCompositionRuleRecord[];
}): string {
  const { input, variationType, preferenceRules, config, wikiContext, relationships, staffSkills, compositionRules } = options;

  const vars = computeEligibility(input, config, preferenceRules, variationType, wikiContext, relationships, staffSkills, compositionRules);

  let prompt = SYSTEM_TEMPLATE;
  prompt = prompt.replace("{{scheduling_params}}", vars.scheduling_params);
  prompt = prompt.replace("{{business_rules}}", vars.business_rules);
  prompt = prompt.replace("{{eligibility_guide}}", vars.eligibility_guide);
  prompt = prompt.replace("{{hours_tracking}}", vars.hours_tracking);
  prompt = prompt.replace("{{date_mapping}}", vars.date_mapping);
  prompt = prompt.replace("{{constraint_tiers}}", vars.constraint_tiers);

  return prompt;
}

/**
 * Builds the user prompt — variation-specific sections + generate instruction.
 */
export function buildUserPrompt(options: BuildPromptOptions): string {
  const { input, variationType, preferenceRules, config, wikiContext, relationships, staffSkills, compositionRules } = options;

  const vars = computeEligibility(input, config!, preferenceRules, variationType, wikiContext, relationships, staffSkills, compositionRules);

  let prompt = USER_TEMPLATE;
  prompt = prompt.replace("{{variation_guidance}}", vars.variation_guidance);
  prompt = prompt.replace("{{staffing_plan}}", vars.staffing_plan);
  prompt = prompt.replace("{{fairness_check}}", vars.fairness_check);
  prompt = prompt.replace("{{pt_coverage_rule}}", vars.pt_coverage_rule);
  prompt = prompt.replace("{{ft_hours_rule}}", vars.ft_hours_rule);
  prompt = prompt.replace("{{soft_goals}}", vars.soft_goals);

  // Retry context — if previous attempt had violations
  if (options.retryViolations && options.retryViolations.length > 0) {
    prompt += "\n\nIMPORTANT: Your previous attempt had the following hard constraint violations. Fix them:";
    for (const v of options.retryViolations) {
      prompt += "\n- " + v;
    }
  }

  return prompt;
}
