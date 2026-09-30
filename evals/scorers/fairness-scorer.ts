// Scores fairness: what % of available staff got assigned, and how evenly are hours distributed
export default function fairnessScorer(output: any, context: any) {
  const input = JSON.parse(context.vars.input);
  const staff = input.staff || [];
  const available = staff.filter((s: any) => s.availability && s.availability.length > 0);

  // Output is in slot format after transform: { slots: [{staffId, hour, role, date}, ...] }
  const parsed = typeof output === 'string' ? JSON.parse(output) : output;
  const slots = parsed.slots || [];

  const assigned = new Set(slots.map((s: any) => s.staffId));

  // Guard: degenerate case
  if (available.length === 0) {
    return { pass: false, score: 0, reason: "No staff with availability found in input" };
  }

  const coverageRate = available.filter((s: any) => assigned.has(s.id)).length / available.length;

  // Hours distribution: count slot assignments per available staff member
  const hoursPerStaff = available.map((s: any) =>
    slots.filter((sl: any) => sl.staffId === s.id).length
  );

  // All-staff CV (reported for visibility)
  const mean = hoursPerStaff.length > 0
    ? hoursPerStaff.reduce((a: number, b: number) => a + b, 0) / hoursPerStaff.length
    : 0;
  const stdDev = hoursPerStaff.length > 0
    ? Math.sqrt(hoursPerStaff.reduce((sum: number, h: number) => sum + Math.pow(h - mean, 2), 0) / hoursPerStaff.length)
    : 0;
  const allStaffCV = mean > 0 ? stdDev / mean : 0;

  // PT-only CV (used for pass/fail — FT hours are contract-driven)
  const ptAvailable = available.filter((s: any) => s.employmentType !== 'full-time');
  const ptHours = ptAvailable.map((s: any) =>
    slots.filter((sl: any) => sl.staffId === s.id).length
  );
  const ptMean = ptHours.length > 0 ? ptHours.reduce((a: number, b: number) => a + b, 0) / ptHours.length : 0;
  const ptStdDev = ptHours.length > 0
    ? Math.sqrt(ptHours.reduce((sum: number, h: number) => sum + Math.pow(h - ptMean, 2), 0) / ptHours.length)
    : 0;
  const ptCV = ptMean > 0 ? ptStdDev / ptMean : 0;

  // Min PT shift hours: smallest assignment for any assigned PT staff
  const assignedPtHours = ptHours.filter((h: number) => h > 0);
  const minPtShiftHours = assignedPtHours.length > 0 ? Math.min(...assignedPtHours) : 0;

  // Variation-aware thresholds
  const variationType = context.vars.variationType || 'balanced';

  let pass: boolean;
  let coverageThreshold: number;
  let ptCVThreshold: number;

  if (variationType === 'cost_optimised') {
    // No fairness pass criteria for cost — always pass, metrics logged for tradeoff visibility
    pass = true;
    coverageThreshold = 0;
    ptCVThreshold = Infinity;
  } else if (variationType === 'fairness_optimised') {
    coverageThreshold = 0.95;
    ptCVThreshold = 0.8;
    pass = coverageRate >= coverageThreshold && ptCV <= ptCVThreshold;
  } else { // balanced
    coverageThreshold = 0.85;
    ptCVThreshold = 1.0;
    pass = coverageRate >= coverageThreshold && ptCV <= ptCVThreshold;
  }

  return {
    pass,
    score: coverageRate,
    reason: `coverageRate=${coverageRate.toFixed(3)}, ptCV=${ptCV.toFixed(3)}, allStaffCV=${allStaffCV.toFixed(3)}, minPtShift=${minPtShiftHours}h (threshold: cov>=${coverageThreshold}, ptCV<=${ptCVThreshold})`,
    componentResults: [
      { pass: coverageRate >= coverageThreshold, score: coverageRate, reason: `Staff coverage: ${(coverageRate * 100).toFixed(1)}%` },
      { pass: ptCV <= ptCVThreshold, score: Math.max(0, 1 - ptCV), reason: `PT hours CV: ${ptCV.toFixed(3)} (lower=fairer)` },
    ],
  };
}
