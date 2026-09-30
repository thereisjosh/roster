/**
 * LLM-as-judge scorer for promptfoo evals.
 *
 * Uses GPT-4.1-mini to evaluate qualitative dimensions that deterministic
 * scorers can't measure:
 *   1. Operational Reasonableness — would a manager accept this schedule?
 *   2. Soft Rule Adherence — are PREFER rules followed where possible?
 *   3. Fairness Patterns — beyond Gini, are shifts distributed fairly?
 *
 * Hard constraints (qualifications, availability, rest, hours, coverage) are
 * checked by schedule-scorer.ts. This judge does NOT re-verify them.
 *
 * Model: GPT-4.1-mini (~$0.003/judgment) — different provider from eval
 * subjects (Gemini, Claude) to avoid self-bias.
 */

import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

let _openai: ReturnType<typeof createOpenAI> | null = null;
function getOpenAI() {
  if (!_openai) {
    _openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY ?? "" });
  }
  return _openai;
}

const SYSTEM_PROMPT = `You are an expert restaurant scheduling evaluator. You assess schedule quality on THREE qualitative dimensions that automated checks cannot measure.

CRITICAL INSTRUCTIONS — read carefully before scoring:

1. Hard constraints (staff qualifications, availability, rest periods, weekly hours, shift coverage) are verified by a SEPARATE deterministic scorer. Do NOT re-verify these. ASSUME the schedule passed all hard constraint checks.

2. Many shifts are FORCED (exactly enough eligible staff) or INFEASIBLE (fewer eligible than needed). Do NOT penalize the scheduler for these — it had no choice. Focus your evaluation on shifts where the scheduler HAD choices.

3. Staffing ABOVE minStaff is GOOD, not a problem. minStaff is a floor, not a ceiling.

4. L1 staff working without L2 supervision is TOLERATED — managers accept this as a judgment call when L2 staff are unavailable.

5. Full-time staff hours between their target (maxWeeklyHours) and the hard max (fullTimeHours.max) is NORMAL, not a violation.

6. Score each dimension independently on a 1-5 scale. Be generous when constraints leave the scheduler with few choices.

DIMENSION 1: Operational Reasonableness (1-5)
Would a real manager accept this schedule? Consider the overall pattern, not just individual constraints.
- 5: Staffs above minimums where possible, full-time staff near hour targets, all available staff get shifts, edge cases handled sensibly
- 4: Good overall pattern with minor missed opportunities
- 3: Meets minimums but leaves available staff idle or under-utilizes full-time staff
- 2: Noticeable gaps — feasible shifts understaffed, available staff forgotten
- 1: Bizarre patterns, available staff completely ignored, feasible shifts understaffed for no reason

DIMENSION 2: Soft Rule Adherence (1-5)
Are the PREFER rules followed where the scheduler had a choice?
- 5: Peak periods have extra staff, chef hours within kitchen windows, pairing rules attempted on flexible shifts
- 4: Most soft rules followed, minor misses
- 3: Some soft rules followed, others ignored despite having options
- 2: Soft rules mostly ignored
- 1: Soft rules systematically ignored

DIMENSION 3: Fairness Patterns (1-5)
Beyond total hours — are shifts distributed fairly across staff who had choices?
- 5: Weekend/long shifts shared across multiple staff, all available staff get work, no systematic exclusion
- 4: Mostly fair with minor imbalance
- 3: Some imbalance but not extreme
- 2: Notable concentration — some staff overloaded while others with availability sit idle
- 1: Severe concentration — one person gets all undesirable shifts while others with availability get none

Respond with ONLY a JSON object in this exact format:
{
  "operational_reasonableness": { "score": <1-5>, "reasoning": "<1-2 sentences>" },
  "soft_rule_adherence": { "score": <1-5>, "reasoning": "<1-2 sentences>" },
  "fairness_patterns": { "score": <1-5>, "reasoning": "<1-2 sentences>" }
}`;

function buildUserPrompt(
  scheduleOutput: string,
  vars: Record<string, string>,
): string {
  const parts: string[] = [];

  if (vars.business_rules) {
    parts.push("## Business Rules (MUST/PREFER)");
    parts.push(vars.business_rules);
    parts.push("");
  }

  if (vars.scheduling_params) {
    parts.push("## Scheduling Parameters");
    parts.push(vars.scheduling_params);
    parts.push("");
  }

  if (vars.staffing_plan) {
    parts.push("## Staffing Plan (hour budgets + pre-solved assignments)");
    parts.push(vars.staffing_plan);
    parts.push("");
  }

  parts.push("## Schedule Output (to evaluate)");
  parts.push(scheduleOutput);

  return parts.join("\n");
}

interface JudgeDimension {
  score: number;
  reasoning: string;
}

interface JudgeResponse {
  operational_reasonableness: JudgeDimension;
  soft_rule_adherence: JudgeDimension;
  fairness_patterns: JudgeDimension;
}

interface ScorerResult {
  pass: boolean;
  score: number;
  namedScores?: Record<string, number>;
  reason: string;
}

export default async function scheduleJudge(
  output: string,
  context: { vars: Record<string, string> },
): Promise<ScorerResult> {
  // Fail fast if output isn't valid JSON (is-json assertion handles this, but be safe)
  try {
    JSON.parse(output);
  } catch {
    return {
      pass: false,
      score: 0,
      reason: "Judge skipped: schedule output is not valid JSON",
    };
  }

  const userPrompt = buildUserPrompt(output, context.vars);

  let responseText: string;
  try {
    const result = await generateText({
      model: getOpenAI()("gpt-4.1-mini"),
      system: SYSTEM_PROMPT,
      prompt: userPrompt,
      temperature: 0,
      maxTokens: 1024,
    });
    responseText = result.text;
  } catch (e) {
    return {
      pass: false,
      score: 0,
      reason: `Judge LLM call failed: ${e instanceof Error ? e.message : "unknown error"}`,
    };
  }

  // Parse JSON from response — handle markdown fences
  let parsed: JudgeResponse;
  try {
    const cleaned = responseText
      .replace(/^```(?:json)?\s*\n?/gm, "")
      .replace(/\n?\s*```\s*$/gm, "")
      .trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return {
      pass: false,
      score: 0,
      reason: `Judge returned invalid JSON: ${responseText.substring(0, 200)}`,
    };
  }

  // Validate scores are in range
  const dims = [
    { key: "operational_reasonableness" as const, label: "Operational" },
    { key: "soft_rule_adherence" as const, label: "SoftRules" },
    { key: "fairness_patterns" as const, label: "Fairness" },
  ];

  for (const dim of dims) {
    const d = parsed[dim.key];
    if (!d || typeof d.score !== "number" || d.score < 1 || d.score > 5) {
      return {
        pass: false,
        score: 0,
        reason: `Judge returned invalid score for ${dim.key}: ${JSON.stringify(d)}`,
      };
    }
  }

  // Normalize 1-5 → 0-1
  const judgeOperational = (parsed.operational_reasonableness.score - 1) / 4;
  const judgeSoftRules = (parsed.soft_rule_adherence.score - 1) / 4;
  const judgeFairness = (parsed.fairness_patterns.score - 1) / 4;

  const composite = (judgeOperational + judgeSoftRules + judgeFairness) / 3;
  const pass = composite >= 0.50;

  const reasonParts = dims.map((dim) => {
    const d = parsed[dim.key];
    return `${dim.label}=${d.score}/5 "${d.reasoning}"`;
  });

  return {
    pass,
    score: composite,
    namedScores: {
      judgeOperational,
      judgeSoftRules,
      judgeFairness,
    },
    reason: `Judge: ${composite.toFixed(3)} (${reasonParts.join(" | ")})`,
  };
}
