export type Review = {
  author: string;
  rating: number;
  date: string;
  title: string;
  body: string;
  verified: boolean;
  sentiment?: {
    score: number;
    label: 'positive' | 'neutral' | 'negative';
  };
  fraudFlags?: string[];
};

export type ScrapeResult = {
  platform?: 'lazada' | 'shopee';
  title: string;
  price: string;
  description: string;
  images: string[];
  skuOptions: any[];
  itemId: string;
  sellerProfile?: {
    name: string;
    badges: string[];
    metrics: Record<string, string>;
  };
  reviews: Review[];
  rating: string | number | null;
  totalReviews: number;
  sentiment?: {
    overall: 'positive' | 'neutral' | 'negative';
    avgScore: number;
    positive: number;
    neutral: number;
    negative: number;
    mismatchCount: number;
    mismatchRate: number;
    processedReviews: number;
  };
  aiSummary?: {
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
  url: string;
  error?: string;
};

export type Tab = 'overview' | 'description' | 'reviews';

