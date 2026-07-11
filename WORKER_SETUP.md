# NEXUS ZED — Cloudflare Worker Setup Guide

## What this Worker does

Single Worker that handles ALL server-side operations for NEXUS ZED:

| Endpoint     | Purpose                                   | Cache TTL |
|-------------|-------------------------------------------|-----------|
| `/prices`   | All 6 market feeds in one request         | 10s       |
| `/ohlc`     | OHLC candles from Twelve Data (Pro only)  | 1min–1day |
| `/cot`      | CFTC COT report (gold 088691)             | 7 days    |
| `/fred`     | CPI + Fed Funds Rate from FRED            | 24 hours  |
| `/calendar` | Forex Factory economic calendar           | 1 hour    |
| `/health`   | Connection test + config diagnostics      | no cache  |
| `/tier`     | Returns current user tier                 | no cache  |

## Step-by-step deployment

### Prerequisites
- Cloudflare account (free at cloudflare.com)
- Node.js installed (for Wrangler CLI)

### 1. Install Wrangler
```bash
npm install -g wrangler
wrangler login
```

### 2. Create KV Namespace
In Cloudflare dashboard → Workers & Pages → KV → Create namespace
Name it: `NEXUS_CACHE`
Copy the Namespace ID

### 3. Update wrangler.toml
Replace `REPLACE_WITH_YOUR_KV_NAMESPACE_ID` with your actual KV namespace ID

### 4. Set secrets
```bash
wrangler secret put TWELVE_DATA_KEY
# Enter your Twelve Data API key

wrangler secret put NEXUS_PRO_SECRET
# Enter any random 32-char string, e.g.: openssl rand -hex 16
```

### 5. Deploy
```bash
wrangler deploy
```

You'll get a URL like: `https://nexus-zed-worker.YOUR_SUBDOMAIN.workers.dev`

### 6. Configure NEXUS ZED
Open the dashboard → Settings (avatar icon) → Data Sources tab
Paste the Worker URL and click "Test Connection"

## Tier system

| Tier  | Prices   | OHLC | Rate limit |
|-------|----------|------|------------|
| Free  | 15-min delay | ✗ | 360/hour  |
| Pro   | Live     | ✓  | 2000/hour  |
| Edge  | Live     | ✓  | 2000/hour  |

For launch, you can set all users to 'pro' by setting `NEXUS_PRO_SECRET` 
and sharing it with subscribers. Supabase JWT validation replaces this 
in Phase 4 (monetisation layer).

## Cost

- **Cloudflare Workers Free tier**: 100,000 req/day — covers ~0 subscribers
- **Workers Paid ($5/mo)**: 10M req/day — covers 500 subscribers polling every 10s
- **KV reads**: 100K/day free, then $0.50 per million
- **Twelve Data Grow ($29/mo)**: 800 API calls/day (Worker caches aggressively)

**Total at launch**: $29/mo (Twelve Data only, everything else free tier)
**Total at 500 subs**: $34/mo ($5 Workers Paid + $29 Twelve Data)

## Response format

### /prices
```json
{
  "ts": 1720000000000,
  "gold":  { "price": 3382.45, "ch": 12.37, "source": "twelve_data" },
  "dxy":   { "price": 104.52,  "ch": 0.28,  "source": "twelve_data" },
  "yield": { "price": 4.28,    "ch": -0.05, "source": "fred" },
  "oil":   { "price": 78.43,   "ch": 0.62,  "source": "stooq" },
  "spx":   { "price": 5348.21, "ch": 18.50, "source": "twelve_data" },
  "vix":   { "price": 18.5,    "ch": -0.3,  "source": "twelve_data" },
  "sources": { "gold": "live", "dxy": "live", ... }
}
```

### /ohlc?tf=15min&bars=100
```json
{
  "tf": "15min",
  "symbol": "XAU/USD", 
  "bars": 100,
  "candles": [
    { "t": 1720000000000, "o": 3380.0, "h": 3385.5, "l": 3378.2, "c": 3382.4, "v": 0 },
    ...
  ],
  "source": "twelve_data"
}
```

### /cot
```json
{
  "latest": {
    "date": "2025-07-04",
    "mmNet": 185432,
    "prodNet": -220156,
    "mmPctile": 78
  },
  "signal": "LONG",
  "mmPctile": 78,
  "weekRange": 8,
  "nextUpdate": "2025-07-11T21:30:00.000Z"
}
```
