# Roster — Product Knowledge Document

> Generated 2026-05-06. Comprehensive reference for onboarding, evaluation, or due diligence.

---

## 1. Product Summary

**Roster** is an AI-powered workforce scheduling system for shift-based SMBs (hospitality, retail, healthcare) in Southeast Asia.

**Problem:** Managers at small businesses spend hours each week collecting staff availability via WhatsApp/SMS, manually building schedules in spreadsheets, and scrambling to find cover when someone calls in sick. The process is error-prone, unfair, and expensive.

**Solution:** Roster automates the full scheduling lifecycle:
1. **Collect availability** — Staff text their availability in natural language (including Singlish) via WhatsApp or Telegram
2. **Generate schedules** — AI produces 3 optimized schedule variations (cost-optimized, fairness-optimized, balanced)
3. **Handle cover requests** — Staff request cover via chat; system finds eligible candidates and fans out offers
4. **Learn preferences** — When managers edit schedules, AI extracts implicit rules ("Alice has physio on Tuesdays") for future generations

**Target market:** Singapore and Malaysia shift-based businesses (cafes, clinics, retail stores) with 5-50 staff.

---

## 2. Complete Tech Stack

### Core Framework
| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js (App Router, Turbopack) | 15.1 |
| Language | TypeScript (strict mode) | 5.7 |
| React | React | 19.0 |
| Runtime | Node.js on Vercel (serverless) | — |

### Backend & Data
| Component | Technology | Version |
|-----------|-----------|---------|
| RPC | tRPC | 11 |
| Auth | Better Auth (email/password, sessions) | 1.2 |
| Database | PostgreSQL (Neon serverless) | — |
| ORM | Drizzle ORM (schema-first) | 0.38 |
| Validation | Zod | 3.24 |
| Async Jobs | Inngest (workflows, cron, retries) | 4.2.6 |

### AI / LLM
| Provider | Models Used | SDK |
|----------|-------------|-----|
| OpenAI | gpt-4.1-mini, gpt-4.1-nano | @ai-sdk/openai 1.3 |
| Anthropic | claude-haiku-4-5, claude-sonnet-4-5, claude-sonnet-4-6 | @anthropic-ai/sdk 0.91, @ai-sdk/anthropic 1.2 |
| Google | gemini-2.5-pro, gemini-2.5-flash | @ai-sdk/google 1.2 |
| Abstraction | Vercel AI SDK | ai 4.3 |

### Messaging Channels
| Channel | Provider | Cost per msg |
|---------|----------|-------------|
| Telegram | Bot API (webhooks) | $0.00 |
| WhatsApp (free reply) | Meta Cloud API | $0.00 |
| Email | AWS SES | $0.0001 |
| WhatsApp (template) | Meta Cloud API | $0.011 |
| SMS | Plivo | $0.052 |

### Frontend & UI
| Component | Technology |
|-----------|-----------|
| Styling | Tailwind CSS 4, PostCSS |
| Components | Radix UI (dialog, select, tabs, switch) |
| Icons | Lucide React |
| Toasts | Sonner |
| State | TanStack React Query 5.62 (via tRPC) |
| Variants | class-variance-authority (CVA) |

### Testing & Quality
| Type | Tool |
|------|------|
| Unit tests | Vitest 3.0 (17 test files) |
| E2E tests | Playwright 1.59 (6 suites) |
| LLM evals | Promptfoo 0.110 (10+ configs, 82+ golden cases) |
| Component tests | Testing Library (React + DOM) |

### Monitoring
| Component | Technology |
|-----------|-----------|
| Error tracking | Sentry (@sentry/nextjs 8.55) |
| Logging | Pino 9.14 + pino-pretty |

---

## 3. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        STAFF (Chat)                              │
│              WhatsApp  ·  Telegram  ·  SMS  ·  Email             │
└──────┬──────────┬────────────────────────────────────────────────┘
       │          │
       ▼          ▼
┌──────────┐ ┌──────────┐
│ /webhook │ │ /webhook │    Vercel Serverless Functions
│ whatsapp │ │ telegram │
└────┬─────┘ └────┬─────┘
     │            │
     ▼            ▼
┌─────────────────────────────────────┐
│         Chat Router (LLM)           │  Intent classification (8 tools)
│   GPT-4.1-Nano → Claude Haiku      │  + Singlish normalization
│   → regex fallback                  │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│       Action Executor               │  Multi-turn state management
│  update_availability                │  Parameter collection via buttons
│  request_cover                      │
│  query_schedule                     │
│  check_status                       │
│  respond_to_offer                   │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│      Channel Router                 │  Cost-optimized cascade:
│  Telegram → WA free → Email         │  $0 → $0 → $0.0001 → $0.011 → $0.052
│  → WA template → SMS                │
└─────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     MANAGER (Web Dashboard)                      │
│         Next.js 15 App Router  ·  React 19  ·  Tailwind          │
└──────┬──────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────┐     ┌──────────────────────────────────┐
│  tRPC Router │────▶│  7 Routers, 25+ procedures        │
│  /api/trpc   │     │  schedule · staff · availability   │
└──────┬───────┘     │  business · cover · preferences    │
       │             │  dashboard                          │
       │             └──────────────────────────────────────┘
       ▼
┌──────────────────────────────────────┐
│   Schedule Generator (LLM)           │  3 variations per run
│   Prompt Builder → LLM Call          │  cost / fairness / balanced
│   → Validator → Scorer               │
└──────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│   PostgreSQL (Neon Serverless)        │  20 tables, Drizzle ORM
│   Tenant-scoped via businessId        │
└──────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│   Inngest (Async Jobs)               │
│   • extract-preferences              │  Learn from manager edits
│   • process-cover-request            │  Fan-out cover offers
│   • mine-patterns                    │  Discover recurring patterns
│   • send-reminders                   │  Cron: availability nudges
│   • lint-knowledge                   │  Knowledge base consistency
└──────────────────────────────────────┘
```

### Data Flow — Schedule Generation
1. Manager clicks "Generate" → `schedule.generate` tRPC mutation
2. Assembler fetches staff, availability, config, preference rules from DB
3. Eligibility computed: which staff can work which slots
4. For each of 3 variations: build prompt → call LLM → validate → score → persist
5. Manager views 3 variations side-by-side → approves one → edits → finalizes
6. Edits trigger preference extraction (Inngest) → rules stored for future runs

### Data Flow — Inbound Chat Message
1. Webhook receives message (WhatsApp or Telegram)
2. Idempotency check (skip duplicates)
3. Staff identified by phone or telegramChatId
4. LLM classifies intent → one of 8 tools
5. If parameters missing → save conversation state, prompt user
6. Execute action (DB write, cover request, etc.)
7. Channel router selects cheapest reply channel → send response

---

## 4. Feature Inventory

### Staff-Facing (Chat)
- Natural language availability submission (Singlish supported)
- Availability confirmation with inline buttons
- Schedule queries ("When do I work?")
- Cover requests ("I can't make it Wednesday")
- Cover offer accept/decline
- Status checks ("Did my availability go through?")
- Telegram self-registration via invite code
- Telegram account linking for existing staff
- Multi-turn parameter collection (date pickers, confirmations)

### Manager-Facing (Web Dashboard)
- **Dashboard** — KPI cards (active staff, schedule runs, submissions, open cover requests)
- **Staff Management** — CRUD for employees (name, phone, email, employment type, level, roles, pay structure)
- **Availability View** — Weekly grid showing all staff submissions
- **Schedule Generation** — One-click generation of 3 optimized variations
- **Schedule Comparison** — Side-by-side view of cost/fairness/balanced variations with Gantt chart
- **Schedule Approval** — Approve variation with feedback rating
- **Schedule Editing** — Modify individual assignments with reason tracking
- **Schedule Finalization** — Publish to staff
- **Cover Request Management** — View open/filled/escalated requests
- **Preference Rules** — View learned rules, confirm/reject, add explicit rules
- **Settings** — Business config (shift types, break rules, availability deadlines, scheduling weights, operating hours)
- **Invite Code** — Generate/regenerate for staff self-registration

### AI/Automation
- Multi-model LLM routing (cheapest model per task)
- Deterministic fallbacks (regex/rule-based) when LLMs fail
- Preference learning from manager edits
- Pattern mining from finalized schedules
- Cost tracking per LLM call (per-token)
- Model health monitoring with automatic failover
- Cost-optimized messaging channel selection

### Infrastructure
- Multi-tenant data isolation (businessId scoping)
- Webhook idempotency (deduplication)
- WhatsApp 24h conversation window tracking
- Async job orchestration (Inngest)
- LLM evaluation suite (Promptfoo)

---

## 5. Database Schema

### 20 Tables, organized by domain:

#### Auth (Better Auth managed)
| Table | Key Columns |
|-------|-------------|
| `user` | id, email, name, role (owner/manager/viewer), businessId |
| `session` | token, userId, expiresAt, ipAddress, userAgent |
| `account` | userId, providerId, accountId |
| `verification` | identifier, value, expiresAt |

#### Business & Staff
| Table | Key Columns |
|-------|-------------|
| `business` | id, name, timezone, subscriptionTier, config (JSONB), inviteCode |
| `staff` | id, businessId, name, phone, email, employmentType, level, roles, payStructure, isActive, telegramChatId |

#### Availability
| Table | Key Columns |
|-------|-------------|
| `availabilitySubmission` | id, staffId, businessId, weekStart, status, slots (JSONB) |

#### Scheduling
| Table | Key Columns |
|-------|-------------|
| `scheduleRun` | id, businessId, weekStart, status, promptVersion, modelVersion, costUsd, generationSnapshot (JSONB) |
| `scheduleVariation` | id, runId, variationType (cost/fairness/balanced), assignments (JSONB), warnings, approvedAt, approvedBy, feedbackRating |
| `managerEdit` | id, runId, variationId, staffId, originalShift, newShift, editReason, extractedRules, processedAt |
| `preferenceRule` | id, businessId, ruleText, ruleType (soft/hard/temporary), source (explicit/learned/staff), confidence, active, expiresAt, lastReinforcedAt |

#### Knowledge & Relationships
| Table | Key Columns |
|-------|-------------|
| `staffRelationship` | id, businessId, staffId1, staffId2, semantics, label, weight, confirmed, evidence, lastReinforcedAt |
| `staffSkill` | id, businessId, staffId, tag, proficiency, notes, source, sourceUtterance, confirmedAt |
| `shiftCompositionRule` | id, businessId, shiftType, tag, minimumCount, minProficiency, required, sourceUtterance |
| `knowledgePage` | id, businessId, slug, pageType (staff/rule/pair/pattern/index/log), title, content, metadata, version |

#### Cover Requests
| Table | Key Columns |
|-------|-------------|
| `coverRequest` | id, businessId, scheduleRunId, shiftId, requestingStaffId, candidates, filledBy, status |
| `coverOffer` | id, coverRequestId, candidateStaffId, status, respondedAt |

#### Communication
| Table | Key Columns |
|-------|-------------|
| `communicationLog` | id, businessId, staffId, direction, channel, body, deliveredAt, readAt |
| `conversationWindow` | id, staffId, channel, openedAt, expiresAt |
| `telegramRegistration` | id, telegramChatId, businessId, step, collectedName, collectedPhone |
| `processedWebhookMessage` | id (channel:messageId), processedAt |

#### Infrastructure
| Table | Key Columns |
|-------|-------------|
| `llmCallLog` | id, businessId, taskType, model, inputTokens, outputTokens, costUsd, latencyMs, success, error |
| `conversationState` | id, staffId, pendingTool, pendingParams, pendingPrompt, expiresAt |

### Enums
- `userRole`: owner, manager, viewer
- `subscriptionTier`: trial, starter, pro, enterprise
- `employmentType`: full_time, part_time, casual
- `availabilityStatus`: pending, submitted, confirmed
- `scheduleRunStatus`: generating, pending_review, approved, finalised, escalated
- `variationType`: cost_optimised, fairness_optimised, balanced
- `ruleType`: soft, hard, temporary
- `ruleSource`: manager_explicit, learned_from_edit, staff_request
- `coverRequestStatus`: open, filled, escalated, cancelled
- `messageDirection`: inbound, outbound
- `messageChannel`: whatsapp_reply, whatsapp_template, email, sms, telegram

---

## 6. API Surface

### REST Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| ALL | `/api/auth/[...all]` | Better Auth handler (login, signup, logout, session) |
| ALL | `/api/trpc/[trpc]` | tRPC endpoint (all procedures) |
| POST | `/api/inngest` | Inngest event webhook |
| GET/POST | `/api/webhook/whatsapp` | WhatsApp Cloud API (GET=verify, POST=messages) |
| POST | `/api/webhook/telegram` | Telegram Bot API webhook |

### tRPC Procedures (25+)

**`schedule` router:**
- `generate(weekStart)` → creates run + 3 variations
- `listRuns()` → all runs for business
- `getRunById(id)` → run detail with variations
- `approveVariation(variationId)` → approve
- `submitApprovalFeedback(variationId, rating, comment)` → feedback
- `recordEdit(runId, variationId, staffId, originalShift, newShift, reason)` → triggers preference learning
- `finalise(runId)` → publish
- `deleteRun(runId)` → delete (not finalised)
- `scoreVariation(variationId)` → fairness/coverage scoring

**`staff` router:**
- `list()`, `getById(id)`, `create(...)`, `update(id, ...)`, `deactivate(id)`

**`availability` router:**
- `listForWeek(weekStart)`, `submit(staffId, weekStart, slots)`

**`business` router:**
- `create(name, timezone)`, `getCurrent()`, `updateConfig(config)`, `regenerateInviteCode()`

**`cover` router:**
- `list()`, `create(...)`, `updateStatus(id, status)`, `fillCover(id, filledBy)`

**`preferences` router:**
- `list()`, `create(...)`, `toggleActive(id)`, `confirm(id)`, `reject(id)`, `delete(id)`

**`dashboard` router:**
- `stats()` → activeStaffCount, scheduleRunsThisWeek, availabilitySubmissions, openCoverRequests

---

## 7. AI/Agentic Logic

### Multi-Model Routing

Each AI task is routed to the cheapest model that meets its quality bar:

| Task | Primary | Cost/1M tokens | Fallback LLM | Deterministic Fallback |
|------|---------|----------------|---------------|----------------------|
| Message classification | GPT-4.1-Nano | $0.10 | Claude Haiku | Rule-based classifier |
| Availability parsing | GPT-4.1-Mini | $0.40 | Claude Haiku | Regex + keywords |
| Schedule generation | Claude Sonnet 4.5 | varies | GPT-4.1 | — |
| Preference extraction | Claude Haiku 4.5 | $1.00 | Claude Sonnet | — |
| Pattern mining | Gemini 2.5 Pro (batch) | $0.625 | Claude Sonnet | — |
| JSON validation | GPT-4.1-Nano | $0.10 | — | JSON Schema check |

### Chat Intent Classification (8 tools)
1. `update_availability` — "Mon-Fri 9-5", "Saturday off"
2. `request_cover` — "Can't make it tomorrow"
3. `request_swap` — "Swap my Tuesday"
4. `query_schedule` — "When do I work?"
5. `check_status` — "Did my availability go through?"
6. `respond_to_offer` — Short yes/no in offer context
7. `confirm_availability` — Confirmations after submission
8. `unknown` — Fallback

The classification prompt includes Singlish normalization (lah, lor, leh particles; boleh = can; mc = medical cert; tmr = tomorrow).

### Schedule Generation Pipeline
1. **Assemble** — staff, availability, config, preference rules, knowledge base context from DB
2. **Compute eligibility** — which staff can work which slots (includes skill composition validation via `shiftCompositionRule`)
3. **Build prompts** — stable system prompt (enables caching) + variation-specific user prompt + relationship/skill context from knowledge base
4. **Call LLM** — structured JSON output with assignments, warnings, metadata
5. **Validate** — hard constraint checking (min/max staff, hours limits, rest periods)
6. **Score** — coverage %, fairness (Gini coefficient), hours compliance
7. **Retry** — up to 2 attempts on constraint violations
8. **Persist** — 3 variations saved with full generation snapshot (atomic via `db.transaction()`)

### Preference Learning
- Triggered when manager edits a schedule and records the reason
- LLM extracts rules: "Alice has physio on Tuesdays" → preference rule (`extract-preferences.ts`)
- Pattern mining discovers recurring patterns across weeks (`mine-patterns.ts`)
- Rules stored with confidence scores; high-confidence rules auto-activate
- Manager can confirm (boost confidence) or reject (deactivate) learned rules
- Active rules are included in future schedule generation prompts (MUST/PREFER formatting)
- Knowledge base (`lib/knowledge/`) provides wiki-style per-staff context pages
- Relationship detection (`lib/relationships/`) captures interpersonal dynamics from edit patterns
- Skill extraction (`lib/skills/`) tracks capability tags with proficiency levels
- Confidence decay: stale rules lose confidence over time (`lib/relationships/lifecycle.ts`, `lib/skills/lifecycle.ts`)
- **Gap — Feedback loop incomplete:** Rules are extracted and injected but never verified as followed. No compliance checking or reinforcement mechanism exists. All preference rules trend toward decay regardless of relevance. **Design decision:** Compliance checking must be observational, not blocking — it surfaces violations as warnings in the review UI, never rejects a schedule. The LLM may violate a preference rule because hard constraints (coverage, rest hours, qualification) forced a tradeoff. Best fit is better than no fit. Reinforcement should distinguish hard-constraint-forced violations (no confidence penalty) from avoidable violations (flag for review, slight confidence decrease).

### Resilience
- Every critical LLM path has a deterministic fallback
- Model health monitoring tracks success rates and latency
- Automatic failover to backup models on degradation
- System is never fully down — worst case uses regex/rules

---

## 8. File/Folder Structure

```
roster/
├── app/                          # Next.js App Router
│   ├── (auth)/                   # Login, signup pages
│   ├── (dashboard)/              # Protected pages (staff, schedule, availability, settings)
│   ├── api/
│   │   ├── auth/[...all]/        # Better Auth
│   │   ├── trpc/[trpc]/          # tRPC handler
│   │   ├── inngest/              # Inngest webhook
│   │   └── webhook/              # Telegram + WhatsApp webhooks
│   ├── layout.tsx                # Root layout
│   ├── page.tsx                  # Landing/home
│   └── providers.tsx             # tRPC + React Query providers
│
├── lib/                          # Core business logic
│   ├── auth/                     # Better Auth config + session helpers
│   ├── chat/                     # Message routing, execution, conversation state
│   ├── availability/             # NL parsing, intent classification, DB submission
│   ├── scheduling/               # Generator, assembler, validator, scorer, prompt builder
│   ├── llm/                      # Multi-model router, client, fallback, cost tracker, health
│   ├── messaging/                # Channel router + adapters (WhatsApp, Telegram, Email, SMS)
│   ├── inngest/                  # Async functions (preferences, cover, patterns, reminders)
│   ├── trpc/                     # Router definitions (7 routers)
│   ├── db/                       # Schema (20 tables), client, stores, migrations
│   └── *.ts                      # Utils (date, logging, config defaults)
│
├── components/                   # React UI
│   ├── layout/                   # Nav, sidebar
│   ├── schedule/                 # Gantt, variations, feedback
│   ├── availability/             # Grid dialog
│   ├── staff/                    # CRUD dialogs
│   ├── settings/                 # Config sections (shifts, breaks, weights, rules)
│   └── ui/                       # Radix primitives (button, input, dialog, etc.)
│
├── __tests__/                    # Unit (17 files) + component (2 files) tests
├── e2e/                          # Playwright E2E tests (6 suites)
├── evals/                        # Promptfoo LLM evaluations
│   ├── golden/                   # Golden datasets (schedules, classification, parsing, preferences)
│   ├── providers/                # Eval providers
│   ├── scorers/                  # Scoring logic
│   └── *.yaml                    # 10+ eval configs
│
├── scripts/                      # Seed data, eval summary
├── docs/                         # Technical docs, roadmap, backlog
├── package.json                  # 38 deps, 17 dev deps
├── drizzle.config.ts             # DB migration config
├── vitest.config.mts             # Test config
└── tsconfig.json                 # TypeScript config (strict)
```

---

## 9. Build & Deployment

### Local Development

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env   # Fill in all values

# Push schema to database
npm run db:push

# (Optional) Seed example data
npx tsx scripts/seed-example.ts

# Start dev server (Turbopack)
npm run dev              # → http://localhost:3000

# Run Inngest dev server (separate terminal)
npx inngest-cli@latest dev
```

### Environment Variables Required

```
DATABASE_URL=              # Neon PostgreSQL connection string
BETTER_AUTH_SECRET=        # Auth signing secret
BETTER_AUTH_URL=           # http://localhost:3000

OPENAI_API_KEY=            # OpenAI API key
ANTHROPIC_API_KEY=         # Anthropic API key
GOOGLE_API_KEY=            # Google AI API key

TELEGRAM_BOT_TOKEN=        # Telegram bot token
TELEGRAM_WEBHOOK_SECRET=   # Webhook verification secret
TELEGRAM_BOT_USERNAME=     # Bot username
NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=  # Client-side bot username

WHATSAPP_VERIFY_TOKEN=     # Meta webhook verification
WHATSAPP_APP_SECRET=       # HMAC signing secret
WHATSAPP_PHONE_NUMBER_ID=  # Business phone number ID
WHATSAPP_ACCESS_TOKEN=     # Graph API token

AWS_SES_REGION=            # ap-southeast-1
SES_FROM_ADDRESS=          # Verified sender email

PLIVO_AUTH_ID=             # Plivo account
PLIVO_AUTH_TOKEN=          # Plivo auth
PLIVO_SOURCE_NUMBER=       # Sender phone number

INNGEST_EVENT_KEY=         # Inngest event key
INNGEST_SIGNING_KEY=       # Inngest signing key
```

### Production Deployment

- **Compute:** Vercel (serverless, auto-scaling)
- **Database:** Neon (serverless PostgreSQL)
- **Jobs:** Inngest (managed, serverless)
- **Cost at scale:** <$50/month for 0-100 businesses

### Key Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Dev server with Turbopack |
| `npm run build` | Production build |
| `npm run db:generate` | Generate Drizzle migrations |
| `npm run db:migrate` | Run migrations |
| `npm run db:push` | Push schema directly (dev) |
| `npm test` | Run unit tests (Vitest) |
| `npm run test:e2e` | Run Playwright E2E tests |
| `npm run eval` | Run all LLM evaluations |

---

## 10. Current State & Limitations

### What Works
- End-to-end chat flow (WhatsApp + Telegram → intent classification → action execution → reply)
- Natural language availability collection with Singlish support
- 3-variation schedule generation with scoring and comparison
- Cover request creation, candidate matching, offer fan-out
- Preference learning from manager edits
- Multi-tenant auth with role-based access
- 4-channel messaging with cost-optimized routing
- Comprehensive test coverage (unit, E2E, LLM evals)

### Known Limitations & Gaps
- **Preference learning feedback loop incomplete** — rules are extracted, injected, and decayed, but never verified as followed. No compliance checking or reinforcement mechanism. This is the #1 architectural gap.
- **No rate limiting** — vulnerable to abuse at scale
- **No caching layer** — every request hits DB; needs Redis for config/roster data
- **Schedule generation is synchronous** — blocks HTTP request; should move to Inngest for long-running generations
- **No row-level DB security** — tenant isolation is application-level only (no Postgres RLS)
- **In-memory LLM health state** — resets on serverless cold starts
- **No retry queue for message delivery** — failed sends are not retried
- **No schedule distribution orchestrator** — approved schedules can't be sent to staff automatically (messaging infra is ready)
- **Single developer** — high bus factor risk
- **Sentry configured, alerting pipeline not set up** — errors are captured but no notification channels configured

### Scaling Path
| Stage | Businesses | Needed Work |
|-------|-----------|-------------|
| Current | 0-100 | Works as-is (<$50/mo infra) |
| Growth | 100-1K | Add Redis, queues, async generation, alerting |
| Scale | 1K-10K | Read replicas, RLS, per-tenant rate limits, multi-region |

---

## 11. Development Context

### Build Approach
- AI-assisted development (evident from code patterns, comprehensive eval infrastructure, and docs referencing AI-generated schedules)
- Solo developer project (single contributor, high velocity)
- Iteration-heavy: multiple eval configs suggest significant prompt engineering cycles

### Architecture Decisions
- **tRPC over REST** — full type safety between frontend and backend, no code generation
- **Drizzle over Prisma** — lighter, faster, closer to SQL
- **Better Auth over NextAuth** — simpler API, better session management
- **Inngest over raw queues** — step functions with retries, no infrastructure to manage
- **Multi-model LLM** — cost optimization (90%+ of calls use cheapest models), resilience via fallbacks
- **Neon over Supabase/PlanetScale** — serverless PostgreSQL with branching, generous free tier

### Quality Infrastructure
- 82-case golden dataset for Singlish NLP regression testing
- 10+ Promptfoo eval configs covering all LLM tasks
- Separate scorers for parsing accuracy, schedule quality, fairness (Gini), and preference extraction
- Model comparison results tracked (Claude vs GPT vs Gemini)

### Technical Moats (from investor docs)
1. Multi-model LLM orchestration with deterministic fallbacks
2. Singlish NLP preprocessing (market-specific, not available off-the-shelf)
3. LLM quality infrastructure (systematic eval + regression testing)
4. Per-token cost tracking and tier-based capping
5. Cost-optimized messaging (WhatsApp 24h window tracking, Telegram-first routing)

---

## Summary

Roster is a complete, production-near AI scheduling SaaS with a well-architected serverless stack. The codebase demonstrates strong engineering discipline: type-safe end-to-end (tRPC + Drizzle + Zod), comprehensive testing at every layer, multi-model AI with graceful degradation, and cost-conscious infrastructure choices. The primary gaps are operational (monitoring, rate limiting, caching) rather than architectural — typical for an early-stage product ready for initial market deployment.

**File count:** ~222 source files | 20 DB tables | 7 tRPC routers | 25+ procedures | 17 unit test files | 6 E2E suites | 10+ eval configs
