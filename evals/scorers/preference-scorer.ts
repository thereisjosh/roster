/**
 * Preference extraction scorer — validates that extracted preferences
 * match expected preference types and rules.
 *
 * Scoring: matched_preferences / expected_preferences
 * A preference matches if:
 * - Same type (shift_time, coworker, hours, day_off)
 * - Rule field matches
 * - Rule operator matches
 * - Rule value contains expected keywords (case-insensitive)
 */

interface PreferenceRule {
  field: string;
  operator: string;
  value: string | number;
}

interface Preference {
  type: string;
  rule: PreferenceRule;
}

interface PreferenceOutput {
  preferences: Preference[];
}

function normalizeValue(value: string | number): string {
  return String(value).toLowerCase().trim();
}

function valueMatches(actual: string | number, expected: string | number): boolean {
  const actualStr = normalizeValue(actual);
  const expectedStr = normalizeValue(expected);

  // Exact match
  if (actualStr === expectedStr) return true;

  // Check if expected keywords appear in actual value
  const expectedKeywords = expectedStr.split(/[,_\s-]+/).filter(Boolean);
  return expectedKeywords.every((kw) => actualStr.includes(kw));
}

function preferenceMatches(actual: Preference, expected: Preference): boolean {
  if (actual.type !== expected.type) return false;
  if (!actual.rule || !expected.rule) return false;
  if (actual.rule.field !== expected.rule.field) return false;
  if (actual.rule.operator !== expected.rule.operator) return false;
  return valueMatches(actual.rule.value, expected.rule.value);
}

export default function preferenceScorer(output: string, context: { vars: { expected: string } }) {
  try {
    const parsed: PreferenceOutput = JSON.parse(output);
    const expected: PreferenceOutput = JSON.parse(context.vars.expected);

    if (!expected || !expected.preferences || expected.preferences.length === 0) {
      return { pass: false, score: 0, reason: "No expected preferences to compare" };
    }

    const actualPrefs = parsed.preferences ?? [];
    let matched = 0;
    const details: string[] = [];

    for (const exp of expected.preferences) {
      const found = actualPrefs.some((act) => preferenceMatches(act, exp));
      if (found) {
        matched++;
        details.push(`MATCH: ${exp.type}/${exp.rule.operator}/${exp.rule.value}`);
      } else {
        details.push(`MISS: ${exp.type}/${exp.rule.operator}/${exp.rule.value}`);
      }
    }

    const score = matched / expected.preferences.length;
    const pass = score >= 0.6;

    return {
      pass,
      score,
      reason: `${matched}/${expected.preferences.length} preferences matched. ${details.join("; ")}`,
    };
  } catch (e) {
    return {
      pass: false,
      score: 0,
      reason: `Failed to parse output: ${e instanceof Error ? e.message : "unknown error"}`,
    };
  }
}
