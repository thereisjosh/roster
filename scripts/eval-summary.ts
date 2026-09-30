/**
 * Eval summary reporter — reads all evals/results/*.json files and prints
 * a unified human-readable cost / score / token / latency table to stdout.
 *
 * Usage:
 *   npx tsx scripts/eval-summary.ts
 *   npm run eval:report
 */

import { readFileSync, readdirSync } from "fs";
import { resolve, join } from "path";

// --- Types (only the fields we care about) ---

interface TokenUsage {
  total: number;
  prompt: number;
  completion: number;
}

interface ResultEntry {
  cost: number;
  latencyMs: number;
  score: number;
  namedScores: Record<string, number>;
  success: boolean;
  provider: { id: string; label: string };
  testCase: { description: string };
  response?: { tokenUsage?: TokenUsage; error?: string };
}

interface PromptMetrics {
  cost: number;
  totalLatencyMs: number;
  tokenUsage: TokenUsage & { numRequests: number };
  score: number;
}

interface PromptEntry {
  provider: string;
  label: string;
  metrics: PromptMetrics;
}

interface EvalFile {
  evalId: string;
  results: {
    timestamp: string;
    prompts: PromptEntry[];
    results: ResultEntry[];
  };
}

// --- Helpers ---

function fmt(n: number, decimals = 0): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtCost(n: number): string {
  return `$${n.toFixed(4)}`;
}

function fmtLatency(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function pad(s: string, len: number, align: "left" | "right" = "left"): string {
  if (align === "right") return s.padStart(len);
  return s.padEnd(len);
}

// --- Load all result files ---

const resultsDir = resolve(__dirname, "../evals/results");

let files: string[];
try {
  files = readdirSync(resultsDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => join(resultsDir, f));
} catch {
  console.error(`Could not read ${resultsDir}`);
  console.error("Run 'npm run eval' first to generate results.");
  process.exit(1);
}

if (files.length === 0) {
  console.error("No result files found in evals/results/");
  console.error("Run 'npm run eval' first to generate results.");
  process.exit(1);
}

// Merge all results and prompts from all files
const allResults: ResultEntry[] = [];
const allPrompts: PromptEntry[] = [];
let latestTimestamp = "";
let latestEvalId = "";

for (const filePath of files) {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    console.error(`Warning: Could not read ${filePath}, skipping.`);
    continue;
  }

  const data: EvalFile = JSON.parse(raw);
  allResults.push(...data.results.results);
  allPrompts.push(...data.results.prompts);

  if (data.results.timestamp > latestTimestamp) {
    latestTimestamp = data.results.timestamp;
    latestEvalId = data.evalId;
  }
}

if (allResults.length === 0) {
  console.error("No results found in any result files.");
  process.exit(1);
}

// Build row data from individual results
interface Row {
  test: string;
  provider: string;
  score: string;
  tokens: string;
  cost: string;
  latency: string;
  _tokens: number;
  _cost: number;
  _latencyMs: number;
  _score: number;
}

const rows: Row[] = allResults.map((r) => {
  const tokens = r.response?.tokenUsage?.total ?? 0;
  return {
    test: r.testCase.description,
    provider: r.provider.label,
    score: r.score > 0 ? r.score.toFixed(2) : r.success ? "0.00" : "ERR",
    tokens: tokens > 0 ? fmt(tokens) : "-",
    cost: r.cost > 0 ? fmtCost(r.cost) : "-",
    latency: r.latencyMs > 0 ? fmtLatency(r.latencyMs) : "-",
    _tokens: tokens,
    _cost: r.cost,
    _latencyMs: r.latencyMs,
    _score: r.score,
  };
});

// If no per-result cost/token data, fall back to per-provider aggregate from prompts
const hasPerResultCost = rows.some((r) => r._cost > 0);
const hasPerResultTokens = rows.some((r) => r._tokens > 0);

if (!hasPerResultCost || !hasPerResultTokens) {
  // Show aggregate per-provider summary instead
  console.log("\n  Eval Summary (per-provider aggregates)\n");
  console.log(`  Run: ${latestEvalId}  •  ${latestTimestamp}  •  ${files.length} task configs\n`);

  // Deduplicate providers (multiple prompts can share a provider)
  const byProvider = new Map<
    string,
    { score: number; tokens: number; cost: number; latencyMs: number; requests: number; count: number }
  >();
  for (const p of allPrompts) {
    const label = p.provider ?? p.label;
    const existing = byProvider.get(label) ?? { score: 0, tokens: 0, cost: 0, latencyMs: 0, requests: 0, count: 0 };
    existing.score += p.metrics.score;
    existing.tokens += p.metrics.tokenUsage.total;
    existing.cost += p.metrics.cost;
    existing.latencyMs += p.metrics.totalLatencyMs;
    existing.requests += p.metrics.tokenUsage.numRequests;
    existing.count += 1;
    byProvider.set(label, existing);
  }

  const cols = { provider: 20, score: 7, tokens: 10, cost: 10, latency: 10, requests: 5 };

  const hdr = [
    pad("Provider", cols.provider),
    pad("Score", cols.score, "right"),
    pad("Tokens", cols.tokens, "right"),
    pad("Cost", cols.cost, "right"),
    pad("Latency", cols.latency, "right"),
    pad("Reqs", cols.requests, "right"),
  ];
  const sep = hdr.map((h) => "─".repeat(h.length));

  console.log(`  ┌─${sep.join("─┬─")}─┐`);
  console.log(`  │ ${hdr.join(" │ ")} │`);
  console.log(`  ├─${sep.join("─┼─")}─┤`);

  let totalTokens = 0;
  let totalCost = 0;
  let totalLatency = 0;
  let totalRequests = 0;

  for (const [label, agg] of byProvider) {
    const avgScore = agg.count > 0 ? agg.score / agg.count : 0;
    const row = [
      pad(label.slice(0, cols.provider), cols.provider),
      pad(avgScore > 0 ? avgScore.toFixed(2) : "-", cols.score, "right"),
      pad(agg.tokens > 0 ? fmt(agg.tokens) : "-", cols.tokens, "right"),
      pad(agg.cost > 0 ? fmtCost(agg.cost) : "-", cols.cost, "right"),
      pad(agg.latencyMs > 0 ? fmtLatency(agg.latencyMs) : "-", cols.latency, "right"),
      pad(String(agg.requests), cols.requests, "right"),
    ];
    console.log(`  │ ${row.join(" │ ")} │`);
    totalTokens += agg.tokens;
    totalCost += agg.cost;
    totalLatency += agg.latencyMs;
    totalRequests += agg.requests;
  }

  console.log(`  ├─${sep.join("─┼─")}─┤`);
  const totals = [
    pad("TOTAL", cols.provider),
    pad("", cols.score, "right"),
    pad(totalTokens > 0 ? fmt(totalTokens) : "-", cols.tokens, "right"),
    pad(totalCost > 0 ? fmtCost(totalCost) : "-", cols.cost, "right"),
    pad(totalLatency > 0 ? fmtLatency(totalLatency) : "-", cols.latency, "right"),
    pad(String(totalRequests), cols.requests, "right"),
  ];
  console.log(`  │ ${totals.join(" │ ")} │`);
  console.log(`  └─${sep.join("─┴─")}─┘`);
  console.log();

  process.exit(0);
}

// Full per-result table
console.log("\n  Eval Summary\n");
console.log(`  Run: ${latestEvalId}  •  ${latestTimestamp}  •  ${files.length} task configs\n`);

const cols = { test: 26, provider: 16, score: 7, tokens: 10, cost: 10, latency: 10 };

// Truncate long test names
for (const r of rows) {
  if (r.test.length > cols.test) r.test = r.test.slice(0, cols.test - 1) + "…";
}

const hdr = [
  pad("Test", cols.test),
  pad("Provider", cols.provider),
  pad("Score", cols.score, "right"),
  pad("Tokens", cols.tokens, "right"),
  pad("Cost", cols.cost, "right"),
  pad("Latency", cols.latency, "right"),
];
const sep = hdr.map((h) => "─".repeat(h.length));

console.log(`  ┌─${sep.join("─┬─")}─┐`);
console.log(`  │ ${hdr.join(" │ ")} │`);
console.log(`  ├─${sep.join("─┼─")}─┤`);

let totalTokens = 0;
let totalCost = 0;
let totalLatency = 0;
let scoreSum = 0;
let scoreCount = 0;

for (const r of rows) {
  const row = [
    pad(r.test, cols.test),
    pad(r.provider, cols.provider),
    pad(r.score, cols.score, "right"),
    pad(r.tokens, cols.tokens, "right"),
    pad(r.cost, cols.cost, "right"),
    pad(r.latency, cols.latency, "right"),
  ];
  console.log(`  │ ${row.join(" │ ")} │`);
  totalTokens += r._tokens;
  totalCost += r._cost;
  totalLatency += r._latencyMs;
  if (r._score > 0) {
    scoreSum += r._score;
    scoreCount++;
  }
}

console.log(`  ├─${sep.join("─┼─")}─┤`);
const avgScore = scoreCount > 0 ? (scoreSum / scoreCount).toFixed(2) : "-";
const totals = [
  pad("TOTAL", cols.test),
  pad("", cols.provider),
  pad(avgScore, cols.score, "right"),
  pad(totalTokens > 0 ? fmt(totalTokens) : "-", cols.tokens, "right"),
  pad(totalCost > 0 ? fmtCost(totalCost) : "-", cols.cost, "right"),
  pad(totalLatency > 0 ? fmtLatency(totalLatency) : "-", cols.latency, "right"),
];
console.log(`  │ ${totals.join(" │ ")} │`);
console.log(`  └─${sep.join("─┴─")}─┘`);
console.log();
