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
//   3. User-agent matching (fallback) - ~50 known AI bot UA patterns
//
// Not catchable via UA: OpenAI Operator (disguises as Chrome), xAI Grok (fake
// Safari UA), DeepSeek (sometimes unidentified), Google AI training (uses the
// Googlebot UA - only distinguishable via verifiedBotCategory).

const AI_BOT_PATTERNS = [
	// Training crawlers
	[/GPTBot/i, 'GPTBot', 'training'],
	[/ClaudeBot/i, 'ClaudeBot', 'training'],
	[/CCBot/i, 'CCBot', 'training'],
	[/GoogleOther/i, 'GoogleOther', 'training'],
	[/Bytespider/i, 'Bytespider', 'training'],
	[/Diffbot/i, 'Diffbot', 'training'],
	[/Applebot-Extended/i, 'Applebot-Extended', 'training'],
	[/cohere-ai/i, 'cohere-ai', 'training'],
	[/FacebookBot/i, 'FacebookBot', 'training'],
	[/meta-externalagent/i, 'meta-externalagent', 'training'],
	[/Amazonbot/i, 'Amazonbot', 'training'],
	[/DeepSeekBot/i, 'DeepSeekBot', 'training'],
	[/AI2Bot/i, 'AI2Bot', 'training'],
	[/PanguBot/i, 'PanguBot', 'training'],
	[/ChatGLM-Spider/i, 'ChatGLM-Spider', 'training'],
	[/Timpibot/i, 'Timpibot', 'training'],
	[/omgili/i, 'omgili', 'training'],
	[/ImagesiftBot/i, 'ImagesiftBot', 'training'],
	[/FirecrawlAgent/i, 'FirecrawlAgent', 'training'],
	[/xAI-Bot/i, 'xAI-Bot', 'training'],
	[/Google-CloudVertexBot/i, 'Google-CloudVertexBot', 'training'],
	[/HuggingFace-Bot/i, 'HuggingFace-Bot', 'training'],
	[/Brightbot/i, 'Brightbot', 'training'],
	[/Webzio-Extended/i, 'Webzio-Extended', 'training'],
	[/TerraCotta/i, 'TerraCotta', 'training'],
	// Inference fetchers (user-triggered, real time)
	[/ChatGPT-User/i, 'ChatGPT-User', 'inference'],
	[/ChatGPT-Browser/i, 'ChatGPT-Browser', 'inference'],
	[/Claude-User/i, 'Claude-User', 'inference'],
	[/Perplexity-User/i, 'Perplexity-User', 'inference'],
	[/MistralAI-User/i, 'MistralAI-User', 'inference'],
	[/Amzn-User/i, 'Amzn-User', 'inference'],
	[/meta-externalfetcher/i, 'meta-externalfetcher', 'inference'],
	[/Google-Agent/i, 'Google-Agent', 'inference'],
	[/GoogleAgent-Mariner/i, 'GoogleAgent-Mariner', 'inference'],
	[/Gemini-Deep-Research/i, 'Gemini-Deep-Research', 'inference'],
	[/Google-NotebookLM/i, 'Google-NotebookLM', 'inference'],
	[/DuckAssistBot/i, 'DuckAssistBot', 'inference'],
	[/PhindBot/i, 'PhindBot', 'inference'],
	[/Cohere-Command/i, 'Cohere-Command', 'inference'],
	[/Devin\/[\d.]+/i, 'Devin', 'inference'],
	// AI search indexers
	[/OAI-SearchBot/i, 'OAI-SearchBot', 'search'],
	[/Claude-SearchBot/i, 'Claude-SearchBot', 'search'],
	[/PerplexityBot/i, 'PerplexityBot', 'search'],
	[/YouBot/i, 'YouBot', 'search'],
	[/PetalBot/i, 'PetalBot', 'search'],
	[/Bravebot/i, 'Bravebot', 'search'],
	[/AzureAI-SearchBot/i, 'AzureAI-SearchBot', 'search'],
	[/meta-webindexer/i, 'meta-webindexer', 'search'],
	[/ExaBot/i, 'ExaBot', 'search'],
	[/Andibot/i, 'Andibot', 'search'],
];

// Cloudflare's verifiedBotCategory -> OA bot_category. Available on every plan.
const CF_CATEGORY = {
	'AI Crawler': 'training',
	'AI Assistant': 'inference',
	'AI Search': 'search',
};

const STATIC_EXT = /\.(css|js|jpg|jpeg|png|gif|svg|ico|woff2?|ttf|eot|map|webp|avif|mp4|webm)$/i;

function matchUserAgent(ua) {
	for (const [pattern, name, category] of AI_BOT_PATTERNS) {
		if (pattern.test(ua)) return { name, category };
	}
	return null;
}

function classify(request) {
	const cf = request.cf || {};
	const bm = cf.botManagement;
	const uaMatch = matchUserAgent(request.headers.get('user-agent') || '');

	// verifiedBotCategory is available on all plans. If Cloudflare has
	// categorised this as an AI bot, trust it for the category, but still pull
	// the bot name from the UA when we recognise it.
	const aiCategory = CF_CATEGORY[cf.verifiedBotCategory];
	if (aiCategory) {
		return {
			name: uaMatch ? uaMatch.name : null,
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
	if (uaMatch) {
		return {
			name: uaMatch.name,
			category: uaMatch.category,
			verified: false,
			detection: bm ? 'bot_management' : 'user_agent',
			ja4: bm && bm.ja4,
		};
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

			const userAgent = request.headers.get('user-agent');
			const event = {
				id: crypto.randomUUID(),
				type: 'content_retrieved',
				timestamp: new Date().toISOString(),
				content_url: request.url,
				source_role: 'edge',
				content_telemetry_id: request.headers.get('Content-Telemetry-ID') || undefined,
				data: {
					...(userAgent ? { user_agent: userAgent } : {}),
					...(hit.name ? { bot_name: hit.name } : {}),
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
					body: JSON.stringify({ schema_version: '0.1', events: [event] }),
				}).catch(() => {}),
			);
		}

		return response;
	},
};
