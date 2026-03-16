import { Review, SentimentLabel, SentimentSummary, normalizeSpaces } from './shared';

// Domain lexicon for mixed English/Filipino e-commerce reviews.
// Positive words use positive weights, negative words use negative weights.
const LEXICON: Record<string, number> = {
  // English positive
  good: 2,
  great: 3,
  excellent: 4,
  amazing: 3.5,
  awesome: 3.2,
  perfect: 3.5,
  durable: 2.2,
  sturdy: 2,
  comfy: 2,
  comfortable: 2.2,
  worth: 1.8,
  affordable: 2,
  cheap: 1.5,
  cheapbutgood: 2.2,
  premium: 1.8,
  genuine: 2.5,
  authentic: 2.6,
  original: 2.5,
  nice: 2,
  love: 3,
  satisfied: 2,
  happy: 2.2,
  recommended: 2,
  legit: 2,
  fast: 1.5,
  mabilis: 1.8,
  bilis: 1.5,
  mabilisdelivery: 2.2,
  mabilisdumating: 2.3,
  mabilisnaship: 2.1,
  packedwell: 1.8,
  wellpacked: 2,
  securepackaging: 1.9,
  quality: 1.2,
  highquality: 2.2,
  qualityproduct: 2.1,
  works: 1.8,
  working: 1.8,
  functional: 1.8,
  useful: 1.5,
  sulitna: 2.3,
  sulitprice: 2.1,
  valueformoney: 2.4,
  bangforbuck: 2.3,
  mustbuy: 2.4,
  trusted: 2.2,
  reliable: 2.2,
  smooth: 1.4,
  clean: 1.2,
  neat: 1.1,
  okaynaokay: 2.2,
  sobrangganda: 3.2,
  superganda: 3.1,
  superokay: 2.5,
  sobrangokay: 2.5,
  highlyrecommended: 3.2,
  fivestar: 2.8,

  // Filipino / Taglish positive
  sulit: 2.2,
  panalo: 2.4,
  maayos: 2.1,
  maayospackaging: 2.3,
  maayoskausap: 1.9,
  qualitytalaga: 2.1,
  ganda: 2,
  maganda: 2.5,
  gandanganda: 2.9,
  matibay: 2.3,
  tibay: 2,
  ayosnaayos: 2.2,
  ayos: 1.5,
  okay: 1,
  ok: 1,
  swak: 1.7,
  swakpresyo: 2,
  mura: 2,
  muranganda: 2.6,
  mabango: 1.6,
  cute: 1.4,
  sulitbilhin: 2.3,
  sulitnaman: 2,
  hindinakakadisappoint: 2.3,
  walangsira: 2.1,
  mabilisangdelivery: 2.1,
  angganda: 2.6,
  okaynaman: 1.4,

  // English negative
  bad: -2.5,
  poor: -2.2,
  terrible: -3.5,
  awful: -3.4,
  worst: -3.8,
  disappointing: -2.8,
  disappointed: -2.5,
  useless: -2.7,
  inaccurate: -2.2,
  wrong: -1.8,
  lowquality: -2.4,
  cheaplymade: -2.2,
  uncomfortable: -2.3,
  overpriced: -2,
  expensive: -1.6,
  delayedshipment: -2.1,
  late: -1.6,
  leak: -2.5,
  leaking: -2.6,
  rust: -2.1,
  rusty: -2.3,
  faded: -1.8,
  incomplete: -2.3,
  missing: -2.2,
  fake: -3,
  defective: -3.2,
  broken: -3,
  damageditem: -3.1,
  dented: -2.4,
  torn: -2.2,
  slow: -1.5,
  delayed: -1.7,
  return: -1.6,
  replacement: -1.2,
  complaint: -1.5,
  refund: -1.4,
  scam: -4,

  // Filipino / Taglish negative
  pangit: -2.5,
  diokay: -1.8,
  hindiokay: -2,
  hindiayos: -2.1,
  hindimaganda: -2.6,
  hindiokayquality: -2.4,
  diquality: -1.7,
  bagsak: -2.2,
  sablay: -2.4,
  palpak: -2.7,
  sayangpera: -3,
  walangkwenta: -3.2,
  nakakadisappoint: -2.8,
  nakakainis: -2.2,
  nakakafrustrate: -2.3,
  matagal: -1.8,
  antagal: -2,
  angtagal: -2,
  mabagal: -1.7,
  kulangparts: -2.4,
  maliitem: -2.5,
  malingitem: -2.8,
  peke: -3.2,
  siraulo: -1.2,
  durog: -2.8,
  yupi: -2,
  gasgas: -2,
  kupas: -1.9,
  amoychemical: -1.8,
  amoyplastic: -1.4,
  maingay: -1.5,
  mahina: -1.8,
  mabilismasira: -2.8,
  madalingmasira: -2.9,
  sira: -3,
  basag: -2.8,
  mali: -1.8,
  kulang: -1.6,
  mahal: -1.2,
  damaged: -2.7,
  notworth: -2.5,
};

const NEGATORS = new Set([
  'not',
  "don't",
  "didn't",
  "isn't",
  "wasn't",
  'never',
  'no',
  'wala',
  'hindi',
  'di',
]);

const INTENSIFIERS: Record<string, number> = {
  very: 1.4,
  super: 1.5,
  sobrang: 1.5,
  masyado: 1.3,
  talaga: 1.2,
  really: 1.3,
  medyo: 0.8,
  quite: 1.1,
};

export function analyzeReviewsSentiment(reviews: Review[]): {
  reviews: Review[];
  summary: SentimentSummary;
} {
  let positive = 0;
  let neutral = 0;
  let negative = 0;
  let scoreSum = 0;
  let mismatchCount = 0;

  const enriched = reviews.map((review) => {
    // Score the combined review title + body text.
    const text = normalizeSpaces(`${review.title ?? ''} ${review.body ?? ''}`.trim());
    const score = computeSentimentScore(text);
    const label = labelFromScore(score);
    const fraudFlags: string[] = [];

    // Flag potential inconsistency: polarity vs star rating.
    if (isSentimentRatingMismatch(label, Number(review.rating ?? 0))) {
      fraudFlags.push('sentiment_rating_mismatch');
      mismatchCount++;
    }

    if (label === 'positive') positive++;
    else if (label === 'negative') negative++;
    else neutral++;
    scoreSum += score;

    return {
      ...review,
      sentiment: { score, label },
      fraudFlags,
    };
  });

  const processed = enriched.length;
  const avgScore = processed > 0 ? scoreSum / processed : 0;
  const overall = labelFromScore(avgScore);

  return {
    reviews: enriched,
    summary: {
      overall,
      avgScore: round2(avgScore),
      positive,
      neutral,
      negative,
      mismatchCount,
      mismatchRate: processed > 0 ? round2(mismatchCount / processed) : 0,
      processedReviews: processed,
    },
  };
}

function computeSentimentScore(text: string): number {
  if (!text) return 0;

  const tokens = tokenize(text);
  let score = 0;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const base = LEXICON[t];
    if (!base) continue;

    let val = base;
    const prev = tokens[i - 1] ?? '';
    const prev2 = tokens[i - 2] ?? '';

    // Intensifiers amplify/soften nearby sentiment (e.g., "very good").
    if (INTENSIFIERS[prev]) val *= INTENSIFIERS[prev];
    if (INTENSIFIERS[prev2]) val *= INTENSIFIERS[prev2];

    // Negators flip polarity (e.g., "not good" => negative).
    if (NEGATORS.has(prev) || NEGATORS.has(prev2)) {
      val *= -1;
    }

    score += val;
  }

  // Normalize raw score to a bounded VADER-like range.
  return normalizeVaderLike(score);
}

function tokenize(text: string): string[] {
  // Keep words/apostrophes, drop urls/punctuation, lowercase, split whitespace.
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => t.replace(/\s+/g, ''));
}

function normalizeVaderLike(raw: number): number {
  if (raw === 0) return 0;
  const normalized = raw / Math.sqrt(raw * raw + 15);
  return round2(normalized);
}

function labelFromScore(score: number): SentimentLabel {
  // VADER-like polarity thresholds.
  if (score >= 0.05) return 'positive';
  if (score <= -0.05) return 'negative';
  return 'neutral';
}

function isSentimentRatingMismatch(label: SentimentLabel, rating: number): boolean {
  // Possible suspicious/low-quality feedback pattern.
  if (!rating) return false;
  if (rating >= 4 && label === 'negative') return true;
  if (rating <= 2 && label === 'positive') return true;
  return false;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
