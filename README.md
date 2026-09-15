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
npx wrangler secret put OA_API_KEY   # your oat_pub_ key, telemetry:write scope
npm run dev
```

The worker reports events about your own site, so it uses a content-owner key
(`oat_pub_...`) issued with `telemetry:write` scope for your verified domain - not
a platform (`oat_pk_...`) key.

## Deployment

```bash
npm run deploy
```

## No terminal? Paste it into the dashboard

[`worker.js`](worker.js) is a single self-contained file (the same logic as
`src/index.ts`, in plain JavaScript). If you don't want to use `wrangler`:

1. Cloudflare dashboard → **Workers & Pages** → **Create application** → **Create Worker** → **Deploy** the placeholder, then **Edit code** and paste `worker.js`.
2. The Worker's **Settings → Variables and Secrets**: add `OA_TELEMETRY_ENDPOINT` (text, `https://telemetry.openattribution.org/events`) and `OA_API_KEY` (secret, your `oat_pub_` key). Optionally add `OA_MANIFEST_REF` (text) if you publish a manifest.
3. The Worker's **Settings → Domains & Routes**: add `yoursite.com/*` and `*.yoursite.com/*`.

There's a full click-by-click walkthrough - including putting a free Cloudflare
account in front of a Squarespace/Wix/Webflow site - at
<https://openattribution.org/docs/integrations/hosted-sites>.

`src/index.ts` (TypeScript, wrangler) and `worker.js` (plain JS, paste) are kept
in sync; change both together.

## Configuration

| Variable | Where | Description |
|----------|-------|-------------|
| `OA_TELEMETRY_ENDPOINT` | `wrangler.toml` `[vars]` | OA API endpoint (default provided) |
| `OA_API_KEY` | wrangler secret | Content-owner key (`oat_pub_...`) with `telemetry:write` scope for your domain |
| `OA_MANIFEST_REF` | `wrangler.toml` `[vars]` (optional) | URL of your `/.well-known/content-telemetry.json` manifest, sent as `manifest_ref` (spec 7.1) |
| `routes` | `wrangler.toml` | Which domains/paths the worker runs on |

## What data is sent

When an AI bot completes a `GET` with a `2xx` response, the worker sends a `content_retrieved` event containing:

- **Request:** URL (canonical URL from a `Link: rel="canonical"` response header when present, with the fetched URL as `request_url`), user-agent header, Content-Telemetry-ID (if present)
- **Classification:** access purpose (`training`, `inference`, `search`, `advertising` - an open enum), whether verified, detection method
- **Response:** HTTP status, response size (Content-Length), cache status
- **Network:** ASN, ASN organisation, country code, JA4 TLS fingerprint (Enterprise only)

The event follows the Content Telemetry v1 edge profile (spec section 6.2). Network fields describe the request path, not the client: no visitor IP addresses (raw or hashed - v1 withdrew the `ip_hash` field, spec 9.1), cookies, or request bodies are sent. Static resources (CSS, JS, images, fonts) are skipped entirely.

## What counts as a retrieval

The worker follows the v1 occurrence boundary (spec 4.3): one event per completed fetch of a content representation.

- **Reported:** `GET` requests answered with `2xx`
- **Not reported:** redirects (the chain is reported once, at the `2xx` it resolves to), `304` revalidations, `4xx`/`5xx` responses, and non-`GET` methods such as `HEAD`

## Coverage

Coverage is not `complete` (spec 5.7.6), so don't declare it as such in a manifest or in terms:

- Static files are out of scope by file extension, including images and video
- Detection misses bots that disguise their user-agent (see Limitations)
- A telemetry POST that fails is dropped, not retried

## Limitations

Some AI bots are not detectable via user-agent alone:

- **OpenAI Operator** - disguises as Chrome, no identifiable UA
- **xAI Grok** - uses fake Safari user-agent strings
- **DeepSeek** - sometimes crawls without identification
- **Google AI training** - uses the standard Googlebot UA. Only distinguishable via Cloudflare's verifiedBotCategory.

On Enterprise plans with Bot Management, Cloudflare's verified bot classification catches these where possible.

## Licence

Apache 2.0
