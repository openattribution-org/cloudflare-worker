// OpenAttribution Cloudflare Worker - single file, no build step.
//
// This is the same logic as src/index.ts, in plain JavaScript, so it can be
// pasted straight into the Cloudflare dashboard's Worker editor (no `wrangler`,
// no `npm install`). If you deploy with `wrangler`, use src/index.ts instead -
// keep the two in sync.
//
// Detects AI crawlers / assistants and reports `content_retrieved` telemetry
// events to the OA API. Requires two settings on the Worker:
//   OA_TELEMETRY_ENDPOINT  (text)    e.g. https://telemetry.openattribution.org/events
//   OA_API_KEY             (secret)  a content-owner key, oat_pub_..., telemetry:write scope
//
// Detection tiers:
//   1. Cloudflare's verifiedBotCategory (all plans)
//   2. Bot Management score (Enterprise) - skips verified non-AI bots and likely humans
//   3. User-agent matching (fallback) - ~40 known AI bot UA patterns
//
// Not catchable via UA: OpenAI Operator (disguises as Chrome), xAI Grok (fake
// Safari UA), DeepSeek (sometimes unidentified), Google AI training (uses the
// Googlebot UA - only distinguishable via verifiedBotCategory).

const AI_BOT_PATTERNS = [
	// Training crawlers
	[/GPTBot/i, 'training'],
	[/ClaudeBot/i, 'training'],
	[/CCBot/i, 'training'],
	[/GoogleOther/i, 'training'],
	[/Bytespider/i, 'training'],
	[/Diffbot/i, 'training'],
	[/Applebot-Extended/i, 'training'],
	[/cohere-ai/i, 'training'],
	[/FacebookBot/i, 'training'],
	[/meta-externalagent/i, 'training'],
	[/Amazonbot/i, 'training'],
	[/DeepSeekBot/i, 'training'],
	[/AI2Bot/i, 'training'],
	[/PanguBot/i, 'training'],
	[/ChatGLM-Spider/i, 'training'],
	[/Timpibot/i, 'training'],
	[/omgili/i, 'training'],
	[/ImagesiftBot/i, 'training'],
	[/FirecrawlAgent/i, 'training'],
	// Inference fetchers (user-triggered, real time)
	[/ChatGPT-User/i, 'inference'],
	[/Claude-User/i, 'inference'],
	[/Perplexity-User/i, 'inference'],
	[/MistralAI-User/i, 'inference'],
	[/Amzn-User/i, 'inference'],
	[/meta-externalfetcher/i, 'inference'],
	[/Google-Agent/i, 'inference'],
	[/Gemini-Deep-Research/i, 'inference'],
	[/Google-NotebookLM/i, 'inference'],
	[/DuckAssistBot/i, 'inference'],
	[/PhindBot/i, 'inference'],
	// AI search indexers
	[/OAI-SearchBot/i, 'search'],
	[/Claude-SearchBot/i, 'search'],
	[/PerplexityBot/i, 'search'],
	[/YouBot/i, 'search'],
	[/PetalBot/i, 'search'],
	[/Bravebot/i, 'search'],
	[/AzureAI-SearchBot/i, 'search'],
	[/meta-webindexer/i, 'search'],
	[/ExaBot/i, 'search'],
];

// Cloudflare's verifiedBotCategory -> OA bot_category. Available on every plan.
const CF_CATEGORY = {
	'AI Crawler': 'training',
	'AI Assistant': 'inference',
	'AI Search': 'search',
};

const STATIC_EXT = /\.(css|js|jpg|jpeg|png|gif|svg|ico|woff2?|ttf|eot|map|webp|avif|mp4|webm)$/i;

function classify(request) {
	const cf = request.cf || {};
	const bm = cf.botManagement;

	// verifiedBotCategory is available on all plans. If Cloudflare has
	// categorised this as an AI bot, trust it.
	const aiCategory = CF_CATEGORY[cf.verifiedBotCategory];
	if (aiCategory) {
		return {
			category: aiCategory,
			verified: bm && typeof bm.verifiedBot === 'boolean' ? bm.verifiedBot : true,
			detection: 'bot_management',
			ja4: bm && bm.ja4,
		};
	}

	// Enterprise Bot Management: skip verified non-AI bots (Googlebot, Bingbot,
	// Pingdom, etc.) and high-score requests (likely human).
	if (bm && typeof bm.score === 'number') {
		if (bm.verifiedBot || bm.score >= 30) return null;
	}

	// UA pattern matching - Free/Pro fallback, or low-score unverified on Enterprise.
	const ua = request.headers.get('user-agent') || '';
	for (const [pattern, category] of AI_BOT_PATTERNS) {
		if (pattern.test(ua)) {
			return {
				category,
				verified: false,
				detection: bm ? 'bot_management' : 'user_agent',
				ja4: bm && bm.ja4,
			};
		}
	}

	return null;
}

export default {
	async fetch(request, env, ctx) {
		// Static assets: pass straight through, don't classify.
		if (STATIC_EXT.test(new URL(request.url).pathname)) {
			return fetch(request);
		}

		const response = await fetch(request);

		const hit = classify(request);
		if (hit) {
			const cf = request.cf || {};
			const contentLength = response.headers.get('content-length');
			const cacheStatus = response.headers.get('cf-cache-status');

			const event = {
				id: crypto.randomUUID(),
				type: 'content_retrieved',
				timestamp: new Date().toISOString(),
				content_url: request.url,
				source_role: 'edge',
				oa_telemetry_id: request.headers.get('OA-Telemetry-ID') || undefined,
				data: {
					user_agent: request.headers.get('user-agent'),
					bot_category: hit.category,
					verified: hit.verified,
					detection: hit.detection,
					response_status: response.status,
					...(contentLength ? { response_bytes: parseInt(contentLength, 10) } : {}),
					...(cacheStatus ? { cache_status: cacheStatus.toLowerCase() } : {}),
					asn: cf.asn,
					asn_org: cf.asOrganization,
					country: cf.country,
					...(hit.ja4 ? { ja4: hit.ja4 } : {}),
				},
			};

			// Fire and forget - runs after the response is sent, never blocks or
			// breaks the page; telemetry failures are swallowed on purpose.
			ctx.waitUntil(
				fetch(env.OA_TELEMETRY_ENDPOINT, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'X-API-Key': env.OA_API_KEY,
					},
					body: JSON.stringify({ events: [event] }),
				}).catch(() => {}),
			);
		}

		return response;
	},
};
