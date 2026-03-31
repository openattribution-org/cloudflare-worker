interface Env {
	OA_TELEMETRY_ENDPOINT: string;
	OA_API_KEY: string;
}

type BotCategory = 'training' | 'inference' | 'search';

// Known AI bot user agents - fallback when Cloudflare's verifiedBotCategory is unavailable.
//
// Not catchable via UA: OpenAI Operator (disguises as Chrome), xAI Grok (uses
// fake Safari UA), DeepSeek (sometimes crawls without identification).
//
// Google-Extended is a robots.txt-only token - Google always crawls with the
// Googlebot UA regardless of purpose. Google AI training crawls are only
// distinguishable via Cloudflare's verifiedBotCategory ("AI Crawler").
const AI_BOT_PATTERNS: Array<{ pattern: RegExp; category: BotCategory }> = [
	// Training crawlers
	{ pattern: /GPTBot/i, category: 'training' },
	{ pattern: /ClaudeBot/i, category: 'training' },
	{ pattern: /CCBot/i, category: 'training' },
	{ pattern: /GoogleOther/i, category: 'training' },
	{ pattern: /Bytespider/i, category: 'training' },
	{ pattern: /Diffbot/i, category: 'training' },
	{ pattern: /Applebot-Extended/i, category: 'training' },
	{ pattern: /cohere-ai/i, category: 'training' },
	{ pattern: /FacebookBot/i, category: 'training' },
	{ pattern: /meta-externalagent/i, category: 'training' },
	{ pattern: /Amazonbot/i, category: 'training' },
	{ pattern: /DeepSeekBot/i, category: 'training' },
	{ pattern: /AI2Bot/i, category: 'training' },
	{ pattern: /PanguBot/i, category: 'training' },
	{ pattern: /ChatGLM-Spider/i, category: 'training' },
	{ pattern: /Timpibot/i, category: 'training' },
	{ pattern: /omgili/i, category: 'training' },
	{ pattern: /ImagesiftBot/i, category: 'training' },
	{ pattern: /FirecrawlAgent/i, category: 'training' },

	// Inference fetchers (user-triggered, real-time)
	{ pattern: /ChatGPT-User/i, category: 'inference' },
	{ pattern: /Claude-User/i, category: 'inference' },
	{ pattern: /Perplexity-User/i, category: 'inference' },
	{ pattern: /MistralAI-User/i, category: 'inference' },
	{ pattern: /Amzn-User/i, category: 'inference' },
	{ pattern: /meta-externalfetcher/i, category: 'inference' },
	{ pattern: /Google-Agent/i, category: 'inference' },
	{ pattern: /Gemini-Deep-Research/i, category: 'inference' },
	{ pattern: /Google-NotebookLM/i, category: 'inference' },
	{ pattern: /DuckAssistBot/i, category: 'inference' },
	{ pattern: /PhindBot/i, category: 'inference' },

	// AI search indexers
	{ pattern: /OAI-SearchBot/i, category: 'search' },
	{ pattern: /Claude-SearchBot/i, category: 'search' },
	{ pattern: /PerplexityBot/i, category: 'search' },
	{ pattern: /YouBot/i, category: 'search' },
	{ pattern: /PetalBot/i, category: 'search' },
	{ pattern: /Bravebot/i, category: 'search' },
	{ pattern: /AzureAI-SearchBot/i, category: 'search' },
	{ pattern: /meta-webindexer/i, category: 'search' },
	{ pattern: /ExaBot/i, category: 'search' },
];

// Cloudflare verifiedBotCategory → OA bot_category
const CATEGORY_MAP: Record<string, BotCategory> = {
	'AI Crawler': 'training',
	'AI Assistant': 'inference',
	'AI Search': 'search',
};

const STATIC_EXT = /\.(css|js|jpg|jpeg|png|gif|svg|ico|woff2?|ttf|eot|map|webp|avif|mp4|webm)$/i;

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		// Skip static resources early
		if (STATIC_EXT.test(new URL(request.url).pathname)) {
			return fetch(request);
		}

		const response = await fetch(request);

		const match = classify(request);
		if (match) {
			const cf = (request as any).cf;
			const cacheHeader = response.headers.get('cf-cache-status');
			const contentLength = response.headers.get('content-length');

			const event = {
				type: 'content_retrieved',
				timestamp: new Date().toISOString(),
				content_url: request.url,
				source_role: 'edge',
				oa_telemetry_id: request.headers.get('OA-Telemetry-ID') || undefined,
				data: {
					user_agent: request.headers.get('user-agent'),
					bot_category: match.category,
					verified: match.verified,
					detection: match.detection,
					response_status: response.status,
					...(contentLength ? { response_bytes: parseInt(contentLength, 10) } : {}),
					...(cacheHeader ? { cache_status: cacheHeader.toLowerCase() } : {}),
					asn: cf?.asn,
					asn_org: cf?.asOrganization,
					country: cf?.country,
					...(match.ja4 ? { ja4: match.ja4 } : {}),
				},
			};

			ctx.waitUntil(
				fetch(env.OA_TELEMETRY_ENDPOINT, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'X-API-Key': env.OA_API_KEY,
					},
					body: JSON.stringify({ events: [event] }),
				}).catch(() => {
					// Telemetry failures must not surface to the publisher's visitors
				}),
			);
		}

		return response;
	},
};

interface Classification {
	category: BotCategory;
	verified: boolean;
	detection: 'bot_management' | 'user_agent';
	ja4?: string;
}

function classify(request: Request): Classification | null {
	const cf = (request as any).cf;
	const bm = cf?.botManagement;

	// Cloudflare's verifiedBotCategory is available on all plans.
	// If CF has categorised this as an AI bot, trust that classification.
	const aiCategory = CATEGORY_MAP[cf?.verifiedBotCategory];
	if (aiCategory) {
		return {
			category: aiCategory,
			verified: bm?.verifiedBot ?? true,
			detection: 'bot_management',
			ja4: bm?.ja4,
		};
	}

	// Enterprise Bot Management: skip verified non-AI bots (Googlebot, Bingbot,
	// Pingdom, etc.) and high-score requests (likely human).
	if (bm && typeof bm.score === 'number') {
		if (bm.verifiedBot || bm.score >= 30) return null;
	}

	// UA pattern matching - Free/Pro fallback, or low-score unverified on Enterprise
	const ua = request.headers.get('user-agent') || '';
	for (const bot of AI_BOT_PATTERNS) {
		if (bot.pattern.test(ua)) {
			return {
				category: bot.category,
				verified: false,
				detection: bm ? 'bot_management' : 'user_agent',
				ja4: bm?.ja4,
			};
		}
	}

	return null;
}
