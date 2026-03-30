# OpenAttribution Cloudflare Worker

A Cloudflare Worker that detects AI bot access to your site and reports `content_retrieved` telemetry events to the OpenAttribution API. Works on all Cloudflare plans - uses Bot Management on Enterprise, falls back to user-agent matching on Free/Pro.

## Quick start

```bash
npm install
cp wrangler.example.toml wrangler.toml
# Edit wrangler.toml to add your zone ID and routes
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

## Licence

Apache 2.0
