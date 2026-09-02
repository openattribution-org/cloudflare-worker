# CLAUDE.md

Cloudflare Worker for OA edge telemetry. Detects AI bot access to a publisher's site and reports `content_retrieved` events to the OA API.

## Stack

TypeScript, Cloudflare Workers, wrangler v4.

## Commands

- `npm run dev` - local dev server via wrangler
- `npm run deploy` - deploy to Cloudflare
- `npm run typecheck` - strict TypeScript check (`tsc --noEmit`)

## Files

- `src/index.ts` - the worker, TypeScript, deployed via `wrangler` (this is `main` in `wrangler.toml`).
- `worker.js` - the same logic in plain JavaScript, single self-contained file, for pasting into the Cloudflare dashboard editor (no build step). **Keep it in sync with `src/index.ts` - change both together.** The hosted-sites docs guide (`openattribution.org/docs/integrations/hosted-sites`) embeds a copy of `worker.js`.

## How it works

Skips static resources, passes the request to origin immediately, then classifies in the background using three tiers:

1. **verifiedBotCategory** (all plans) - Cloudflare's verified bot classification
2. **Bot Management score** (Enterprise) - filters non-AI bots and likely humans, low-score unverified fall through to UA
3. **User-agent matching** (fallback) - ~40 known AI bot UA patterns

If classified as an AI bot, fires a `content_retrieved` event to the OA telemetry endpoint via `ctx.waitUntil`. Telemetry failures are silently swallowed - never surfaces errors to the publisher's visitors.

Access purposes (`purpose`, open enum): `training`, `inference`, `search`, `advertising`.

## Configuration

- `wrangler.toml` - routes, zone ID, `OA_TELEMETRY_ENDPOINT` env var
- `wrangler.example.toml` - template without zone-specific config
- `OA_API_KEY` - set via `npx wrangler secret put OA_API_KEY` (never in toml). A content-owner key (`oat_pub_...`) with `telemetry:write` scope for the publisher's verified domain - the worker reports events about that site, so it does not use a platform (`oat_pk_...`) key.

## Conventions

- British English
- Strict TypeScript (`skipLibCheck: false`)
