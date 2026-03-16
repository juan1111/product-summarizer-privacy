export interface Review {
  author: string;
  rating: number;
  date: string;
  title: string;
  body: string;
  verified: boolean;
  images: string[];
  sentiment?: ReviewSentiment;
  fraudFlags?: string[];
}

export interface ScrapeResult {
  platform?: 'lazada' | 'shopee';
  title: string;
  price: string;
  description: string;
  images: string[];
  skuOptions: any[];
  itemId: string;
  sellerId: string;
  sellerProfile?: SellerProfile;
  reviews: Review[];
  rating: number | null;
  totalReviews: number;
  sentiment?: SentimentSummary;
  aiSummary?: AiSummary;
  url: string;
  error?: string;
}

export type SentimentLabel = 'positive' | 'neutral' | 'negative';

export interface ReviewSentiment {
  score: number;
  label: SentimentLabel;
}

export interface SentimentSummary {
  overall: SentimentLabel;
  avgScore: number;
  positive: number;
  neutral: number;
  negative: number;
  mismatchCount: number;
  mismatchRate: number;
  processedReviews: number;
}

export interface AiSummary {
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
}

export interface SellerProfile {
  name: string;
  badges: string[];
  metrics: Record<string, string>;
}

export function stripHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

export function normalizeSpaces(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

