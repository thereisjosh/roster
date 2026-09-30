/**
 * Transform wrapper that injects N preference rules from the ceiling rules file
 * into the golden data before passing to compute-eligibility-compressed.
 *
 * Reads `ruleCount` from vars (default: 0). Slices the first N rules from
 * preference-ceiling-rules.json and merges them into data.preferenceRules.
 */

const fs = require('fs');
const path = require('path');
const computeEligibility = require('./compute-eligibility-compressed');

const CEILING_RULES_PATH = path.resolve(__dirname, '../golden/preference-ceiling-rules.json');
let cachedRules = null;

function loadCeilingRules() {
  if (!cachedRules) {
    const raw = fs.readFileSync(CEILING_RULES_PATH, 'utf-8');
    cachedRules = JSON.parse(raw).rules;
  }
  return cachedRules;
}

module.exports = function (vars) {
  const ruleCount = parseInt(vars.ruleCount || '0', 10);

  if (ruleCount > 0) {
    // Parse the input data, inject rules, then re-serialize
    let raw;
    if (typeof vars.input === 'string' && vars.input.startsWith('file://')) {
      const evalsDir = path.resolve(process.cwd(), 'evals');
      const filePath = path.resolve(evalsDir, vars.input.slice('file://'.length));
      raw = fs.readFileSync(filePath, 'utf-8');
    } else if (typeof vars.input === 'string') {
      raw = vars.input;
    } else {
      raw = JSON.stringify(vars.input);
    }

    const data = JSON.parse(raw);
    const allRules = loadCeilingRules();
    const injectedRules = allRules.slice(0, ruleCount).map(function (r) {
      return {
        ruleType: r.ruleType,
        ruleText: r.ruleText,
        confidence: r.confidence,
      };
    });

    // Merge: existing rules + injected rules (avoiding duplicates by ruleText)
    const existing = data.preferenceRules || [];
    const existingTexts = new Set(existing.map(function (r) { return r.ruleText; }));
    for (const rule of injectedRules) {
      if (!existingTexts.has(rule.ruleText)) {
        existing.push(rule);
      }
    }
    data.preferenceRules = existing;

    // Pass modified data as stringified input
    const modifiedVars = Object.assign({}, vars, { input: JSON.stringify(data) });
    return computeEligibility(modifiedVars);
  }

  // No injection — pass through to base transform
  return computeEligibility(vars);
};
