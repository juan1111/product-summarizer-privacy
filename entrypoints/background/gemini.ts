export type GeminiPayload = {
  title?: string;
  price?: string;
  description?: string;
  sellerProfile?: {
    name?: string;
    badges?: string[];
    metrics?: Record<string, string>;
  };
  reviews?: Array<{
    rating?: number;
    title?: string;
    body?: string;
    sentiment?: { label?: 'positive' | 'neutral' | 'negative'; score?: number };
  }>;
  skuOptions?: Array<{
    name?: string;
    values?: Array<{ name?: string }>;
  }>;
};

export type GeminiSummary = {
  descriptionSummary: string;
  reviewSummary: string;
  pros: string[];
  cons: string[];
  star5Summary: string;
  star4Summary: string;
  star3Summary: string;
  star2Summary: string;
  star1Summary: string;
  fraudRisk: 'low' | 'medium' | 'high';
  fraudScore: number;
  fraudVerdict: string;
  scamSignals: string[];
  productSignals: string[];
  storeSignals: string[];
};

const GEMINI_API_KEY = String((import.meta as any)?.env?.WXT_GEMINI_API_KEY ?? '').trim();

export async function summarizeWithGemini(payload: GeminiPayload): Promise<GeminiSummary> {
  const key = String(GEMINI_API_KEY ?? '').trim();
  if (!key) {
    throw new Error('Gemini API key is missing. Set WXT_GEMINI_API_KEY in .env.');
  }

  const model = 'gemini-2.5-flash-lite';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

  const prompt = buildGeminiPrompt(payload);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      generationConfig: {
        temperature: 0.2,
        topP: 0.9,
        maxOutputTokens: 900,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          required: [
            'descriptionSummary',
            'reviewSummary',
            'pros',
            'cons',
            'star5Summary',
            'star4Summary',
            'star3Summary',
            'star2Summary',
            'star1Summary',
            'fraudRisk',
            'fraudScore',
            'fraudVerdict',
            'scamSignals',
            'productSignals',
            'storeSignals',
          ],
          properties: {
            descriptionSummary: { type: 'STRING' },
            reviewSummary: { type: 'STRING' },
            pros: { type: 'ARRAY', items: { type: 'STRING' } },
            cons: { type: 'ARRAY', items: { type: 'STRING' } },
            star5Summary: { type: 'STRING' },
            star4Summary: { type: 'STRING' },
            star3Summary: { type: 'STRING' },
            star2Summary: { type: 'STRING' },
            star1Summary: { type: 'STRING' },
            fraudRisk: { type: 'STRING' },
            fraudScore: { type: 'NUMBER' },
            fraudVerdict: { type: 'STRING' },
            scamSignals: { type: 'ARRAY', items: { type: 'STRING' } },
            productSignals: { type: 'ARRAY', items: { type: 'STRING' } },
            storeSignals: { type: 'ARRAY', items: { type: 'STRING' } },
          },
        },
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
    }),
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.error?.message || `Gemini request failed (${res.status})`;
    throw new Error(msg);
  }

  const text = extractGeminiText(json);
  return parseGeminiSummary(text, payload);
}

function buildGeminiPrompt(payload: GeminiPayload): string {
  const title = (payload.title ?? '').trim();
  const price = (payload.price ?? '').trim();
  const description = (payload.description ?? '').trim();
  const sellerName = (payload.sellerProfile?.name ?? '').trim();
  const sellerBadges = Array.isArray(payload.sellerProfile?.badges)
    ? payload.sellerProfile.badges.filter(Boolean).slice(0, 12)
    : [];
  const sellerMetricsEntries = Object.entries(payload.sellerProfile?.metrics ?? {}).slice(0, 12);
  const reviews = Array.isArray(payload.reviews) ? payload.reviews : [];

  const variantLines = (payload.skuOptions ?? [])
    .map((opt) => {
      const name = (opt?.name ?? '').trim();
      const values = (opt?.values ?? [])
        .map((v) => (v?.name ?? '').trim())
        .filter(Boolean)
        .slice(0, 30);
      if (!name || values.length === 0) return '';
      return `${name}: ${values.join(', ')}`;
    })
    .filter(Boolean)
    .slice(0, 12);

  const positiveComments = collectSentimentComments(reviews, 'positive');
  const negativeComments = collectSentimentComments(reviews, 'negative');
  const neutralComments = collectSentimentComments(reviews, 'neutral').slice(0, 10);
  const star5Comments = collectStarComments(reviews, 5);
  const star4Comments = collectStarComments(reviews, 4);
  const star3Comments = collectStarComments(reviews, 3);
  const star2Comments = collectStarComments(reviews, 2);
  const star1Comments = collectStarComments(reviews, 1);
  const legitimacy = buildProductLegitimacySignals({ title, description, reviews });
  const reviewLines = reviews
    .filter((r) => (r?.body ?? '').trim().length > 0 || (r?.title ?? '').trim().length > 0)
    .slice(0, 30)
    .map((r, idx) => {
      const text = `${r?.title ?? ''} ${r?.body ?? ''}`.replace(/\s+/g, ' ').trim();
      return `${idx + 1}. ${text}`;
    });

  return [
    'You are a product feedback summarizer for e-commerce reviews.',
    'Generate concise and factual summaries in ENGLISH.',
    'Return JSON only with this exact schema:',
    '{',
    '  "descriptionSummary": string,',
    '  "reviewSummary": string,',
    '  "pros": string[],',
    '  "cons": string[],',
    '  "star5Summary": string,',
    '  "star4Summary": string,',
    '  "star3Summary": string,',
    '  "star2Summary": string,',
    '  "star1Summary": string,',
    '  "fraudRisk": "low" | "medium" | "high",',
    '  "fraudScore": number,',
    '  "fraudVerdict": string,',
    '  "scamSignals": string[],',
    '  "productSignals": string[],',
    '  "storeSignals": string[]',
    '}',
    'Rules:',
    '- descriptionSummary: 2-4 sentences summarizing what the product is, use description first.',
    '- If description is empty, infer from title + variants + review text.',
    '- reviewSummary: 2-4 sentences summarizing recurring user feedback using ONLY positive/negative comments below.',
    '- pros: 3-6 short bullet-like phrases based ONLY on positive_comments.',
    '- cons: 3-6 short bullet-like phrases based ONLY on negative_comments.',
    '- star5Summary: 1-3 sentences from 5-star comments only, after filtering nonsense/spam/non-product comments.',
    '- star4Summary: 1-3 sentences from 4-star comments only, after filtering nonsense/spam/non-product comments.',
    '- star3Summary: 1-3 sentences from 3-star comments only, after filtering nonsense/spam/non-product comments.',
    '- star2Summary: 1-3 sentences from 2-star comments only, after filtering nonsense/spam/non-product comments.',
    '- star1Summary: 1-3 sentences from 1-star comments only, after filtering nonsense/spam/non-product comments.',
    '- Return "Limited review evidence" ONLY when there are fewer than 2 meaningful comments for that star bucket.',
    '- fraudRisk: classify risk primarily from product legitimacy evidence (title, description, price plausibility, and reviews).',
    '- Weighting guideline for fraud assessment: Product+Reviews 80%, Seller/Store 20%.',
    '- Seller profile is only secondary context and must not dominate risk conclusion.',
    '- fraudScore: integer from 0 (very safe) to 100 (high scam risk).',
    '- fraudVerdict: 1-2 concise sentences with reason.',
    '- productSignals: 2-6 product-focused legitimacy/risk signals.',
    '- storeSignals: 2-6 seller/store trust-risk signals.',
    '- scamSignals: 3-8 combined high-priority risk/trust signals.',
    '- Never include descriptionSummary content inside reviewSummary.',
    '- If evidence is weak, say "Limited review evidence".',
    '- Do not include markdown, code fences, or extra keys.',
    '',
    `TITLE: ${title || 'N/A'}`,
    `PRICE: ${price || 'N/A'}`,
    `DESCRIPTION: ${description || 'N/A'}`,
    `SELLER_NAME: ${sellerName || 'N/A'}`,
    `SELLER_BADGES: ${sellerBadges.length ? sellerBadges.join(' | ') : 'N/A'}`,
    `SELLER_METRICS: ${
      sellerMetricsEntries.length
        ? sellerMetricsEntries.map(([k, v]) => `${k}: ${v}`).join(' | ')
        : 'N/A'
    }`,
    `PRODUCT_LEGIT_POSITIVE_SIGNALS: ${
      legitimacy.positive.length ? legitimacy.positive.join(' | ') : 'N/A'
    }`,
    `PRODUCT_LEGIT_RED_FLAGS: ${
      legitimacy.negative.length ? legitimacy.negative.join(' | ') : 'N/A'
    }`,
    `VARIANTS: ${variantLines.length ? variantLines.join(' | ') : 'N/A'}`,
    'POSITIVE_COMMENTS:',
    positiveComments.length ? positiveComments.join('\n') : 'N/A',
    'NEGATIVE_COMMENTS:',
    negativeComments.length ? negativeComments.join('\n') : 'N/A',
    'NEUTRAL_COMMENTS (optional context):',
    neutralComments.length ? neutralComments.join('\n') : 'N/A',
    'STAR_5_COMMENTS:',
    star5Comments.length ? star5Comments.join('\n') : 'N/A',
    `STAR_5_MEANINGFUL_COUNT: ${star5Comments.length}`,
    'STAR_4_COMMENTS:',
    star4Comments.length ? star4Comments.join('\n') : 'N/A',
    `STAR_4_MEANINGFUL_COUNT: ${star4Comments.length}`,
    'STAR_3_COMMENTS:',
    star3Comments.length ? star3Comments.join('\n') : 'N/A',
    `STAR_3_MEANINGFUL_COUNT: ${star3Comments.length}`,
    'STAR_2_COMMENTS:',
    star2Comments.length ? star2Comments.join('\n') : 'N/A',
    `STAR_2_MEANINGFUL_COUNT: ${star2Comments.length}`,
    'STAR_1_COMMENTS:',
    star1Comments.length ? star1Comments.join('\n') : 'N/A',
    `STAR_1_MEANINGFUL_COUNT: ${star1Comments.length}`,
    'RAW_REVIEW_CONTEXT (fallback only):',
    reviewLines.length ? reviewLines.join('\n') : 'N/A',
  ].join('\n');
}

function buildProductLegitimacySignals(input: {
  title: string;
  description: string;
  reviews: Array<{ title?: string; body?: string }>;
}): { positive: string[]; negative: string[] } {
  const text = `${input.title} ${input.description}`.toLowerCase();
  const reviewText = input.reviews
    .map((r) => `${r?.title ?? ''} ${r?.body ?? ''}`.toLowerCase())
    .join(' ');

  const positive: string[] = [];
  const negative: string[] = [];

  const has = (pattern: RegExp, source: string) => pattern.test(source);

  if (has(/\b(original|authentic|genuine|official|sealed)\b/i, text)) {
    positive.push('Product copy mentions original/authentic indicators');
  }
  if (has(/\b(warranty|with warranty|official warranty)\b/i, text)) {
    positive.push('Warranty terms present in listing');
  }
  if (has(/\b(brand new|new)\b/i, text)) {
    positive.push('Listing states product condition clearly');
  }

  if (has(/\b(replica|class\s*a|class-a|oem|imitation|copy|fake)\b/i, text)) {
    negative.push('Listing text contains potential counterfeit/replica terms');
  }
  if (has(/\b(no return|non-refundable|no refund)\b/i, text)) {
    negative.push('Strict return/refund terms may increase risk');
  }

  if (has(/\b(fake|counterfeit|not original|scam|refund|wrong item)\b/i, reviewText)) {
    negative.push('Reviews contain authenticity/scam/refund complaints');
  }
  if (has(/\b(original|authentic|legit)\b/i, reviewText)) {
    positive.push('Reviews include authenticity/legitimacy confirmations');
  }

  return {
    positive: Array.from(new Set(positive)).slice(0, 8),
    negative: Array.from(new Set(negative)).slice(0, 8),
  };
}

function collectSentimentComments(
  reviews: GeminiPayload['reviews'],
  target: 'positive' | 'neutral' | 'negative',
): string[] {
  const list = Array.isArray(reviews) ? reviews : [];
  const picked = list
    .filter((r) => {
      const label = r?.sentiment?.label;
      if (label) return label === target;

      const rating = Number(r?.rating ?? 0) || 0;
      if (target === 'positive') return rating >= 4;
      if (target === 'negative') return rating > 0 && rating <= 2;
      return rating === 3 || rating === 0;
    })
    .map((r) => `${r?.title ?? ''} ${(r?.body ?? '').trim()}`.replace(/\s+/g, ' ').trim())
    .filter((t) => t.length >= 6)
    .slice(0, 40);

  return picked.map((text, idx) => `${idx + 1}. ${text}`);
}

function collectStarComments(reviews: GeminiPayload['reviews'], star: number): string[] {
  const list = Array.isArray(reviews) ? reviews : [];
  const picked = list
    .filter((r) => Number(r?.rating ?? 0) === star)
    .map((r) => `${r?.title ?? ''} ${(r?.body ?? '').trim()}`.replace(/\s+/g, ' ').trim())
    .slice(0, 20);

  return picked.map((text, idx) => `${idx + 1}. ${text}`);
}

function extractGeminiText(json: any): string {
  const parts = json?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((p: any) => p?.text ?? '').join('\n').trim();
}

function parseGeminiSummary(raw: string, payload: GeminiPayload): GeminiSummary {
  const obj = safeParseGeminiObject(raw);
  const descriptionSummary = toCleanString(obj?.descriptionSummary);
  const reviewSummary = toCleanString(obj?.reviewSummary);
  const pros = toCleanStringArray(obj?.pros);
  const cons = toCleanStringArray(obj?.cons);
  const star5Summary = toCleanString(obj?.star5Summary);
  const star4Summary = toCleanString(obj?.star4Summary);
  const star3Summary = toCleanString(obj?.star3Summary);
  const star2Summary = toCleanString(obj?.star2Summary);
  const star1Summary = toCleanString(obj?.star1Summary);
  const productSignals = toCleanStringArray(obj?.productSignals);
  const storeSignals = toCleanStringArray(obj?.storeSignals);
  const scamSignals = toCleanStringArray(obj?.scamSignals);
  const fraudRiskRaw = toCleanString(obj?.fraudRisk).toLowerCase();
  const fraudRisk: 'low' | 'medium' | 'high' =
    fraudRiskRaw === 'high' ? 'high' : fraudRiskRaw === 'medium' ? 'medium' : 'low';
  const fraudScore = clampFraudScore(obj?.fraudScore);
  const fraudVerdict = toCleanString(obj?.fraudVerdict);
  const tuned = tuneFraudRiskWithSentiment(payload, {
    fraudRisk,
    fraudScore,
    fraudVerdict,
    signals: [...productSignals, ...storeSignals, ...scamSignals],
  });

  return {
    descriptionSummary: descriptionSummary || 'No AI summary generated.',
    reviewSummary: reviewSummary || 'No review summary generated.',
    pros: pros.length ? pros : ['Limited review evidence'],
    cons: cons.length ? cons : ['Limited review evidence'],
    star5Summary: star5Summary || 'Limited review evidence',
    star4Summary: star4Summary || 'Limited review evidence',
    star3Summary: star3Summary || 'Limited review evidence',
    star2Summary: star2Summary || 'Limited review evidence',
    star1Summary: star1Summary || 'Limited review evidence',
    fraudRisk: tuned.fraudRisk,
    fraudScore: tuned.fraudScore,
    fraudVerdict: tuned.fraudVerdict || 'Limited evidence to assess scam risk.',
    productSignals: productSignals.length ? productSignals : ['Limited product evidence'],
    storeSignals: storeSignals.length ? storeSignals : ['Limited store evidence'],
    scamSignals:
      scamSignals.length
        ? scamSignals
        : [...productSignals, ...storeSignals].slice(0, 8).filter(Boolean),
  };
}

function stripCodeFence(s: string): string {
  const trimmed = String(s ?? '').trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed.replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```[\s\S]*$/, '').trim();
}

function safeParseGeminiObject(raw: string): any {
  const candidates = buildJsonCandidates(raw);
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      continue;
    }
  }

  const fallbackText = stripCodeFence(String(raw ?? '').trim());
  return {
    descriptionSummary: 'No AI summary generated.',
    reviewSummary: fallbackText.slice(0, 500),
    pros: [],
    cons: [],
    star5Summary: 'Limited review evidence',
    star4Summary: 'Limited review evidence',
    star3Summary: 'Limited review evidence',
    star2Summary: 'Limited review evidence',
    star1Summary: 'Limited review evidence',
    fraudRisk: 'low',
    fraudScore: 0,
    fraudVerdict: 'Limited evidence to assess scam risk.',
    scamSignals: [],
    productSignals: [],
    storeSignals: [],
  };
}

function buildJsonCandidates(raw: string): string[] {
  const base = stripCodeFence(String(raw ?? '').trim());
  const picked = pickFirstJsonObject(base);
  const candidates = [base, picked].filter(Boolean) as string[];

  const sanitized = candidates.map((txt) =>
    txt
      .replace(/\u0000/g, ' ')
      .replace(/\r/g, ' ')
      .replace(/\t/g, ' ')
      .replace(/\n(?=(?:[^"]*"[^"]*")*[^"]*$)/g, ' '),
  );

  return Array.from(new Set([...candidates, ...sanitized]));
}

function pickFirstJsonObject(text: string): string {
  const start = text.indexOf('{');
  if (start === -1) return '';

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return text.slice(start);
}

function toCleanString(value: any): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function toCleanStringArray(value: any): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => toCleanString(v)).filter(Boolean).slice(0, 8);
}

function clampFraudScore(value: any): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}








function tuneFraudRiskWithSentiment(
  payload: GeminiPayload,
  input: {
    fraudRisk: 'low' | 'medium' | 'high';
    fraudScore: number;
    fraudVerdict: string;
    signals: string[];
  },
): {
  fraudRisk: 'low' | 'medium' | 'high';
  fraudScore: number;
  fraudVerdict: string;
} {
  const reviews = Array.isArray(payload.reviews) ? payload.reviews : [];
  let positive = 0;
  let negative = 0;

  for (const r of reviews) {
    const label = r?.sentiment?.label;
    if (label === 'positive') {
      positive++;
      continue;
    }
    if (label === 'negative') {
      negative++;
      continue;
    }

    const rating = Number(r?.rating ?? 0);
    if (rating >= 4) positive++;
    else if (rating > 0 && rating <= 2) negative++;
  }

  const evidenceText = `${input.fraudVerdict} ${(input.signals ?? []).join(' ')}`.toLowerCase();
  const strongPattern =
    /\b(scam|fake|counterfeit|not original|wrong item|did not receive|not delivered|no delivery|refund denied|refused refund|bait and switch|bogus)\b/g;
  const strongHits = (evidenceText.match(strongPattern) ?? []).length;

  const dominantPositive = positive >= 5 && positive >= negative + 4;
  const veryLowNegative = negative <= 1;

  if (dominantPositive && veryLowNegative && strongHits === 0) {
    return {
      fraudRisk: 'low',
      fraudScore: Math.min(input.fraudScore, 30),
      fraudVerdict: alignVerdictToRisk('low', input.fraudVerdict),
    };
  }

  if (input.fraudRisk === 'medium' && dominantPositive && strongHits <= 1) {
    return {
      fraudRisk: 'low',
      fraudScore: Math.min(input.fraudScore, 34),
      fraudVerdict: alignVerdictToRisk('low', input.fraudVerdict),
    };
  }

  return {
    ...input,
    fraudVerdict: alignVerdictToRisk(input.fraudRisk, input.fraudVerdict),
  };
}

function alignVerdictToRisk(
  risk: 'low' | 'medium' | 'high',
  verdict: string,
): string {
  const text = String(verdict ?? '').trim();
  if (!text) return '';

  if (risk === 'low') {
    return text
      .replace(/\bhigh\s+fraud\s+risk\b/gi, 'low fraud risk')
      .replace(/\bmedium\s+fraud\s+risk\b/gi, 'low fraud risk')
      .replace(/\bmoderate\s+fraud\s+risk\b/gi, 'low fraud risk')
      .replace(/\bhigh\s+risk\b/gi, 'low risk')
      .replace(/\bmedium\s+risk\b/gi, 'low risk')
      .replace(/\bmoderate\s+risk\b/gi, 'low risk');
  }

  if (risk === 'medium') {
    return text
      .replace(/\blow\s+fraud\s+risk\b/gi, 'medium fraud risk')
      .replace(/\bhigh\s+fraud\s+risk\b/gi, 'medium fraud risk')
      .replace(/\blow\s+risk\b/gi, 'medium risk')
      .replace(/\bhigh\s+risk\b/gi, 'medium risk');
  }

  return text
    .replace(/\blow\s+fraud\s+risk\b/gi, 'high fraud risk')
    .replace(/\bmedium\s+fraud\s+risk\b/gi, 'high fraud risk')
    .replace(/\blow\s+risk\b/gi, 'high risk')
    .replace(/\bmedium\s+risk\b/gi, 'high risk');
}




