# CLAUDE.md

Cloudflare Worker for OA edge telemetry. Detects AI bot access to a publisher's site and reports `content_retrieved` events to the OA API.

## Stack

TypeScript, Cloudflare Workers, wrangler v4.

## Commands

- `npm run dev` - local dev server via wrangler
- `npm run deploy` - deploy to Cloudflare
- `npm run typecheck` - strict TypeScript check (`tsc --noEmit`)

## How it works

Single-file worker (`src/index.ts`). Skips static resources, passes the request to origin immediately, then classifies in the background using three tiers:

1. **verifiedBotCategory** (all plans) - Cloudflare's verified bot classification
2. **Bot Management score** (Enterprise) - filters non-AI bots and likely humans, low-score unverified fall through to UA
3. **User-agent matching** (fallback) - ~40 known AI bot UA patterns

If classified as an AI bot, fires a `content_retrieved` event to the OA telemetry endpoint via `ctx.waitUntil`. Telemetry failures are silently swallowed - never surfaces errors to the publisher's visitors.

Bot categories: `training`, `inference`, `search`.

## Configuration

- `wrangler.toml` - routes, zone ID, `OA_TELEMETRY_ENDPOINT` env var
- `wrangler.example.toml` - template without zone-specific config
- `OA_API_KEY` - set via `npx wrangler secret put OA_API_KEY` (never in toml)

## Conventions

- British English
- Strict TypeScript (`skipLibCheck: false`)
