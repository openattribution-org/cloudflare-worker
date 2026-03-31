# OpenAttribution Cloudflare Worker

A Cloudflare Worker that detects AI bot access to your site and reports `content_retrieved` telemetry events to the OpenAttribution API.

Works on all Cloudflare plans. Detection uses three tiers:

1. **verifiedBotCategory** (all plans) - Cloudflare's verified bot classification. Catches bots Cloudflare has confirmed as AI crawlers, assistants, or search indexers.
2. **Bot Management score** (Enterprise) - filters out verified non-AI bots (Googlebot, Bingbot, etc.) and high-score requests (likely human). Low-score unverified requests fall through to UA matching.
3. **User-agent matching** (fallback) - matches against ~40 known AI bot UA patterns when Cloudflare signals are unavailable.

## Quick start

```bash
npm install
cp wrangler.example.toml wrangler.toml
# Edit wrangler.toml: add your zone ID and routes
npx wrangler secret put OA_API_KEY
npm run dev
```

## Deployment

```bash
npm run deploy
```

## Configuration

| Variable | Where | Description |
|----------|-------|-------------|
| `OA_TELEMETRY_ENDPOINT` | `wrangler.toml` `[vars]` | OA API endpoint (default provided) |
| `OA_API_KEY` | wrangler secret | Your OA API key |
| `routes` | `wrangler.toml` | Which domains/paths the worker runs on |

## What data is sent

When an AI bot is detected, the worker sends a `content_retrieved` event containing:

- **Request:** URL, user-agent header, OA-Telemetry-ID (if present)
- **Classification:** bot category (`training`, `inference`, `search`), whether verified, detection method
- **Response:** HTTP status, response size (Content-Length), cache status
- **Network:** ASN, ASN organisation, country code, JA4 TLS fingerprint (Enterprise only)

No visitor IP addresses, cookies, or request bodies are sent. Static resources (CSS, JS, images, fonts) are skipped entirely.

## Limitations

Some AI bots are not detectable via user-agent alone:

- **OpenAI Operator** - disguises as Chrome, no identifiable UA
- **xAI Grok** - uses fake Safari user-agent strings
- **DeepSeek** - sometimes crawls without identification
- **Google AI training** - uses the standard Googlebot UA. Only distinguishable via Cloudflare's verifiedBotCategory.

On Enterprise plans with Bot Management, Cloudflare's verified bot classification catches these where possible.

## Licence

Apache 2.0
