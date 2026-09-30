/**
 * Custom promptfoo provider that chains two LLM agents with a deterministic
 * validator in between:
 *
 *   Agent 1 (constraint solver) → Validator → Agent 2 (schedule generator)
 *
 * Uses Vercel AI SDK (@ai-sdk/google, @ai-sdk/anthropic) for LLM calls.
 */

import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import { validate } from "./validator";
import type { Agent1Output } from "./validator";
import * as fs from "fs";
import * as path from "path";

// --- Provider singletons ---

let _google: ReturnType<typeof createGoogleGenerativeAI> | null = null;
function getGoogle() {
  if (!_google) {
    _google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_API_KEY ?? "" });
  }
  return _google;
}

let _anthropic: ReturnType<typeof createAnthropic> | null = null;
function getAnthropic() {
  if (!_anthropic) {
    _anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });
  }
  return _anthropic;
}

// --- LLM helper ---

function getModel(modelId: string) {
  if (modelId.startsWith("gemini")) {
    return getGoogle()(modelId);
  } else if (modelId.startsWith("claude")) {
    return getAnthropic()(modelId);
  }
  throw new Error(`Unsupported model: ${modelId}`);
}

async function callLLM(
  modelId: string,
  prompt: string,
  temperature: number = 0,
): Promise<string> {
  const result = await generateText({
    model: getModel(modelId),
    prompt,
    temperature,
    ...(modelId.startsWith("claude") ? { maxTokens: 16384 } : {}),
  });
  return result.text;
}

// --- JSON extraction (same regex as existing eval transform) ---

function extractJSON(raw: string): string {
  const s = raw
    .replace(/^```(?:json)?\s*\n?/gm, "")
    .replace(/\n?\s*```\s*$/gm, "")
    .trim();
  const i = s.indexOf("{");
  const j = s.lastIndexOf("}");
  return i !== -1 && j > i ? s.substring(i, j + 1) : s;
}

// --- Load prompts ---

const PROMPTS_DIR = path.resolve(process.cwd(), "evals", "prompts");

function loadPrompt(filename: string): string {
  return fs.readFileSync(path.join(PROMPTS_DIR, filename), "utf-8");
}

// --- Resolve input (handle file:// references like compute-eligibility.js) ---

function resolveInput(input: string): string {
  if (typeof input === "string" && input.startsWith("file://")) {
    const evalsDir = path.resolve(process.cwd(), "evals");
    const filePath = path.resolve(evalsDir, input.slice("file://".length));
    return fs.readFileSync(filePath, "utf-8");
  }
  return input;
}

// --- Provider class ---

interface TwoAgentProviderConfig {
  agent1Model: string;
  agent2Model: string;
  temperature?: number;
}

class TwoAgentProvider {
  private config: TwoAgentProviderConfig;
  private providerId: string;

  constructor(options: { id?: string; config?: TwoAgentProviderConfig }) {
    this.config = options.config ?? { agent1Model: "gemini-2.5-pro", agent2Model: "gemini-2.5-pro" };
    this.providerId = options.id ?? `two-agent:${this.config.agent1Model}+${this.config.agent2Model}`;
  }

  id() {
    return this.providerId;
  }

  async callApi(prompt: string, context?: { vars?: Record<string, string> }) {
    const temperature = this.config.temperature ?? 0;

    // Get raw input from context vars
    const rawInput = resolveInput(context?.vars?.input ?? "");
    const inputData = JSON.parse(rawInput);

    // --- Agent 1: Constraint Solver ---
    const agent1Prompt = loadPrompt("agent1-constraint-solver.txt").replace("{{input}}", rawInput);

    let agent1RawText: string;
    try {
      agent1RawText = await callLLM(this.config.agent1Model, agent1Prompt, temperature);
    } catch (e) {
      return {
        output: JSON.stringify({ error: `Agent 1 failed: ${e instanceof Error ? e.message : "unknown"}` }),
        metadata: { agent1Error: true },
      };
    }

    // Parse Agent 1 output
    let agent1Output: Agent1Output;
    try {
      agent1Output = JSON.parse(extractJSON(agent1RawText));
    } catch (e) {
      return {
        output: JSON.stringify({ error: `Agent 1 returned invalid JSON` }),
        metadata: { agent1Raw: agent1RawText.substring(0, 2000), agent1ParseError: true },
      };
    }

    // --- Validator ---
    const validationResult = validate(agent1Output, inputData);

    // --- Agent 2: Schedule Generator ---
    const agent2PromptTemplate = loadPrompt("agent2-schedule-generator.txt");
    const planningDoc = JSON.stringify(validationResult.correctedOutput, null, 2);
    const agent2Prompt = agent2PromptTemplate
      .replace("{{planning_doc}}", planningDoc)
      .replace("{{input}}", rawInput);

    let agent2RawText: string;
    try {
      agent2RawText = await callLLM(this.config.agent2Model, agent2Prompt, temperature);
    } catch (e) {
      return {
        output: JSON.stringify({ error: `Agent 2 failed: ${e instanceof Error ? e.message : "unknown"}` }),
        metadata: {
          agent1Raw: agent1RawText.substring(0, 2000),
          validationResult: { valid: validationResult.valid, correctionCount: validationResult.corrections.length },
          agent2Error: true,
        },
      };
    }

    const scheduleJSON = extractJSON(agent2RawText);

    return {
      output: scheduleJSON,
      metadata: {
        agent1Raw: agent1RawText.substring(0, 2000),
        validationResult: {
          valid: validationResult.valid,
          correctionCount: validationResult.corrections.length,
          corrections: validationResult.corrections,
        },
      },
    };
  }
}

// --- Promptfoo module export ---
// promptfoo calls the default export as a constructor or factory

export default TwoAgentProvider;
