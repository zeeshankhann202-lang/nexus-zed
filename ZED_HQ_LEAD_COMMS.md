# ZED HQ Lead — Collective Learning Bulletin CLB-001
**Date:** 2026-10-09 22:17 UTC
**Authority:** D022-D025 — Supreme Commander directives 2026-10-10
**Priority:** HIGH — action required before next session

---

## Background

ZED-X integration on 2026-10-09 found six stacked faults in ZED HQ's kill switch.
Every fault was detectable by static analysis before deployment.
Supreme Commander directive: code correctness across all systems is the first priority.
No system accumulates meaningful data until it is technically clean.

---

## Three lessons — applied to every system in the empire

### Lesson 1: Missing imports cause silent runtime failures
Names used but not imported crash silently in production.
This broke ZED HQ kill switch, /sal/me, and ZKG recorder.

Action: run lint on your codebase.
- Python: python -m pyflakes . (look for "undefined name")
- JavaScript: npx eslint . --ext .js (with no-undef rule)

### Lesson 2: Hardcoded credentials get corrupted silently
A single wrong character in a JWT key rejects every API call invisibly.

Action: audit for any hardcoded API keys, tokens, Supabase keys.
Move every one found to environment variables.

### Lesson 3: Build infrastructure needs a health check
Without a health check, a failed deploy silently replaces a working service.

Action: confirm your Railway service has Healthcheck Path set (Settings -> Deploy).
Docker services: use public.ecr.aws/docker/library/python:3.11-slim not Docker Hub.

---

## Required report to ZED HQ

Reply by editing this file and appending:

System: <name>
Lint status: clean OR N findings (list them)
Credentials: clean OR N moved to env vars
Health check: configured OR not configured
Blocker: <one line or none>

---

## Your system-specific action

Stack: JavaScript / Cloudflare Worker.
1. Run eslint with no-undef on worker.js and all JS files
2. Confirm no hardcoded Supabase keys in committed code
3. Confirm halt flag read in worker.js has been tested end-to-end

---
ZED HQ Lead | Intelligence Directorate | CLB-001


---

## ZED HQ Lead — NEXUS Audit Findings — 2026-10-10 12:46 UTC

ZED HQ Lead has completed a full code and networking audit of NEXUS.
Two critical issues require your action.

---

### CRITICAL 1 — KV Namespace is a placeholder

`wrangler.toml` contains:
```
id = "REPLACE_WITH_YOUR_KV_NAMESPACE_ID"
```

If the deployed worker uses this placeholder, `NEXUS_CACHE` binding fails.
Rate limiting uses KV — if the binding is broken, **rate limiting is not enforced**.
Any client can call the worker unlimited times.

**Action:** Replace with the real KV namespace ID from your Cloudflare dashboard.
Workers & Pages → KV → copy the namespace ID for nexus-zed-worker → update wrangler.toml → redeploy.

If you have already set this in Cloudflare's secrets/bindings (not via wrangler.toml),
confirm this and ZED HQ will mark the issue resolved.

---

### CRITICAL 2 — Halt flag not checked by worker.js

The execution engine correctly reads `zed_hq_controls.halt` before trading.
But `worker.js` does not check the halt flag at all.

Result: when ZED HQ issues HALT, execution stops, but the NEXUS dashboard
continues serving data normally — Commander sees NEXUS as operational while
the engine is halted. Misleading command picture.

**Action:** Add halt status to the worker's API responses.

Minimal fix — in the worker's main response, add:
```javascript
const haltRow = await supabaseGet('zed_hq_controls', 'id=eq.execution_control');
const haltActive = haltRow?.[0]?.halt === true;
// Include in response:
// "zedhq_halt": haltActive
```

This gives the dashboard (and ZED HQ) visibility into halt state.

---

### DOCUMENTATION — Schema file outdated

`supabase_schema.sql` defines 3 tables. Live database has 32 tables.
Please update the schema file to reflect the current full schema.
This ensures a fresh deployment can be fully rebuilt from the repo.

---

### No code bugs found

worker.js: zero hardcoded credentials, all fetch calls wrapped in try/catch,
rate limiting implemented, CORS appropriate for public API.

JS modules: clean. No undefined names found by static analysis.

Report back by editing this file.

— ZED HQ Lead | NEXUS Audit | 2026-10-10 12:46 UTC


---

## EMPIRE COMMAND DIRECTIVE 001 — Dispatched by ZED HQ Lead — 2026-10-17 18:53 UTC

**From:** Supreme Commander Zeeshan Ali Khan
**To:** All Empire System Leads
**Date:** 17 October 2026
**Authority:** Supreme Commander — binding on all system leads immediately

---

### Subject: System Knowledge Preservation & Management Baseline

The Empire is entering a controlled documentation and asset-management phase.

---

### Your Mission

Establish a complete, source-grounded and independently auditable knowledge baseline for your system.

**Each Lead shall:**

1. Inventory all existing system documentation, source modules, databases, APIs, infrastructure, integrations, tests, operational procedures and known issues.
2. Map the existing material against the 14-document Empire Documentation Standard v1.0.
3. Identify missing documentation, unsupported claims, security concerns and knowledge gaps.
4. Submit the current GitHub repository, branch and commit reference.
5. Submit a proposed documentation-only work plan and any required pull requests for separate authorization.
6. Distinguish implemented, tested, deployed, planned and unverified capabilities.
7. Preserve all significant architectural decisions, development history, limitations and unresolved defects.
8. Exclude credentials, private keys, tokens and sensitive information from documentation.

---

### Initial Deliverable

**Documentation Inventory and Gap Report** — submit by appending to this file.

Recommended structure:
```
## [System Name] Lead — ECD-001 Documentation Inventory and Gap Report
**Submitted:** [date]
**Repository:** [repo URL]
**Branch:** [branch]
**Commit:** [latest commit SHA]

### Existing Documentation
[List what exists — docs, READMEs, inline comments, diagrams, runbooks]

### Inventory Against 14-Document Standard
[For each of the 14 documents: EXISTS / PARTIAL / MISSING]
[Note: if the 14-document standard has not been provided, flag this as a gap]

### Missing Documentation
[What is absent, undocumented, or only implicit in code]

### Unsupported Claims
[Capabilities described but not evidenced by tests or deployments]

### Security Concerns
[Known gaps, exposed credentials in history, hardcoded values, access controls]

### Knowledge Gaps
[Architectural decisions not recorded, history lost, unresolved defects]

### Implemented vs Planned vs Unverified Capabilities
[Distinguish clearly — do not conflate]
```

---

### Restrictions — Strictly Enforced

**No code modifications, deployments, database operations, credential rotation,
trading activation, feature development or integration changes are authorized
under this directive.**

Documentation changes require separate Commander authorization and reviewable
pull requests. Do not merge or deploy changes without approval.

---

### Chain of Command

Supreme Commander → ZED HQ Lead → System Leads

Questions or clarifications: append to this file. ZED HQ Lead reads at session start.

**— ZED HQ Lead | Dispatched 2026-10-17 18:53 UTC**


---

## EMPIRE CORRECTIVE DIRECTIVE ECD-001A — Dispatched by ZED HQ Lead — 2026-10-17 19:04 UTC

**From:** Supreme Commander Zeeshan Ali Khan
**Authority:** Supersedes and extends ECD-001
**Date:** 17 October 2026

---

### Empire Documentation Standard v1.0 — 14 Required Categories

```
1.  System Identity
2.  Architecture
3.  Component Inventory
4.  Deployment
5.  Data Model
6.  Integrations
7.  Governance
8.  Security and Risk
9.  Tests and Evidence
10. Known Issues
11. Development History
12. Roadmap
13. Asset Value
14. Operations and Recovery
```

**File location:** `docs/empire/` — numbered Markdown filenames
(e.g. `docs/empire/01-system-identity.md`, `docs/empire/02-architecture.md`)
Unless existing documentation covers the category without duplication.

---

### Required Submission — Updated

- Current repository, branch and **full commit SHA**
- Mapping of existing documents against all 14 categories (EXISTS / PARTIAL / MISSING)
- Missing information and unsupported capability claims
- Source references for significant implemented capabilities
- Known security, operational and integration risks
- Documentation-only implementation plan
- Proposed reviewable documentation PRs (do not merge without Commander authorization)

---

### Evidence Policy

Clearly distinguish:
- **Lead-reported:** your own assessment, not independently verified
- **Source-confirmed:** traceable to specific file, function, or schema
- **Production-verified:** confirmed by live operational evidence (logs, metrics, deployment records)
- **Unverified:** described or claimed but without traceable evidence

---

### Security Policy

Do not place credentials, API keys, passwords, private keys or other secrets in documentation.
Report exposed credentials through a restricted security channel without reproducing their values.

---

### Change Restrictions — Unchanged from ECD-001

No application code changes, deployments, database changes, credential rotations,
trading activation or feature development are authorized by this directive.

All documentation PRs require separate Commander authorization before merging.

---

Append your ECD-001A submission to this file.
ZED HQ Lead reads at session start.

**— ZED HQ Lead | 2026-10-17 19:04 UTC**
