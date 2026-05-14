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
const AI_BOT_PATTERNS: Array<{ pattern: RegExp; name: string; category: BotCategory }> = [
	// Training crawlers
	{ pattern: /GPTBot/i, name: 'GPTBot', category: 'training' },
	{ pattern: /ClaudeBot/i, name: 'ClaudeBot', category: 'training' },
	{ pattern: /CCBot/i, name: 'CCBot', category: 'training' },
	{ pattern: /GoogleOther/i, name: 'GoogleOther', category: 'training' },
	{ pattern: /Bytespider/i, name: 'Bytespider', category: 'training' },
	{ pattern: /Diffbot/i, name: 'Diffbot', category: 'training' },
	{ pattern: /Applebot-Extended/i, name: 'Applebot-Extended', category: 'training' },
	{ pattern: /cohere-ai/i, name: 'cohere-ai', category: 'training' },
	{ pattern: /FacebookBot/i, name: 'FacebookBot', category: 'training' },
	{ pattern: /meta-externalagent/i, name: 'meta-externalagent', category: 'training' },
	{ pattern: /Amazonbot/i, name: 'Amazonbot', category: 'training' },
	{ pattern: /DeepSeekBot/i, name: 'DeepSeekBot', category: 'training' },
	{ pattern: /AI2Bot/i, name: 'AI2Bot', category: 'training' },
	{ pattern: /PanguBot/i, name: 'PanguBot', category: 'training' },
	{ pattern: /ChatGLM-Spider/i, name: 'ChatGLM-Spider', category: 'training' },
	{ pattern: /Timpibot/i, name: 'Timpibot', category: 'training' },
	{ pattern: /omgili/i, name: 'omgili', category: 'training' },
	{ pattern: /ImagesiftBot/i, name: 'ImagesiftBot', category: 'training' },
	{ pattern: /FirecrawlAgent/i, name: 'FirecrawlAgent', category: 'training' },
	{ pattern: /xAI-Bot/i, name: 'xAI-Bot', category: 'training' },
	{ pattern: /Google-CloudVertexBot/i, name: 'Google-CloudVertexBot', category: 'training' },
	{ pattern: /HuggingFace-Bot/i, name: 'HuggingFace-Bot', category: 'training' },
	{ pattern: /Brightbot/i, name: 'Brightbot', category: 'training' },
	{ pattern: /Webzio-Extended/i, name: 'Webzio-Extended', category: 'training' },
	{ pattern: /TerraCotta/i, name: 'TerraCotta', category: 'training' },

	// Inference fetchers (user-triggered, real-time)
	{ pattern: /ChatGPT-User/i, name: 'ChatGPT-User', category: 'inference' },
	{ pattern: /ChatGPT-Browser/i, name: 'ChatGPT-Browser', category: 'inference' },
	{ pattern: /Claude-User/i, name: 'Claude-User', category: 'inference' },
	{ pattern: /Perplexity-User/i, name: 'Perplexity-User', category: 'inference' },
	{ pattern: /MistralAI-User/i, name: 'MistralAI-User', category: 'inference' },
	{ pattern: /Amzn-User/i, name: 'Amzn-User', category: 'inference' },
	{ pattern: /meta-externalfetcher/i, name: 'meta-externalfetcher', category: 'inference' },
	{ pattern: /Google-Agent/i, name: 'Google-Agent', category: 'inference' },
	{ pattern: /GoogleAgent-Mariner/i, name: 'GoogleAgent-Mariner', category: 'inference' },
	{ pattern: /Gemini-Deep-Research/i, name: 'Gemini-Deep-Research', category: 'inference' },
	{ pattern: /Google-NotebookLM/i, name: 'Google-NotebookLM', category: 'inference' },
	{ pattern: /DuckAssistBot/i, name: 'DuckAssistBot', category: 'inference' },
	{ pattern: /PhindBot/i, name: 'PhindBot', category: 'inference' },
	{ pattern: /Cohere-Command/i, name: 'Cohere-Command', category: 'inference' },
	{ pattern: /Devin\/[\d.]+/i, name: 'Devin', category: 'inference' },

	// AI search indexers
	{ pattern: /OAI-SearchBot/i, name: 'OAI-SearchBot', category: 'search' },
	{ pattern: /Claude-SearchBot/i, name: 'Claude-SearchBot', category: 'search' },
	{ pattern: /PerplexityBot/i, name: 'PerplexityBot', category: 'search' },
	{ pattern: /YouBot/i, name: 'YouBot', category: 'search' },
	{ pattern: /PetalBot/i, name: 'PetalBot', category: 'search' },
	{ pattern: /Bravebot/i, name: 'Bravebot', category: 'search' },
	{ pattern: /AzureAI-SearchBot/i, name: 'AzureAI-SearchBot', category: 'search' },
	{ pattern: /meta-webindexer/i, name: 'meta-webindexer', category: 'search' },
	{ pattern: /ExaBot/i, name: 'ExaBot', category: 'search' },
	{ pattern: /Andibot/i, name: 'Andibot', category: 'search' },
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
				id: crypto.randomUUID(),
				type: 'content_retrieved',
				timestamp: new Date().toISOString(),
				content_url: request.url,
				source_role: 'edge',
				oa_telemetry_id: request.headers.get('OA-Telemetry-ID') || undefined,
				data: {
					user_agent: request.headers.get('user-agent'),
					...(match.name ? { bot_name: match.name } : {}),
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
	name: string | null;
	category: BotCategory;
	verified: boolean;
	detection: 'bot_management' | 'user_agent';
	ja4?: string;
}

function matchUserAgent(ua: string): { name: string; category: BotCategory } | null {
	for (const bot of AI_BOT_PATTERNS) {
		if (bot.pattern.test(ua)) return { name: bot.name, category: bot.category };
	}
	return null;
}

function classify(request: Request): Classification | null {
	const cf = (request as any).cf;
	const bm = cf?.botManagement;
	const uaMatch = matchUserAgent(request.headers.get('user-agent') || '');

	// Cloudflare's verifiedBotCategory is available on all plans.
	// If CF has categorised this as an AI bot, trust that classification for
	// the category but still pull the bot name from the UA when we recognise it.
	const aiCategory = CATEGORY_MAP[cf?.verifiedBotCategory];
	if (aiCategory) {
		return {
			name: uaMatch?.name ?? null,
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
	if (uaMatch) {
		return {
			name: uaMatch.name,
			category: uaMatch.category,
			verified: false,
			detection: bm ? 'bot_management' : 'user_agent',
			ja4: bm?.ja4,
		};
	}

	return null;
}
