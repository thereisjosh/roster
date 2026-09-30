# Roster

AI workforce scheduling for shift-based SMBs in Southeast Asia.

Roster replaces the weekly WhatsApp-and-spreadsheet scheduling loop with a manager dashboard, staff chat intake, AI-assisted schedule generation, and an evaluation suite for the LLM-heavy parts of the product.

## Why this exists

Small F&B, retail, and clinic teams often coordinate availability through chat, then manually build rosters in spreadsheets. That creates three recurring problems:

- Managers spend hours collecting availability and chasing updates.
- Schedules are hard to optimize for coverage, cost, fairness, and preferences at the same time.
- Cover requests and last-minute changes are handled informally, so learnings never make it back into the next roster.

Roster treats scheduling as an operational workflow:

1. Staff submit availability in natural language through chat.
2. The system parses and confirms availability.
3. Managers generate cost, fairness, and balanced schedule variants.
4. Edits and approvals become feedback for future scheduling.
5. Cover requests fan out through the cheapest viable messaging channel.

## Product Surface

- Manager dashboard for staff, availability, schedules, cover requests, and settings.
- Natural-language staff availability parsing, including Singlish and shorthand.
- Schedule generation with three variants: cost-optimized, fairness-optimized, and balanced.
- Constraint validation for roles, availability windows, weekly hours, rest windows, consecutive days, and coverage.
- Preference learning from manager edits.
- Cover request workflow with eligible-candidate fan-out and atomic fill.
- Multi-channel messaging router: Telegram, WhatsApp, email, and SMS.
- Promptfoo eval suites for routing, parsing, preference extraction, and schedule generation.

## Architecture

```text
Staff chat
  -> webhook ingress
  -> idempotency check
  -> Singlish normalization
  -> intent routing
  -> action executor
  -> cost-aware channel router

Manager dashboard
  -> tRPC routers
  -> schedule assembler
  -> LLM schedule generation
  -> hard-constraint validation
  -> schedule variant scoring
  -> review / approve / edit loop
```

Core stack:

- Next.js 15 App Router, React 19, TypeScript
- tRPC 11
- Drizzle ORM, PostgreSQL / Neon
- Better Auth
- Inngest for async jobs
- Vercel AI SDK with OpenAI, Anthropic, and Google model providers
- Promptfoo for evals
- Vitest and Playwright

## AI Design

Roster does not use one model for everything. The LLM layer is task-routed:

- Cheap models for high-volume classification and routing.
- Stronger models for schedule generation and preference extraction.
- Deterministic fallbacks for critical paths where possible.
- Cost tracking per business and task type.
- Health tracking to route away from degraded models.

The point is not to make scheduling magical. The point is to make the probabilistic pieces measurable, bounded, and backed by ordinary code when reliability matters.

## Evaluation

The `evals/` directory contains Promptfoo configs, prompts, golden datasets, transforms, and scorers for:

- intent classification
- availability parsing
- preference extraction
- schedule generation
- compressed schedule prompting
- model comparison

Several schedule evals score outputs against coverage, eligibility, fairness, and reference rosters.

Eval result JSON files are intentionally ignored because they can contain large model outputs, token accounting, or local experiment traces.

## Current Readiness

This is a portfolio-grade product build, not a live SaaS.

Built:

- dashboard surfaces
- staff, availability, settings, and schedule flows
- chat routing and execution
- multi-channel messaging adapters
- schedule generation pipeline
- preference / knowledge / relationship subsystems
- eval and test infrastructure

Known gaps before production:

- move long schedule generation to background jobs for large businesses
- add persistent rate limiting and retry / DLQ for message delivery
- add Postgres row-level security before multi-tenant production scale
- persist model-health state outside process memory
- configure production alerting
- complete schedule distribution orchestration after approval

## Local Setup

```bash
npm install
cp .env.example .env
npm run db:push
npm run dev
```

Required environment variables are listed in `.env.example`.

For unit tests:

```bash
npm test
```

For evals, configure provider keys, then run:

```bash
npm run eval:ci
```

## Notes

The repository is intentionally sanitized for public review. Local `.env` files, generated reports, eval result dumps, schedule screenshots, PDFs, and assistant scratch files are excluded.
