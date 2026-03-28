interface Env {
	OA_TELEMETRY_ENDPOINT: string;
	OA_API_KEY: string;
}

// Known AI bot user agents - fallback for Free/Pro plans without Bot Management
const AI_BOT_PATTERNS: Array<{ pattern: RegExp; category: 'training' | 'inference' | 'search' }> = [
	// Training crawlers
	{ pattern: /GPTBot/i, category: 'training' },
	{ pattern: /ClaudeBot/i, category: 'training' },
	{ pattern: /Google-Extended/i, category: 'training' },
	{ pattern: /CCBot/i, category: 'training' },
	{ pattern: /anthropic-ai/i, category: 'training' },
	{ pattern: /Bytespider/i, category: 'training' },
	{ pattern: /Diffbot/i, category: 'training' },
	{ pattern: /Applebot-Extended/i, category: 'training' },
	{ pattern: /cohere-ai/i, category: 'training' },
	{ pattern: /FacebookBot/i, category: 'training' },
	{ pattern: /meta-externalagent/i, category: 'training' },

	// Inference fetchers (user-triggered, real-time)
	{ pattern: /ChatGPT-User/i, category: 'inference' },
	{ pattern: /Perplexity-User/i, category: 'inference' },
	{ pattern: /PerplexityBot/i, category: 'inference' },
	{ pattern: /Claude-Web/i, category: 'inference' },
	{ pattern: /You\.com/i, category: 'inference' },

	// AI search
	{ pattern: /OAI-SearchBot/i, category: 'search' },
	{ pattern: /GoogleOther/i, category: 'search' },
];

// Cloudflare VerifiedBotCategory → OA bot_category
const CATEGORY_MAP: Record<string, 'training' | 'inference' | 'search'> = {
	'AI Crawler': 'training',
	'AI Assistant': 'inference',
	'AI Search': 'search',
};

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		// Pass request to origin immediately
		const response = await fetch(request);

		const match = classify(request);
		if (match) {
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
					asn: (request as any).cf?.asn,
					asn_org: (request as any).cf?.asOrganization,
					country: (request as any).cf?.country,
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
	category: 'training' | 'inference' | 'search';
	verified: boolean;
	detection: 'bot_management' | 'user_agent';
	ja4?: string;
}

function classify(request: Request): Classification | null {
	const cf = (request as any).cf;
	const bm = cf?.botManagement;

	// Enterprise: use Bot Management signals
	if (bm && typeof bm.score === 'number') {
		const isAiBot = bm.score < 30 || bm.verifiedBot;
		if (!isAiBot) return null;

		const category = CATEGORY_MAP[cf?.verifiedBotCategory] || 'training';
		return {
			category,
			verified: bm.verifiedBot ?? false,
			detection: 'bot_management',
			ja4: bm.ja4,
		};
	}

	// Free/Pro: match against known AI bot user agents
	const ua = request.headers.get('user-agent') || '';
	for (const bot of AI_BOT_PATTERNS) {
		if (bot.pattern.test(ua)) {
			return {
				category: bot.category,
				verified: false,
				detection: 'user_agent',
			};
		}
	}

	return null;
}
