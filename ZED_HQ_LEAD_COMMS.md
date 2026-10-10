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
