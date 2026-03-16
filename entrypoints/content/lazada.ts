import { ScrapeResult, sleep, stripHtml } from './shared';
import { analyzeReviewsSentiment } from './sentiment';

export async function scrapeLazadaData(): Promise<ScrapeResult> {
  const moduleData = extractLazadaModuleData();
  if (!moduleData) throw new Error('Not on a Lazada product page (no __moduleData__ found).');

  const root = moduleData?.data?.root?.fields;
  if (!root) throw new Error('Unexpected __moduleData__ structure.');

  const product = root.product;
  const primaryKey = root.tracking?.primaryKey;
  const skuInfos = root.skuInfos;

  const title = product?.title ?? document.title ?? '';
  const price = await resolveLazadaPrice();
  const description = await resolveLazadaDescription(product?.desc ?? '');

  const defaultSkuId = primaryKey?.defaultSkuId ?? '0';
  const galleries = root.skuGalleries?.[defaultSkuId] ?? root.skuGalleries?.['0'] ?? [];
  const images: string[] = galleries
    .map((g: any) => (g.src?.startsWith('//') ? `https:${g.src}` : g.src))
    .filter(Boolean);

  const skuOptions = root.productOption?.skuBase?.properties ?? [];
  const itemId = root.tracking?.primaryKey?.itemId ?? primaryKey?.itemId ?? extractLazadaItemIdFromUrl();
  const sellerId = skuInfos?.[defaultSkuId]?.sellerId ?? skuInfos?.['0']?.sellerId ?? '';
  const sellerProfile = extractLazadaSellerProfile();
  const ratingText = await resolveLazadaRatingText();
  const totalReviewsText = document.querySelector('.container-star-v2-count')?.textContent?.trim() ?? '';

  const reviewData = await chrome.runtime.sendMessage({ type: 'FETCH_REVIEWS', itemId });
  if (reviewData?.error) {
    throw new Error(reviewData.error);
  }
  const reviews = reviewData?.reviews ?? [];
  const sentiment = analyzeReviewsSentiment(reviews);
  const rating = ratingText ? Number(ratingText) || null : null;
  const totalReviews = Number(totalReviewsText.replace(/[^\d]/g, '')) || 0;

  return {
    platform: 'lazada',
    title,
    price,
    description,
    images,
    skuOptions,
    itemId,
    sellerId,
    sellerProfile,
    reviews: sentiment.reviews,
    rating,
    totalReviews,
    sentiment: sentiment.summary,
    url: window.location.href,
  };
}

function extractLazadaModuleData(): any {
  for (const script of document.querySelectorAll('script')) {
    const text = script.textContent ?? '';
    if (!text.includes('__moduleData__')) continue;

    const marker = 'var __moduleData__ = ';
    const start = text.indexOf(marker);
    if (start === -1) continue;

    const jsonStart = start + marker.length;
    let depth = 0;
    let i = jsonStart;
    for (; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
    }

    try {
      return JSON.parse(text.slice(jsonStart, i));
    } catch {
      continue;
    }
  }

  return null;
}

function extractLazadaPrice(): string {
  const selectors = [
    '[class*="pdp-price_size_xl"]',
    '[class*="pdp-price"] [class*="currentStr"]',
    '[class*="pdp-mod-product-price-amount"]',
    '[class*="price--current"]',
    '.pdp-price_type_normal',
    '[data-spm="price"] span',
    '.pdp-v2-product-price-content-salePrice',
  ];

  for (const sel of selectors) {
    const text = document.querySelector(sel)?.textContent?.trim();
    if (text) return text;
  }

  for (const span of document.querySelectorAll('span')) {
    const text = span.textContent?.trim() ?? '';
    if (/^\u20B1[\d,]+/.test(text) && span.children.length === 0) return text;
  }

  return 'N/A';
}

function extractLazadaItemIdFromUrl(): string {
  return window.location.pathname.match(/-i(\d+)-/)?.[1] ?? '';
}

async function resolveLazadaPrice(): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const price = extractLazadaPrice();
    if (price && price !== 'N/A') return price;
    await sleep(350);
  }
  return extractLazadaPrice();
}

async function resolveLazadaRatingText(): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const ratingText =
      document.querySelector('.score-average')?.textContent?.trim() ??
      document.querySelector('.container-star-v2-score')?.textContent?.trim() ??
      '';
    if (ratingText) return ratingText;
    await sleep(350);
  }

  return (
    document.querySelector('.score-average')?.textContent?.trim() ??
    document.querySelector('.container-star-v2-score')?.textContent?.trim() ??
    ''
  );
}

async function resolveLazadaDescription(rawHtml: string): Promise<string> {
  const initial = stripHtml(rawHtml ?? '');
  if (initial) return initial;

  const selectors = [
    '[class*="pdp-product-desc"]',
    '[class*="detail-desc"]',
    '[class*="product-description"]',
    '[data-spm="detail"]',
  ];

  for (let i = 0; i < 8; i++) {
    for (const sel of selectors) {
      const text = document.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      if (text.length >= 10) return text;
    }
    await sleep(350);
  }

  return initial;
}

function extractLazadaSellerProfile() {
  const nameSelectors = [
    '[class*="seller-name"]',
    '[class*="pdp-shop-name"]',
    'a[href*="/shop/"]',
  ];

  let name = '';
  for (const sel of nameSelectors) {
    const text = document.querySelector(sel)?.textContent?.trim();
    if (text && text.length >= 2) {
      name = text;
      break;
    }
  }

  const badgePatterns = [
    /seller ratings?\s*\d+%/i,
    /top\s*\d+\s*seller/i,
    /\d+\s*[- ]?year/i,
    /preferred seller/i,
    /quick repl/i,
    /official store/i,
    /mall/i,
  ];

  const badges = Array.from(document.querySelectorAll('span,div,a'))
    .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter((t) => t.length > 0 && t.length <= 60)
    .filter((t) => badgePatterns.some((rx) => rx.test(t)))
    .slice(0, 12);

  const metrics: Record<string, string> = {};
  for (const badge of badges) {
    if (/seller ratings?/i.test(badge)) metrics['seller_rating'] = badge;
    if (/top\s*\d+\s*seller/i.test(badge)) metrics['seller_rank'] = badge;
    if (/\d+\s*[- ]?year/i.test(badge)) metrics['store_age'] = badge;
    if (/quick repl/i.test(badge)) metrics['response_time'] = badge;
  }

  return {
    name: name || 'Unknown Seller',
    badges: Array.from(new Set(badges)),
    metrics,
  };
}
