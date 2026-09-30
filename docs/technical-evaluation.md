# Technical Evaluation — Roster

**Audience:** Tech lead / engineering due diligence
**Date:** May 2026
**Codebase snapshot:** Pre-launch, single-developer build

---

## 1. System Overview

Roster is an AI-powered staff scheduling platform for shift-based SMBs (F&B, retail, healthcare). Staff submit availability and handle shift swaps via natural language messages on WhatsApp, Telegram, or SMS — including Singlish and shorthand. The system generates optimised weekly schedules in three variations (cost, fairness, balanced), validates constraints, and learns scheduling preferences from manager edits. Managers interact through a Next.js dashboard.

---

## 2. Architecture

**Stack:** Next.js 15 (App Router) · tRPC · Drizzle ORM · Neon (serverless Postgres) · Vercel AI SDK · Inngest (async jobs) · Vercel hosting

**Multi-tenancy:** All queries scoped by `businessId` at the application layer. No row-level security at the database level.

**Message flow:**

```
Staff message (WhatsApp/Telegram/SMS)
        │
        ▼
  Webhook ingress (/api/webhooks/*)
        │
        ▼
  Idempotency check (processedWebhookMessage table)
        │
        ▼
  Singlish normalisation (lib/chat/normalise.ts)
        │
        ▼
  Intent classification (GPT-4.1-Nano → deterministic fallback)
        │
        ▼
  Tool executor (lib/chat/executor.ts)
  ┌─────┼─────────┬──────────────┬────────────────┐
  │     │         │              │                │
  ▼     ▼         ▼              ▼                ▼
Avail  Cover    Query        Confirm         Respond
Parse  Request  Schedule     Availability    to Offer
  │     │         │              │                │
  ▼     ▼         ▼              ▼                ▼
  Channel router (lib/messaging/channel-router.ts)
  Telegram($0) → WA reply($0) → Email($0.0001) → WA template($0.011) → SMS($0.052)
        │
        ▼
  Adapter dispatch (Telegram/WhatsApp/SES/Plivo)
```

**Knowledge base injection:** Per-staff context pages (`lib/knowledge/`) inject wiki-style context (relationships, skills, patterns) into the schedule generation pipeline.

**tRPC routers (7+):** `availability`, `business`, `cover`, `dashboard`, `preferences`, `schedule`, `staff`, `knowledge` — merged in `lib/trpc/router.ts`.

**Async jobs:** Inngest handles 5 registered functions:
- `extract-preferences` — LLM rule extraction from manager edits
- `process-cover-request` — candidate fan-out with atomic fill
- `mine-patterns` — recurring pattern discovery from edit history
- `send-reminders` — availability reminder chains
- `lint-knowledge` — knowledge base consistency checks

---

## 3. LLM Layer

### Multi-model routing (`lib/llm/router.ts`)

| Model | Provider | Input $/1M | Output $/1M |
|-------|----------|-----------|-------------|
| GPT-4.1-Nano | OpenAI | $0.10 | $0.40 |
| GPT-4.1-Mini | OpenAI | $0.40 | $1.60 |
| Gemini 2.5 Flash | Google | $0.15 | $0.60 |
| Gemini 2.5 Pro | Google | $1.25 | $10.00 |
| Gemini 2.5 Pro (batch) | Google | $0.625 | $5.00 |
| Claude Haiku 4.5 | Anthropic | $1.00 | $5.00 |
| Claude Sonnet 4.5 | Anthropic | $3.00 | $15.00 |
| Claude Sonnet 4.6 | Anthropic | $3.00 | $15.00 |

### Task routing table

| Task | Primary | Fallback LLM | Deterministic fallback |
|------|---------|-------------|----------------------|
| `classification` | GPT-4.1-Nano | — | Rule-based classifier |
| `message_routing` | GPT-4.1-Nano | Claude Haiku 4.5 | Keyword-based router |
| `json_validation` | GPT-4.1-Nano | — | JSON Schema validator |
| `nl_availability_parsing` | GPT-4.1-Mini | Claude Haiku 4.5 | Regex + keyword parser |
| `preference_extraction` | Claude Haiku 4.5 | Claude Sonnet 4.5 | — |
| `pattern_mining` | Gemini 2.5 Pro (batch) | Claude Sonnet 4.5 | — |

### Three-tier fallback (`lib/llm/fallback.ts`)

1. **Primary** — cheapest model that meets the quality bar for the task
2. **Fallback LLM** — more expensive, higher reliability model
3. **Deterministic** — non-LLM implementation (regex, rules, JSON Schema). Always succeeds. Available for 4 of 6 task types.

### Structured output implementation

Structured output is inconsistently enforced across the LLM layer:

| Task | Method | File |
|------|--------|------|
| Schedule generation | Native JSON schema via Anthropic SDK `output_config` | `lib/llm/schedule-client.ts` |
| Intent classification | Text-mode JSON with prompt instructions + `try/catch JSON.parse` | `lib/availability/intent-classifier.ts` |
| Message routing | Text-mode JSON with prompt instructions + `try/catch JSON.parse` | `lib/chat/router.ts` |
| Availability parsing | Text-mode JSON with prompt instructions + `try/catch JSON.parse` | `lib/availability/nl-parser.ts` |
| JSON validation | Text-mode JSON with prompt instructions + `try/catch JSON.parse` | `lib/llm/client.ts` |

The `LlmRequest` interface defines a `jsonMode: true` flag, but `callWithModel()` in `lib/llm/client.ts` **never consumes it** — the flag is set by callers but has no effect on the actual API call. Only `schedule-client.ts` uses native structured output. All other task types rely on the model following prompt instructions, with `try/catch` around `JSON.parse` as the only safety net.

### Health tracking (`lib/llm/health.ts`)

- 5-minute sliding window per model
- Tracks error rate and P95 latency per window
- Thresholds: 30% max error rate, 10s max P95 latency
- Automatically routes away from degraded models
- **Limitation:** In-memory only — resets on every serverless cold start

### Cost tracking (`lib/llm/cost-tracker.ts`)

- Every LLM call logged to `llm_call_log` table: businessId, taskType, model, input/output tokens, costUsd, latencyMs, success
- `getMonthlyCost(businessId)` returns total and per-task breakdown
- `checkCostThreshold(businessId, thresholdUsd)` for tier-based caps
- Prompt caching enabled: OpenAI 50% off, Anthropic 90% off, Google ~90% off (`lib/llm/client.ts`)

---

## 4. Conversation State

### Current implementation

The router's `RouteContext` type has only 3 fields:
- `today` — current date string
- `hasPendingOffer` — boolean (is there an open cover offer for this staff member?)
- `hasUnconfirmedSubmission` — boolean (is there an unconfirmed availability submission?)

There is **no conversation history**, no previous bot message tracking, no last-intent field, and no turn counter.

### How multi-turn works (2 hardcoded flows only)

1. **Cover offer response** — works because a `cover_offer` record with `status = 'pending'` exists in the database. The router checks `hasPendingOffer` and routes to the offer-response handler.
2. **Availability confirmation** — works because an `availability_submission` record with `confirmed = false` exists. The router checks `hasUnconfirmedSubmission` and routes to the confirmation handler.

Both flows work via **database-backed state**, not conversation context. The system doesn't know what it last said to the user — it queries whether a pending record exists.

### What doesn't work

- **Generic clarifying questions are unsupported.** If the bot asks "which day do you mean?", the user's response is classified as a fresh intent — the bot has no memory of having asked.
- **The `communication_log` table is write-only** — messages are logged but never queried for routing or execution context. It's an audit trail, not a conversation memory.
- **Callback buttons (Telegram inline keyboards) bypass the router entirely** — they carry structured data in the callback payload, avoiding the need for conversational context. This is a UI workaround, not a conversation solution.

### Reference files

- `lib/chat/router.ts` — `RouteContext` type definition, context-based routing logic
- `lib/chat/executor.ts` — `executeAction` signature (receives no conversation history)
- `app/api/webhook/telegram/route.ts` — context assembly (queries DB for pending states)

---

## 5. Messaging Layer

### Five-channel dispatch (`lib/messaging/channel-router.ts`)

| Priority | Channel | Cost/msg | Condition |
|----------|---------|----------|-----------|
| 1 | Telegram | $0.000 | Staff has linked Telegram account |
| 2 | WhatsApp free reply | $0.000 | Within 24h conversation window |
| 3 | Email (AWS SES) | $0.0001 | Non-urgent + email on file |
| 4 | WhatsApp template | $0.0113 | WhatsApp number on file |
| 5 | SMS (Plivo) | $0.052 | Phone number on file, last resort |

### Channel selection logic

```
telegramChatId exists?          → telegram ($0)
whatsappPhone + window valid?   → whatsapp_reply ($0)
non-urgent + email?             → email ($0.0001)
whatsappPhone?                  → whatsapp_template ($0.011)
time-sensitive + email?         → email ($0.0001)
smsPhone?                       → sms ($0.052)
```

### WhatsApp conversation window tracking

`conversation_window` table tracks `windowOpensAt` and `windowExpiresAt` per staff member. When a staff member messages the bot, a 24-hour free-reply window opens. Messages within the window are free; outside the window, the system falls back to paid template messages or cheaper channels.

---

## 6. Schedule Generation

### Three-variation pipeline (`lib/scheduling/generator.ts`)

Each schedule run produces three variations:
- **`cost_optimised`** — minimise total labour cost
- **`fairness_optimised`** — equalise hours and undesirable shift distribution
- **`balanced`** — weighted combination

Manager selects one, optionally edits, and publishes. Schedule generation uses `db.transaction()` for atomic persistence.

### Constraint validation (`lib/scheduling/validator.ts`)

Hard constraints checked:
- Role qualification matching
- Availability window overlap (minimum 3 hours)
- Maximum weekly hours per staff
- Minimum rest hours between shifts
- Maximum consecutive working days
- Coverage requirements (min/max staff per shift)

### Fairness scoring (`evals/scorers/fairness.ts`)

Uses Gini coefficient to measure distribution inequality:
- `Gini = 0.0` → perfectly equal hours distribution
- `fairnessScore = 1 - Gini` (1.0 = perfectly fair)
- Applied to both total hours and undesirable shift (weekends/nights) distribution

### Preference learning

- `preference_rule` table stores rules with `ruleType` (soft/hard/temporary), `source` (manager_explicit, learned_from_edit, staff_request), and `confidence` score (0.0–1.0)
- `manager_edit` table links edits to schedule variations
- System extracts scheduling rules from manager edit patterns via LLM (`extract-preferences.ts`)
- Pattern mining discovers recurring patterns across weeks (`mine-patterns.ts`)
- Rules feed back into subsequent schedule generation via prompt builder (MUST/PREFER formatting)
- Knowledge base (`lib/knowledge/`) provides wiki-style per-staff context
- Relationship detection (`lib/relationships/`) captures interpersonal dynamics
- Skill extraction (`lib/skills/`) tracks capabilities for composition validation
- **Gap:** Rules are injected but compliance is never checked — no verification that generated schedules actually follow the rules, and no reinforcement mechanism to update `lastReinforcedAt` on preference rules

### Eval suite

Promptfoo configs in `evals/`: 11 YAML files covering availability parsing (6 cases), classification (9 cases), preference extraction, and schedule generation (multiple configs including compressed 18-case × 3 variations). Golden datasets in `evals/golden/schedules/` (7 weeks of expected outputs).

---

## 7. Data Model

**20+ tables** defined in `lib/db/schema.ts` using Drizzle ORM on Neon Postgres.

### Core entities

```
business (config JSONB, subscriptionTier, timezone)
  ├── staff (roles JSONB, payStructure JSONB, employmentType, level)
  │     ├── availability_submission (slots JSONB[])
  │     ├── conversation_window (windowOpensAt, windowExpiresAt)
  │     ├── telegram_registration (state tracking)
  │     ├── staff_relationship (staffId1↔staffId2, semantics, weight, lastReinforcedAt)
  │     └── staff_skill (tag, proficiency, source)
  ├── schedule_run (status, costUsd, generationSnapshot JSONB)
  │     ├── schedule_variation ×3 (assignments JSONB[], type)
  │     └── manager_edit (extractedRules)
  ├── preference_rule (ruleText, ruleType, source, confidence, lastReinforcedAt)
  ├── shift_composition_rule (shiftType, tag, minimumCount, minProficiency)
  ├── cover_request (candidates JSONB[])
  │     └── cover_offer (status)
  ├── knowledge_page (slug, pageType, title, content, metadata)
  └── communication_log (channel, direction, timestamps)

Auth (Better Auth):
  user (businessId, role: owner/manager/viewer)
  session, account, verification

Infrastructure:
  llm_call_log (businessId, taskType, model, tokens, costUsd, latencyMs)
  conversation_state (staffId, pendingTool, pendingParams, expiresAt)
  processed_webhook_message (channel:messageId deduplication)
```

### Key JSONB columns

| Table | Column | Contents |
|-------|--------|----------|
| `business` | `config` | weekStartDay, availability deadlines, reminder intervals, coverage requirements, constraint weights |
| `staff` | `roles` | Array of role strings |
| `staff` | `payStructure` | payType, baseHourlyRate, monthlySalary |
| `availability_submission` | `slots` | Array of {day, startTime, endTime, preference} |
| `schedule_run` | `generationSnapshot` | Full input snapshot: config, preferences, weights |
| `schedule_variation` | `assignments` | Array of {staffId, staffName, day, shiftType, startTime, endTime, cost} |
| `cover_request` | `candidates` | Array of eligible staff IDs |
| `staff_relationship` | `evidence` | Evidence supporting relationship detection |
| `knowledge_page` | `metadata` | Per-page metadata (varies by pageType) |

---

## 8. Testing

### Unit tests — 17 Vitest files (`__tests__/unit/`)

| File | Covers |
|------|--------|
| `router-llm.test.ts` | **82-case intent classification regression suite** (standard English, Singlish, shorthand, typos, disambiguation edge cases) |
| `normalise.test.ts` | Singlish particle stripping, shorthand expansion |
| `intent-classifier.test.ts` | Deterministic classification fallback |
| `availability-router.test.ts` | Availability parsing routing |
| `channel-router.test.ts` | Channel selection logic |
| `model-health.test.ts` | Health window tracking |
| `validator.test.ts` | Schedule constraint validation |
| `schedule-scorer.test.ts` | Schedule quality scoring |
| `executor.test.ts` | Chat tool execution |
| `assembler.test.ts` | Message assembly |
| `prompt-builder.test.ts` | Prompt construction |
| `nl-parser.test.ts` | Natural language parsing |
| `date-utils.test.ts` | Date handling |
| `reference-scorer.test.ts` | Reference schedule scoring |
| `telegram-adapter.test.ts` | Telegram webhook handling |
| `submit-from-chat.test.ts` | Chat-based availability submission |
| `router-missing.test.ts` | Missing context routing |

### E2E tests — 6 Playwright specs (`e2e/tests/`)

`login`, `signup`, `dashboard`, `staff`, `availability`, `settings`

Config: `workers: 1` — this is a **necessity, not a convenience**. Tests share a single business/user and mutate shared state. `staff.spec.ts` explicitly uses `mode: "serial"`. There is no per-test database reset; cleanup runs only in global teardown. Removing `workers: 1` would cause immediate failures due to shared mutable state.

### LLM eval configs — 11 Promptfoo YAMLs (`evals/`)

Availability parsing, classification, preference extraction, schedule generation (6 variants including model comparison and two-agent generation). Golden datasets for 7 weeks of schedule outputs.

### Gap analysis — what's NOT tested

- No load testing or performance benchmarks
- No integration tests for webhook → processing → dispatch pipeline
- No chaos/failure injection tests for LLM fallback paths
- No tests for concurrent multi-tenant operations
- No contract tests for external APIs (WhatsApp, Telegram, Plivo, SES)
- No database migration tests
- **E2E concurrency masking:** `workers: 1` is required because tests share mutable state — this masks real concurrency issues that would surface in production with multiple simultaneous users

---

## 9. What's Done Well

**LLM orchestration is unusually mature for a pre-launch product.**

- **Three-tier fallback with deterministic last resort.** 4 of 6 task types have a non-LLM fallback that always succeeds. Classification and message routing — the highest-volume paths — both have deterministic fallbacks. This means the critical chat flow never goes down due to LLM outages.

- **Cost-aware model routing.** Each task routes to the cheapest model that meets its quality bar. Classification uses GPT-4.1-Nano ($0.10/1M input); only pattern mining uses an expensive model (Gemini 2.5 Pro). Most competitors use a single model for everything.

- **Per-call cost tracking with business-level aggregation.** Every LLM call is logged with exact token counts and cost. Monthly spend queryable per business and per task type. Subscription tier thresholds prevent runaway costs.

- **Health-aware routing.** 5-minute sliding window tracks error rate and P95 latency per model. Automatic traffic shift away from degraded models — no manual intervention needed.

- **82-case intent classification regression suite** (`__tests__/unit/router-llm.test.ts`). Tests standard English, Singlish, shorthand, typos, and disambiguation edge cases. This level of LLM output testing is unusual — most teams ship with manual testing only.

- **Promptfoo eval pipeline.** 11 configs with golden datasets for structured evaluation of prompt quality across multiple generation tasks.

- **Cost-optimised messaging.** Channel router cascades from free (Telegram $0, WA reply $0) through cheap (Email $0.0001, WA template $0.011) to expensive (SMS $0.052). WhatsApp conversation window tracking avoids unnecessary template costs.

- **Singlish/shorthand normalisation layer** (`lib/chat/normalise.ts`). Domain-specific NLP preprocessing that handles particles (lah, lor, leh), shorthand (tmr, tdy, avail), and colloquialisms (boleh, alr). Smart particle stripping preserves short responses for LLM processing.

- **Clean separation of concerns.** Message flow is: normalise → classify → execute → dispatch. Each stage is independently testable.

- **JSONB for business configuration.** `business.config` stores coverage requirements, constraint weights, reminder schedules — allows per-business customisation without schema migrations.

- **Knowledge base and relationship/skill systems.** Wiki-style per-staff context pages (`lib/knowledge/`), relationship detection from edit patterns (`lib/relationships/`), and skill extraction with composition validation (`lib/skills/`). These systems build contextual intelligence that goes beyond simple rule storage.

- **Inngest workflow orchestration.** 5 registered functions handle cover request fan-out, preference extraction, pattern mining, reminders, and knowledge linting — all as background jobs with retries and observability.

- **Database transactions in critical paths.** `db.transaction()` used in 5 key flows: schedule generation, schedule approval, cover request fill, webhook processing, and chat availability submission. Prevents race conditions in concurrent operations.

- **Webhook idempotency.** `processedWebhookMessage` table deduplicates incoming messages from Telegram and WhatsApp, preventing duplicate processing on webhook retries.

---

## 10. What Needs Work

**The preference learning feedback loop is incomplete. Infrastructure gaps remain but the most critical concurrency issues have been addressed.**

### Feedback loop gap (HIGH priority)

- **Preference rules are injected but never verified as followed.** The system extracts rules from edits, injects them into generation prompts, and decays them over time — but never checks whether generated schedules actually comply with the rules. Without compliance checking, there's no signal for reinforcement, and all rules trend toward expiry regardless of relevance. This undermines the product's core differentiator.

- **No reinforcement mechanism.** `lastReinforcedAt` exists on `preferenceRule` but is never written to for preference rules (only for relationship rules). Rules that are consistently followed should have their confidence boosted and expiry extended.

- **No confidence-based filtering in assembler.** All active rules are injected into the prompt with equal weight regardless of confidence score. Low-confidence rules should be soft suggestions; high-confidence rules should be hard constraints.

### Missing orchestration (HIGH priority)

- **No schedule distribution orchestrator.** Approved schedules can be finalised but there's no logic to iterate staff and send personalised shift messages. All messaging infrastructure (4 adapters, channel router, webhooks) is built and ready.

- **No autonomous collection trigger.** Availability collection requires manual action. No cron to start collection at T-7 days.

### LLM layer gaps

- **Structured output gap.** `jsonMode` flag in `LlmRequest` is set but never consumed by the LLM client — 5 of 6 task types rely on prompt-instructed JSON with `try/catch JSON.parse` as the only safety net. Only schedule generation uses native structured output.

- **Conversation state gap.** Router has no conversation history — only 2 hardcoded multi-turn flows work (cover offer response, availability confirmation). Generic clarifying questions are unsupported.

### Infrastructure gaps

- **No rate limiting.** Cost thresholds cap monthly LLM spend, but there's no request-level rate limiting. A misbehaving webhook or bad actor could exhaust resources before cost thresholds trigger.

- **No caching layer.** No Redis or in-memory cache. All reads hit Neon directly. Staff roster data, business config, and schedule data are read-heavy and highly cacheable.

- **In-memory health tracking resets on cold starts.** The 5-minute sliding window for model health lives in process memory. On Vercel's serverless infrastructure, every cold start resets the health state — the system loses its learned model health data.

- **No queue between webhook ingress and processing.** Incoming messages are processed synchronously in the webhook request handler. No buffering, no backpressure, no retry on failure.

- **No retry or dead-letter queue for failed message sends.** If a Telegram/WhatsApp/SMS send fails, it's lost. No retry logic, no DLQ, no alerting on send failures.

- **No row-level security.** Multi-tenancy relies entirely on application-layer `businessId` filtering. A single missed WHERE clause leaks data across tenants. No database-level enforcement.

- **No load testing or performance benchmarks.** Unknown how the system behaves under concurrent load — message processing throughput, schedule generation time for large teams, database connection limits.

- **Schedule generation is synchronous.** Runs in the HTTP request path. For businesses with many staff and complex constraints, this could timeout on Vercel's function execution limits.

- **No WebSocket/SSE for real-time updates.** Dashboard requires polling for schedule status, cover request updates, etc.

- **Alerting pipeline not configured.** Sentry is integrated for error tracking and Pino for structured logging, but no alerting rules or notification channels are set up.

---

## 11. Scale Readiness

### 100 businesses — works today

Current architecture handles this. Low request volume. Neon's free/starter tier suffices. Cold start health resets are annoying but not critical — low enough traffic that models rarely degrade. Database transactions prevent the most critical race conditions.

### 1,000 businesses — needs infrastructure work

- **Caching is mandatory.** 1K businesses × N staff × repeated config/roster reads = database pressure. Need Redis or equivalent for hot data.
- **Health state needs external storage.** Redis-backed health window so model health persists across cold starts.
- **Webhook queue needed.** 1K businesses sending messages simultaneously could overwhelm synchronous processing. Need SQS/Redis queue between ingress and processing.
- **Schedule generation must go async.** Move to Inngest background job with status polling or WebSocket push.
- **Alerting is non-negotiable.** Need Sentry alert rules, latency percentile dashboards, cost alerting.

### 10,000 businesses — needs architectural investment

- **Database sharding or read replicas.** Single Neon instance won't handle the read volume even with caching.
- **Multi-region deployment.** If serving multiple markets beyond Singapore.
- **Row-level security or tenant isolation.** At this scale, a data leak is an existential risk.
- **Rate limiting per tenant.** Prevent noisy neighbours from degrading service for others.
- **Dedicated LLM capacity or reserved throughput.** Shared API rate limits from OpenAI/Anthropic/Google become a bottleneck.
- **Dedicated ops team.** One developer can't manage infrastructure, on-call, and feature development for 10K paying businesses.

---

*This evaluation is based on a static code review. No load testing or production traffic analysis was performed.*
