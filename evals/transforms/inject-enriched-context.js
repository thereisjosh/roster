/**
 * Transform that injects enriched context (composition rules, staff skills)
 * from enriched-context.json into the golden data before passing to
 * compute-eligibility.
 *
 * - Removes preference rules listed in removePreferenceRules (by ruleText match)
 * - Appends conditional composition rules with trigger/satisfy staff lists
 */

const fs = require('fs');
const path = require('path');
const computeEligibility = require('./compute-eligibility');

const ENRICHED_PATH = path.resolve(__dirname, '../golden/schedules/enriched-context.json');
let cachedEnriched = null;

function loadEnriched() {
  if (!cachedEnriched) {
    const raw = fs.readFileSync(ENRICHED_PATH, 'utf-8');
    cachedEnriched = JSON.parse(raw);
  }
  return cachedEnriched;
}

module.exports = function (vars) {
  const enriched = loadEnriched();

  // Parse input data
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

  // Remove specified preference rules
  if (enriched.removePreferenceRules && data.preferenceRules) {
    const removeSet = new Set(enriched.removePreferenceRules);
    data.preferenceRules = data.preferenceRules.filter(function (r) {
      return !removeSet.has(r.ruleText);
    });
  }

  // Pass modified data through base transform
  const modifiedVars = Object.assign({}, vars, { input: JSON.stringify(data) });
  const result = computeEligibility(modifiedVars);

  // Append enriched context sections to soft_goals
  const extraSections = [];

  // Composition rules with conditional trigger info
  if (enriched.compositionRules && enriched.compositionRules.length > 0) {
    // Build tag → staff lookup from staffSkills
    const byTag = {};
    if (enriched.staffSkills) {
      for (const sk of enriched.staffSkills) {
        if (!byTag[sk.tag]) byTag[sk.tag] = [];
        byTag[sk.tag].push(sk.staffId);
      }
    }

    extraSections.push('');
    extraSections.push('SHIFT COMPOSITION RULES:');
    for (const rule of enriched.compositionRules) {
      const reqLabel = rule.required ? 'REQUIRED' : 'PREFERRED';

      if (rule.condition && rule.condition.whenTagPresent) {
        const triggerTag = rule.condition.whenTagPresent;
        const triggerMin = rule.condition.whenMinCount || 1;
        const triggerStaff = byTag[triggerTag] || [];
        const satisfyStaff = byTag[rule.tag] || [];

        extraSections.push(reqLabel + ' — ' + rule.shiftType + ' shifts (min ' + rule.minimumCount + ' ' + rule.tag + '):');
        extraSections.push('  Triggers when: ≥' + triggerMin + ' ' + triggerTag + ' staff assigned → ' + triggerStaff.join(', '));
        extraSections.push('  Satisfied by: ' + satisfyStaff.join(', '));
        extraSections.push('  Note: all-' + rule.tag + ' shifts have no supervision requirement');
        extraSections.push('  (' + rule.sourceUtterance + ')');
      } else {
        const staffWithTag = byTag[rule.tag] || [];
        extraSections.push('- [' + reqLabel + '] ' + rule.shiftType + ' shifts: at least ' + rule.minimumCount + ' staff with tag "' + rule.tag + '" (' + rule.sourceUtterance + ')');
        if (staffWithTag.length > 0) {
          extraSections.push('  Staff with "' + rule.tag + '": [' + staffWithTag.join(', ') + ']');
        }
      }
    }
  }

  if (extraSections.length > 0) {
    result.soft_goals = (result.soft_goals || '') + '\n' + extraSections.join('\n');
  }

  return result;
};
