# CODING_STANDARDS.md

## 1. Architectural Principles

* **Backend & Secret Separation:** Decision logic, external integrations, and operations holding API keys/secrets MUST live inside **Supabase Edge Functions (Deno)**. Next.js functions strictly as the UI and direct data layer (using RLS-guarded queries/writes). Never execute core business logic or store secret credentials on the Next.js client or server components.
* **Database Access:** Row-Level Security (RLS) is enabled and enforced by default for all Supabase database access.

---

## 2. Code Organization & Architecture Patterns

* **Deep Modules:** Design modules with simple, minimal public interfaces that encapsulate complex internal logic.
* **Cohesive modules:** Ensure modules are cohesive, use any change requirements as a guide to judge the cohesiveness of the module. Ideally, a change will require a single module to change and almost all the module parts will change together. Use Common closure principle to ensure module cohesiveness in front of any change. (One change per layer is fine - like backend and frontend etc) 
* **Pure Seams vs. I/O Adapters:**
* **Pure Seams:** All core decision and business logic must be isolated in pure functions/modules. Dependencies (database clients, external APIs, system clocks, IDs) MUST be explicitly injected/passed in rather than called directly inside the module. This allows seems less Unit testing of the core business logic. This provides highest coverage, clean tests (without/less mocks) and faster feedback (at unit level). Minimizing side effect also improve local reasoning and overall composability and better usage (context free).
* **I/O Adapters:** Keep data fetching and external service communication in thin, simple outer adapters distinct from the pure seams. This can directly be testing as part of the integration or end-to-end tests (mainly for wiring purposes), do not need unit tests for these components. They can be stubbed or mocked to support the unit test for Pure seams.

---

## 3. Testing & CI Quality Gate (AFK-Readiness Bar)

* **Test-Driven Development (TDD):** Work in tight, vertical slices test-first: write a single failing test, ensure the test fail with correct reason and feedback, make it pass, and refactor.
* **Coverage Focus:** 100% branch coverage is required for all **pure seams**. Thin I/O adapters do not require unit tests.
* **Mocking Policy:** Mock ONLY at the outer system boundaries (I/O edges). Never mock internal domain classes or pure modules. Use stubs to control the size of the unit if setup is becoming complicated. Prefer state based tests over mock based one for pure seems.
* **Tests the system behavior:** Align tests to system behavior rather than to system structure. This focuses test scenarios on the system requirements than code under tests. Any classes or method created as part of the refactoring may not automatically requires tests. Add tests for this when setup is becoming complicated (use stubs to reduce the unit size).  
* **No Skipped Tests:** Tests must not be skipped or ignored. 
* **Self-Contained Tests:** A test's setup and teardown live in the test code itself, never assumed from the operator's shell, `.env.local`, or a manual step run by hand beforehand (a migration, a reset, a debug script). A test must not depend on state a previous run left behind, and must not leave behind state a later run or another test depends on — fixtures are inserted and cleaned up (or overwritten idempotently) by the test's own code. Running the designated command from a clean checkout — `npm run gate` for anything touching the database, which resets the local stack before `npm run verify` — must be sufficient on its own, every time. A result that depends on what the operator happened to run first is non-deterministic, and that is a bug in the test, not in the environment.
* **Gate Command:** Code must pass `npm run verify` locally before committing.

---

## 4. Safety & Operational Conventions

* **Dry-Run Default:** Any code triggering external side-effects (e.g., messaging via respond.io or sending emails) must run in **dry-run mode by default**. Outbound actions must be explicitly gated behind a real-send flag.
* **Secrets & Security:** Never hardcode credentials, tokens, or PII. Secrets must reside exclusively in `.env` files locally and in platform environment managers in deployed environments.

---

## 5. Development & Review Workflow

* **SDLC Standard:** Work follows the `mattpocock/skills` flow: Grill $\rightarrow$ Spec $\rightarrow$ Tickets $\rightarrow$ Implement $\rightarrow$ Verification Gate $\rightarrow$ Commit.
* **Ticket Scope:** All task tickets must represent **vertical slices** sized to fit entirely within a single fresh context window.
* **Automated Review:** Automated review agents evaluate the diff prior to committing along two primary criteria:
1. *Repository Standards:* Verification of pure seam isolation and proper test placement.
2. *Spec Adherence:* Ensuring zero scope creep or unrequested refactoring outside the explicit ticket spec.


* **Commits & Branches:** A single imperative subject line, no body and no trailers. Commit directly to `main`; rebase, never merge. See ADR-0013.

---

## 6. Styling

* **CSS Modules, no global classes:** A component's look lives in a `*.module.css` file beside it, so its class names are hashed. The only global (non-Module) stylesheets are `src/styles/tokens.css` and `src/styles/reset.css`, and neither may declare a class selector.
* **No inline `style`:** An inline `style={{ ... }}` in a `.tsx` file is forbidden — it bypasses the stylesheet.
* **Every value comes from the token file:** Colour, type scale, spacing and radius are custom properties in `src/styles/tokens.css`. No raw hex colour or `px` value anywhere else.
* **Why:** ADR-0012 keeps an Author's `class` and `id` attributes on a Book's HTML, and the Book renders inside Marginly's own document with no iframe and no shadow root — so a global class here would style the Author's prose too, moving the text's metrics a Highlight is measured against.
* **Guard:** `src/lib/style-guard/rules.ts` and `tests/style-guard.test.ts` enforce all three rules under `npm run test`, and therefore `npm run verify` and `npm run gate`.