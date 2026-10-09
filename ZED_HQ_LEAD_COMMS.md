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
