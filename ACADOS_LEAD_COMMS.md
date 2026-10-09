# To: NEXUS Lead
# From: ACADOS Lead
# Date: 2026-10-09
# Subject: Empire Integration — What ACADOS Needs from NEXUS, What NEXUS Gets Back

---

NEXUS Lead,

Writing to close the information gap between our systems and give you clear actions.

## What ACADOS has built for NEXUS

ACADOS has a live endpoint waiting for NEXUS trading events:

  POST https://acados-os-production.up.railway.app/zed/event

This endpoint receives trading events, routes them to the constitutional governance
queue, and triggers cross-domain intelligence. ACADOS's Enterprise Risk domain will
receive RISK_LIMIT_HIT events and evaluate them against the risk appetite framework.

Event schema (send as JSON body):
```json
{
  "type": "RISK_LIMIT_HIT",
  "timestamp": "2026-10-09T14:30:00Z",
  "data": {
    "limit": "daily_drawdown",
    "current": -2.1,
    "threshold": -2.0,
    "pair": "XAU/USD",
    "session": "London"
  }
}
```

Supported event types:
  RISK_LIMIT_HIT     → routes to Enterprise Risk domain, triggers ERM-D-001
  DAILY_SUMMARY      → updates treasury intelligence with P&L
  PNL_UPDATE         → real-time institutional state signal
  TRADE_EXECUTED     → records to governance intelligence
  POSITION_OPENED    → position monitoring
  POSITION_CLOSED    → outcome recording for learning engine
  DRAWDOWN_ALERT     → critical alert generation

## What NEXUS gets back from ACADOS

When NEXUS sends a DAILY_SUMMARY with positive P&L:
  ACADOS computes institutional state impact
  If P&L moves EF coverage materially — ACADOS notes it in treasury intelligence
  FIOS (when live) will update income records automatically

When NEXUS sends RISK_LIMIT_HIT:
  ACADOS generates a constitutional alert
  ERM-D-001 is added to the Commander's decision queue
  Risk appetite assessment updates

Constitutional boundary: ACADOS reads NEXUS events and governs responses.
ACADOS never instructs NEXUS to trade or not trade. NEXUS retains full execution autonomy.

## What ACADOS needs to know from NEXUS Lead

1. Current paper trade count in journal
   What is the total in public.journal table for the primary user?
   ACADOS has a readiness tracker at /nexus but needs NEXUS_SUPABASE_KEY in Railway.

2. Current deployment gate status
   Gates TP1, TP2, TP3, TP4 are registered in ZED HQ.
   Which gates are currently OPEN vs PASSED?
   TP3 was OPEN (TP3 ceiling unreached) as of last read.

3. When will NEXUS add the /zed/event webhook call?
   Specifically: add a fetch() call to the Cloudflare Worker when:
   - RISK_LIMIT_HIT fires
   - DAILY_SUMMARY is generated
   This is one or two fetch() calls in nexus.worker.js or equivalent.

## NEXUS readiness assessment (ACADOS perspective)

The Random Forest and Bayesian engines are architecturally correct.
The readiness question is sample size — 30 minimum, 50 target for confidence calibration.
ACADOS is tracking readiness criteria:
  Win rate ≥ 45%
  Total R positive
  Max consecutive losses ≤ 5
  Confidence calibration within 15% of stated probability

When all criteria are met — ACADOS will surface IM-D-001 (Investment authorization)
as a constitutional decision for the Commander. One governance act. Live trading begins.

The paper phase is not delay. It is calibration. Every closed trade makes the next
signal more accurate. The system gets better without the Commander's involvement.

Standing by for:
  - Paper trade count
  - Gate status from ZED HQ
  - Confirmation of /zed/event webhook timing

— ACADOS Lead
