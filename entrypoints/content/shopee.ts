import { Review, ScrapeResult, normalizeSpaces, sleep } from './shared';
import { analyzeReviewsSentiment } from './sentiment';

type ShopeeReviewContext = {
  shopId: string;
  itemId: string;
  ratingsJson: any;
};

type CancelCheck = () => boolean;

export async function scrapeShopeeData(isCancelled: CancelCheck = () => false): Promise<ScrapeResult> {
  throwIfCancelled(isCancelled);
  const ids = extractShopeeIdsFromUrlOrDom();
  if (!ids) throw new Error('Could not detect Shopee item/shop ID from this page.');

  const { itemId, shopId } = ids;
  const productApiUrl = `https://shopee.ph/api/v4/pdp/get_pc?item_id=${itemId}&shop_id=${shopId}`;
  const ratingsApiUrl = `https://shopee.ph/api/v2/item/get_ratings?shopid=${shopId}&itemid=${itemId}&limit=20&offset=0&type=0&filter=0`;

  const [productJson, ratingsJson] = await Promise.all([
    fetchShopeeJsonWithRetry(productApiUrl, 5, isCancelled),
    fetchShopeeJsonWithRetry(ratingsApiUrl, 4, isCancelled),
  ]);
  throwIfCancelled(isCancelled);
  const item = productJson?.data?.item ?? {};

  const title = item?.name ?? extractShopeeTitleFromDom() ?? document.title ?? '';
  const description = await resolveShopeeDescription(item?.description ?? '', isCancelled);
  const price = await resolveShopeePrice(item, isCancelled);
  const initialRatingRaw = item?.item_rating?.rating_star ?? extractShopeeRatingFromDom();

  let images = extractShopeeImagesFromApi(item);
  if (images.length === 0) images = extractShopeeImagesFromDom();

  const skuOptions = extractShopeeSkuOptions(item, productJson);
  const sellerProfile = extractShopeeSellerProfile();
  const rawReviews = await collectShopeeReviews({ shopId, itemId, ratingsJson }, isCancelled);
  const cleanedReviews = cleanupShopeeReviews(rawReviews);
  throwIfCancelled(isCancelled);
  const sentiment = analyzeReviewsSentiment(cleanedReviews);
  const rating = await resolveShopeeRating(initialRatingRaw, sentiment.reviews, isCancelled);
  const totalReviews = Number(
    item?.cmt_count ?? ratingsJson?.data?.item_rating_summary?.rating_total ?? sentiment.reviews.length ?? 0,
  );

  return {
    platform: 'shopee',
    title,
    price,
    description,
    images,
    skuOptions,
    itemId,
    sellerId: shopId,
    sellerProfile,
    reviews: sentiment.reviews,
    rating,
    totalReviews,
    sentiment: sentiment.summary,
    url: window.location.href,
  };
}

async function fetchShopeeJsonWithRetry(url: string, attempts: number, isCancelled: CancelCheck): Promise<any> {
  for (let i = 0; i < attempts; i++) {
    throwIfCancelled(isCancelled);
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (res.ok) {
        const json = await res.json().catch(() => null);
        if (json) return json;
      }
    } catch {
      // retry below
    }

    if (i < attempts - 1) await sleep(300 + i * 150);
  }

  return null;
}

async function collectShopeeReviews(ctx: ShopeeReviewContext, isCancelled: CancelCheck): Promise<Review[]> {
  const targetCount = 10;
  const stars = [5, 4, 3, 2, 1];

  throwIfCancelled(isCancelled);
  const localReviews = mapShopeeReviews(extractShopeeRatingsArray(ctx.ratingsJson));
  let merged = mergeUniqueReviews(localReviews);
  const starCounts = await readShopeeStarCountsFromDom(stars, isCancelled);

  // Skip background Shopee API fetch for now because it frequently returns 403.
  // Keep collection on in-page sources (initial payload + captured requests + DOM).
  for (const star of stars) {
    if (countStarReviews(merged, star) >= targetCount) continue;
    if (starCounts.get(star) === 0) continue;

    const captured = await captureShopeeReviewsFromPageRequests(
      ctx.shopId,
      ctx.itemId,
      star,
      isCancelled,
    );
    if (captured.length > 0) merged = mergeUniqueReviews(merged, captured);

    if (countStarReviews(merged, star) < targetCount) {
      const domReviews = await extractShopeeReviewsFromDom(star, isCancelled);
      if (domReviews.length > 0) merged = mergeUniqueReviews(merged, domReviews);
    }
  }

  return pickReviewsPerStar(merged, stars, targetCount);
}

function mergeUniqueReviews(...groups: Review[][]): Review[] {
  const unique = new Map<string, Review>();
  for (const list of groups) {
    for (const review of list ?? []) {
      const key = `${review.author}|${review.date}|${review.body}`;
      if (!unique.has(key)) unique.set(key, review);
    }
  }
  return Array.from(unique.values());
}

function countStarReviews(reviews: Review[], star: number): number {
  return reviews.filter((r) => Number(r?.rating ?? 0) === star).length;
}

function pickReviewsPerStar(reviews: Review[], stars: number[], limit: number): Review[] {
  const picked: Review[] = [];
  for (const star of stars) {
    picked.push(...reviews.filter((r) => Number(r?.rating ?? 0) === star).slice(0, limit));
  }
  return picked;
}

function extractShopeeIdsFromUrlOrDom(): { shopId: string; itemId: string } | null {
  const pathMatch = window.location.pathname.match(/-i\.(\d+)\.(\d+)/);
  if (pathMatch) return { shopId: pathMatch[1], itemId: pathMatch[2] };

  const url = new URL(window.location.href);
  const itemId = url.searchParams.get('item_id');
  const shopId = url.searchParams.get('shop_id');
  if (itemId && shopId) return { shopId, itemId };

  const html = document.documentElement.innerHTML;
  const domItemId = html.match(/"itemid":\s*(\d+)/)?.[1];
  const domShopId = html.match(/"shopid":\s*(\d+)/)?.[1];
  if (domItemId && domShopId) return { shopId: domShopId, itemId: domItemId };

  return null;
}

function extractShopeeTitleFromDom(): string {
  const og = document.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim();
  if (og) return og;
  return document.querySelector('h1')?.textContent?.trim() ?? '';
}

function extractShopeeDescriptionFromDom(): string {
  const selectors = [
    '[data-testid="pdp_product_detail"]',
    '[class*="product-detail"]',
    '[class*="product-description"]',
  ];
  for (const sel of selectors) {
    const text = document.querySelector(sel)?.textContent?.trim();
    if (text) return text;
  }
  return '';
}

function extractShopeeImagesFromApi(item: any): string[] {
  const raw: any[] = [];
  if (Array.isArray(item?.images)) raw.push(...item.images);
  if (item?.image) raw.push(item.image);
  if (item?.image_hash) raw.push(item.image_hash);

  if (Array.isArray(item?.models)) {
    for (const model of item.models) {
      if (Array.isArray(model?.images)) raw.push(...model.images);
      if (model?.image) raw.push(model.image);
      if (model?.image_hash) raw.push(model.image_hash);
    }
  }

  return Array.from(new Set(raw.map(toShopeeImageUrl).filter(Boolean)));
}

function extractShopeeImagesFromDom(): string[] {
  const urls: string[] = [];
  const og = document.querySelector('meta[property="og:image"]')?.getAttribute('content')?.trim();
  if (og) urls.push(og);

  const roots = new Set<HTMLElement>();
  const rootSelectors = [
    '[class*="product-briefing"]',
    '[class*="product-images"]',
    '[class*="pdp"]',
    '[class*="image-carousel"]',
    '[class*="shopee-image-wrapper"]',
  ];
  for (const sel of rootSelectors) {
    for (const node of Array.from(document.querySelectorAll(sel))) {
      if (node instanceof HTMLElement) roots.add(node);
    }
  }

  for (const root of roots) {
    for (const node of Array.from(root.querySelectorAll('img'))) {
      const img = node as HTMLImageElement;
      if (!isLikelyShopeeProductImage(img)) continue;
      const src = img.currentSrc || img.src || img.getAttribute('data-src') || '';
      const normalized = toShopeeImageUrl(src);
      if (normalized) urls.push(normalized);
    }
  }

  return Array.from(new Set(urls)).slice(0, 20);
}

function isLikelyShopeeProductImage(img: HTMLImageElement): boolean {
  const src = (img.currentSrc || img.src || img.getAttribute('data-src') || '').toLowerCase();
  if (!src) return false;

  const className = (img.className || '').toString().toLowerCase();
  const alt = (img.getAttribute('alt') || '').toLowerCase();
  const containerClass = (img.closest('[class]')?.getAttribute('class') || '').toLowerCase();
  const blocked = ['avatar', 'profile', 'seller', 'shop-user', 'username', 'review-user'];
  if (blocked.some((t) => className.includes(t) || alt.includes(t) || containerClass.includes(t) || src.includes(t))) {
    return false;
  }

  const inReviewSection = !!img.closest(
    '[class*="product-rating"],[class*="review"],[data-testid*="review"],[class*="comment"]',
  );
  if (inReviewSection) return false;

  const w = img.naturalWidth || img.width || 0;
  const h = img.naturalHeight || img.height || 0;
  if ((w > 0 && w < 120) || (h > 0 && h < 120)) return false;

  return src.includes('susercontent.com') || src.includes('shopee.ph');
}

function toShopeeImageUrl(input: any): string {
  if (!input) return '';
  if (typeof input === 'object') {
    const nested = input.url ?? input.image ?? input.image_hash ?? input.image_id ?? input.id ?? '';
    return toShopeeImageUrl(nested);
  }

  const s = String(input).trim();
  if (!s) return '';
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  if (s.startsWith('//')) return `https:${s}`;
  if (/^[a-zA-Z0-9_-]{10,}$/.test(s)) return `https://down-ph.img.susercontent.com/file/${s}`;
  return s;
}

function extractShopeeSkuOptions(item: any, productJson: any): any[] {
  const sources = [
    item?.tier_variations,
    productJson?.data?.item?.tier_variations,
    productJson?.data?.tier_variations,
    extractShopeeTierVariationsFromScripts(),
  ];

  for (const src of sources) {
    const mapped = mapShopeeTierVariations(src);
    if (mapped.length > 0) return mapped;
  }

  const fromModels = extractShopeeSkuOptionsFromModels(item, productJson);
  if (fromModels.length > 0) return fromModels;

  return extractShopeeSkuOptionsFromDom();
}

function mapShopeeTierVariations(tierVariations: any): any[] {
  const tiers = Array.isArray(tierVariations) ? tierVariations : [];
  if (tiers.length === 0) return [];

  return tiers
    .map((tier: any, tierIdx: number) => {
      const options = Array.isArray(tier?.options)
        ? tier.options
        : Array.isArray(tier?.option_list)
          ? tier.option_list
          : [];

      const values = options
        .map((opt: any, optIdx: number) => {
          const name = typeof opt === 'string' ? opt : opt?.name ?? opt?.value ?? opt?.option ?? '';
          if (!name) return null;
          return { vid: `${tierIdx}-${optIdx}`, name: String(name) };
        })
        .filter(Boolean);

      if (values.length === 0) return null;
      return { name: tier?.name ?? tier?.title ?? `Variant ${tierIdx + 1}`, values };
    })
    .filter(Boolean);
}

function extractShopeeTierVariationsFromScripts(): any[] {
  for (const script of Array.from(document.querySelectorAll('script'))) {
    const text = script.textContent ?? '';
    if (!text.includes('tier_variations')) continue;

    const extracted = extractJsonArrayByKey(text, 'tier_variations');
    if (!extracted) continue;
    try {
      return JSON.parse(extracted);
    } catch {
      continue;
    }
  }
  return [];
}

function extractJsonArrayByKey(text: string, key: string): string | null {
  const keyPattern = `"${key}"`;
  const keyIdx = text.indexOf(keyPattern);
  if (keyIdx === -1) return null;

  const colonIdx = text.indexOf(':', keyIdx + keyPattern.length);
  if (colonIdx === -1) return null;

  const start = text.indexOf('[', colonIdx + 1);
  if (start === -1) return null;

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

    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function extractShopeeSkuOptionsFromDom(): any[] {
  const groups = Array.from(
    document.querySelectorAll(
      ['[class*="product-variation"]', '[class*="variations"]', '[data-testid*="variation"]'].join(','),
    ),
  ).filter((el) => el instanceof HTMLElement) as HTMLElement[];

  const mapped: any[] = [];
  for (const group of groups) {
    const label = group.querySelector('[class*="label"],[class*="name"],[class*="title"]')?.textContent?.trim() || '';
    const optionNodes = Array.from(
      group.querySelectorAll('button,[role="button"],[class*="option"],[class*="variation"]'),
    ) as HTMLElement[];
    const values = optionNodes
      .map((el, idx) => normalizeSpaces(el.textContent || '').trim())
      .filter(Boolean)
      .map((name, idx) => ({ vid: `${mapped.length}-${idx}`, name }));

    if (values.length > 0) {
      mapped.push({
        name: label || `Variant ${mapped.length + 1}`,
        values: Array.from(new Map(values.map((v) => [v.name, v])).values()),
      });
    }
  }
  return mapped;
}

function extractShopeeSkuOptionsFromModels(item: any, productJson: any): any[] {
  const modelSources = [item?.models, productJson?.data?.item?.models, productJson?.data?.models];
  let models: any[] = [];
  for (const src of modelSources) {
    if (Array.isArray(src) && src.length > 0) {
      models = src;
      break;
    }
  }
  if (models.length === 0) return [];

  const names = Array.from(
    new Set(models.map((m: any) => normalizeSpaces(String(m?.name ?? m?.model_name ?? ''))).filter(Boolean)),
  );
  if (names.length === 0) return [];

  return [
    {
      name: 'Model',
      values: names.map((name, idx) => ({ vid: `model-${idx}`, name })),
    },
  ];
}

function formatShopeePrice(item: any): string {
  const raw = Number(item?.price_min ?? item?.price ?? 0);
  if (!raw) return extractShopeePriceFromDom() || 'N/A';

  const normalized = raw > 1_000_000 ? raw / 100000 : raw / 100;
  return `\u20B1${normalized.toLocaleString('en-PH', {
    minimumFractionDigits: normalized % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function extractShopeePriceFromDom(): string {
  const selectors = ['[class*="pqTWkA"]', '[class*="IZPeQz"]', '[class*="product-price"]'];
  for (const sel of selectors) {
    const text = document.querySelector(sel)?.textContent?.trim();
    if (text) return text;
  }
  return '';
}

function extractShopeeRatingFromDom(): number | null {
  const selectors = ['[class*="product-rating"]', '[class*="shopee-product-rating"]'];
  for (const sel of selectors) {
    const text = document.querySelector(sel)?.textContent ?? '';
    const match = text.match(/(\d+(?:\.\d+)?)/);
    if (match) return Number(match[1]);
  }
  return null;
}

async function resolveShopeeRating(initial: any, reviews: Review[], isCancelled: CancelCheck): Promise<number | null> {
  const initialNum = Number(initial);
  if (initialNum > 0) return initialNum;

  const now = extractShopeeRatingFromDom();
  if (now && now > 0) return now;

  for (let i = 0; i < 8; i++) {
    throwIfCancelled(isCancelled);
    await sleep(350 + i * 50);
    const retry = extractShopeeRatingFromDom();
    if (retry && retry > 0) return retry;
  }

  const nums = reviews.map((r) => Number(r.rating || 0)).filter((n) => n > 0);
  if (nums.length === 0) return null;
  const avg = nums.reduce((sum, n) => sum + n, 0) / nums.length;
  return Number(avg.toFixed(1));
}

async function resolveShopeePrice(item: any, isCancelled: CancelCheck): Promise<string> {
  for (let i = 0; i < 8; i++) {
    throwIfCancelled(isCancelled);
    const value = formatShopeePrice(item);
    if (value && value !== 'N/A') return value;
    await sleep(300 + i * 50);
  }
  return formatShopeePrice(item);
}

async function resolveShopeeDescription(initial: string, isCancelled: CancelCheck): Promise<string> {
  const fromApi = String(initial ?? '').trim();
  if (fromApi) return fromApi;

  for (let i = 0; i < 8; i++) {
    throwIfCancelled(isCancelled);
    const text = (extractShopeeDescriptionFromDom() ?? '').trim();
    if (text.length >= 10) return text;
    await sleep(350);
  }

  return fromApi;
}

function mapShopeeReviews(ratings: any[]): Review[] {
  const mapped: Review[] = [];
  for (const r of ratings) {
    const author = normalizeSpaces(String(r?.author_username ?? r?.author_name ?? 'Anonymous'));
    const body = sanitizeShopeeReviewBody(r?.comment ?? '', author);
    if (!body) continue;

    mapped.push({
      author: author || 'Anonymous',
      rating: Number(r?.rating_star ?? 0),
      date: r?.ctime ? new Date(Number(r.ctime) * 1000).toISOString() : '',
      title: '',
      body,
      verified: !!(r?.is_buyer_purchase ?? false),
      images: (r?.images ?? []).map(toShopeeImageUrl).filter(Boolean),
    });
  }
  return mapped;
}

function extractShopeeRatingsArray(json: any): any[] {
  const candidates = [json?.data?.ratings, json?.ratings, json?.data?.data?.ratings, json?.data?.item_ratings];
  for (const c of candidates) if (Array.isArray(c)) return c;
  return [];
}

async function captureShopeeReviewsFromPageRequests(shopId: string, itemId: string, star: number, isCancelled: CancelCheck): Promise<Review[]> {
  throwIfCancelled(isCancelled);
  installShopeeRatingsSniffer();

  const collected: any[] = [];
  const onMessage = (event: MessageEvent) => {
    const data = event.data;
    if (!data || data.source !== 'shopee-ratings-sniffer') return;
    const raw = extractShopeeRatingsArray(data.payload);
    if (raw.length > 0) collected.push(...raw);
  };

  window.addEventListener('message', onMessage);
  try {
    await triggerShopeeReviewSection(isCancelled);
    await selectShopeeStarFilter(star, isCancelled);
    const start = Date.now();
    while (Date.now() - start < 9000) {
      throwIfCancelled(isCancelled);
      if (collected.length > 0) break;
      await sleep(300);
    }
  } finally {
    window.removeEventListener('message', onMessage);
  }

  return mapShopeeReviews(filterShopeeRatingsByItem(collected, itemId, shopId));
}

function installShopeeRatingsSniffer(): void {
  if (document.getElementById('shopee-ratings-sniffer-script')) return;

  const script = document.createElement('script');
  script.id = 'shopee-ratings-sniffer-script';
  script.textContent = `
    (() => {
      if (window.__shopeeRatingsSnifferInstalled) return;
      window.__shopeeRatingsSnifferInstalled = true;
      const postPayload = (url, payload) => {
        try {
          if (!url || !String(url).includes('/item/get_ratings')) return;
          window.postMessage({ source: 'shopee-ratings-sniffer', url: String(url), payload }, '*');
        } catch {}
      };

      const originalFetch = window.fetch;
      window.fetch = async (...args) => {
        const res = await originalFetch(...args);
        try {
          const input = args[0];
          const url = typeof input === 'string' ? input : input?.url;
          if (url && String(url).includes('/item/get_ratings')) {
            const clone = res.clone();
            clone.json().then((json) => postPayload(url, json)).catch(() => {});
          }
        } catch {}
        return res;
      };

      const open = XMLHttpRequest.prototype.open;
      const send = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        this.__ratingsUrl = url;
        return open.call(this, method, url, ...rest);
      };
      XMLHttpRequest.prototype.send = function(...args) {
        this.addEventListener('load', function() {
          try {
            const url = this.__ratingsUrl;
            if (!url || !String(url).includes('/item/get_ratings')) return;
            const text = this.responseText;
            if (!text) return;
            postPayload(url, JSON.parse(text));
          } catch {}
        });
        return send.apply(this, args);
      };
    })();
  `;

  (document.documentElement || document.head || document.body).appendChild(script);
}

async function triggerShopeeReviewSection(isCancelled: CancelCheck): Promise<void> {
  throwIfCancelled(isCancelled);
  const maybeTab = Array.from(document.querySelectorAll('button,a,div[role="tab"],span')).find((el) =>
    /rating|ratings|review|reviews/i.test((el.textContent ?? '').trim()),
  );
  if (maybeTab instanceof HTMLElement) {
    maybeTab.click();
    await sleep(500);
    throwIfCancelled(isCancelled);
  }

  const anchor =
    document.querySelector('[data-testid*="review"]') ??
    document.querySelector('[class*="product-rating"]') ??
    document.querySelector('[class*="rating"]');
  if (anchor instanceof HTMLElement) {
    anchor.scrollIntoView({ behavior: 'auto', block: 'center' });
    await sleep(500);
    throwIfCancelled(isCancelled);
  }

  window.scrollBy({ top: 900, behavior: 'auto' });
  await sleep(800);
  throwIfCancelled(isCancelled);
}

async function selectShopeeStarFilter(star: number, isCancelled: CancelCheck): Promise<void> {
  throwIfCancelled(isCancelled);
  const nodes = Array.from(document.querySelectorAll('button,a,div,span')) as HTMLElement[];
  const target = nodes.find((el) => {
    const text = normalizeSpaces(el.textContent || '');
    if (!text) return false;
    const re = new RegExp(`^${star}\\s*star`, 'i');
    if (!re.test(text)) return false;
    const cls = (el.className || '').toString().toLowerCase();
    return !cls.includes('disabled');
  });

  if (target) {
    dispatchMouseClick(target);
    await sleep(800);
  }
}

async function readShopeeStarCountsFromDom(stars: number[], isCancelled: CancelCheck): Promise<Map<number, number | null>> {
  const counts = new Map<number, number | null>();
  for (const star of stars) counts.set(star, null);

  await triggerShopeeReviewSection(isCancelled);
  throwIfCancelled(isCancelled);

  const nodes = Array.from(document.querySelectorAll('button,a,div,span')) as HTMLElement[];
  for (const star of stars) {
    const re = new RegExp(`^${star}\s*star\b`, 'i');
    const candidate = nodes.find((el) => re.test(normalizeSpaces(el.textContent || '')));
    const count = extractShopeeStarCount(candidate?.textContent || '');
    if (count !== null) counts.set(star, count);
  }

  return counts;
}

function extractShopeeStarCount(label: string): number | null {
  const text = normalizeSpaces(String(label || ''));
  if (!text) return null;

  const paren = text.match(/((d[d,]*))/);
  if (paren?.[1]) {
    const n = Number(paren[1].replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }

  const tail = text.match(/stars*(d[d,]*)$/i);
  if (tail?.[1]) {
    const n = Number(tail[1].replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }

  return null;
}

function filterShopeeRatingsByItem(ratings: any[], itemId: string, shopId: string): any[] {
  const targetItem = String(itemId);
  const targetShop = String(shopId);
  const unique = new Map<string, any>();
  for (const r of ratings) {
    const rItem = String(r?.itemid ?? r?.item_id ?? '');
    const rShop = String(r?.shopid ?? r?.shop_id ?? '');
    if (rItem && rItem !== targetItem) continue;
    if (rShop && rShop !== targetShop) continue;
    const key = `${r?.userid ?? r?.author_username ?? 'u'}-${r?.ctime ?? r?.orderid ?? Math.random()}`;
    if (!unique.has(key)) unique.set(key, r);
  }
  return Array.from(unique.values());
}

async function extractShopeeReviewsFromDom(star: number, isCancelled: CancelCheck): Promise<Review[]> {
  await triggerShopeeReviewSection(isCancelled);
  await selectShopeeStarFilter(star, isCancelled);
  throwIfCancelled(isCancelled);

  const all = new Map<string, Review>();
  let stalePageHits = 0;
  let page = 1;

  while (true) {
    throwIfCancelled(isCancelled);
    for (let round = 0; round < 2; round++) {
      throwIfCancelled(isCancelled);
      for (const review of collectShopeeReviewsFromVisibleDom(star)) {
        const key = `${review.author}|${review.date}|${review.body}`;
        if (!all.has(key)) all.set(key, review);
      }
      window.scrollBy({ top: 900, behavior: 'auto' });
      await sleep(350);
    }

    if (countStarReviews(Array.from(all.values()), star) >= 10) break;
    if (!hasShopeeNextPage()) break;

    const beforeFingerprint = getReviewFingerprint(Array.from(all.values()));
    const beforeActivePage = getActiveShopeeReviewPage();
    const moved = await goToNextShopeeReviewPage(page + 1, beforeFingerprint, beforeActivePage, star, isCancelled);
    const afterFingerprint = getReviewFingerprint(collectShopeeReviewsFromVisibleDom(star));
    const contentChanged = !!afterFingerprint && afterFingerprint !== beforeFingerprint;
    stalePageHits = contentChanged ? 0 : stalePageHits + 1;

    if (!moved || stalePageHits >= 2) break;
    page++;
  }

  return Array.from(all.values());
}

function hasShopeeNextPage(): boolean {
  const controller = findShopeeReviewPageController();
  if (!controller) return false;
  const rightBtn = controller.querySelector('button.shopee-icon-button--right') as HTMLElement | null;
  if (!rightBtn) return false;
  const ariaDisabled = rightBtn.getAttribute('aria-disabled') === 'true';
  const htmlDisabled = (rightBtn as HTMLButtonElement).disabled === true;
  const cls = (rightBtn.className || '').toString().toLowerCase();
  return !(ariaDisabled || htmlDisabled || cls.includes('disabled') || cls.includes('--disabled'));
}

async function goToNextShopeeReviewPage(
  targetPage: number,
  beforeFingerprint: string,
  beforeActivePage: number | null,
  star: number,
  isCancelled: CancelCheck,
): Promise<boolean> {
  throwIfCancelled(isCancelled);
  const controller = findShopeeReviewPageController();
  if (!controller) return false;

  const isDisabled = (el: HTMLElement): boolean => {
    const ariaDisabled = el.getAttribute('aria-disabled') === 'true';
    const htmlDisabled = (el as HTMLButtonElement).disabled === true;
    const cls = (el.className || '').toString().toLowerCase();
    return ariaDisabled || htmlDisabled || cls.includes('disabled') || cls.includes('--disabled');
  };

  const waitAndCheck = async () => {
    throwIfCancelled(isCancelled);
    await sleep(350);
    const afterFingerprint = getReviewFingerprint(collectShopeeReviewsFromVisibleDom(star));
    const afterActivePage = getActiveShopeeReviewPage();
    return (
      (beforeActivePage !== null && afterActivePage !== null && afterActivePage >= targetPage) ||
      (!!afterFingerprint && afterFingerprint !== beforeFingerprint)
    );
  };

  const findNumericBtn = (page: number): HTMLElement | null => {
    for (const btn of Array.from(controller.querySelectorAll('button'))) {
      if (!(btn instanceof HTMLElement)) continue;
      if (isDisabled(btn)) continue;
      if (Number(normalizeSpaces(btn.textContent || '')) === page) return btn;
    }
    return null;
  };

  let targetBtn = findNumericBtn(targetPage);
  if (targetBtn) {
    throwIfCancelled(isCancelled);
    dispatchMouseClick(targetBtn);
    if (await waitAndCheck()) return true;
  }

  const rightBtn = controller.querySelector('button.shopee-icon-button--right') as HTMLElement | null;
  if (!rightBtn || isDisabled(rightBtn)) return false;

  for (let i = 0; i < 2; i++) {
    throwIfCancelled(isCancelled);
    dispatchMouseClick(rightBtn);
    await sleep(900);
    targetBtn = findNumericBtn(targetPage);
    if (targetBtn) dispatchMouseClick(targetBtn);
    if (await waitAndCheck()) return true;
  }

  return false;
}

function throwIfCancelled(isCancelled: CancelCheck): void {
  if (isCancelled()) {
    throw new Error('SCRAPE_CANCELLED');
  }
}

function findShopeeReviewPageController(): HTMLElement | null {
  return (
    (document.querySelector('nav.product-ratings__page-controller') as HTMLElement | null) ??
    (document.querySelector('nav.shopee-page-controller.product-ratings__page-controller') as HTMLElement | null) ??
    (document.querySelector('.product-ratings__page-controller') as HTMLElement | null)
  );
}

function dispatchMouseClick(el: HTMLElement): void {
  el.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
  const opts: MouseEventInit = { bubbles: true, cancelable: true, view: window };
  el.dispatchEvent(new MouseEvent('pointerdown', opts));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.dispatchEvent(new MouseEvent('click', opts));
}

function collectShopeeReviewsFromVisibleDom(expectedStar?: number): Review[] {
  const nodes = new Set<HTMLElement>();
  const selectors = [
    '[class*="shopee-product-rating"]',
    '[class*="product-comment"]',
    '[class*="review-item"]',
    '[data-testid*="review"]',
  ];
  for (const sel of selectors) {
    for (const el of Array.from(document.querySelectorAll(sel))) {
      if (el instanceof HTMLElement) nodes.add(el);
    }
  }
  for (const star of Array.from(document.querySelectorAll('svg[class*="rating"], svg[class*="icon-rating"]'))) {
    const holder = (star as HTMLElement).closest('li,div,section,article');
    if (holder instanceof HTMLElement) nodes.add(holder);
  }

  const reviews: Review[] = [];
  for (const node of nodes) reviews.push(...parseShopeeReviewNode(node, expectedStar));
  return reviews;
}

function parseShopeeReviewNode(root: HTMLElement, expectedStar?: number): Review[] {
  const rawText = normalizeSpaces(root.innerText || root.textContent || '');
  if (!rawText || rawText.length < 8) return [];

  const segmented = splitCompositeReviewText(root.innerText || '', expectedStar);
  if (segmented.length > 1) return segmented;

  const dateMatch = rawText.match(/\d{4}[-/.]\d{2}[-/.]\d{2}/);
  const hasStars = root.querySelectorAll('svg[class*="rating"], svg[class*="icon-rating"], i[class*="rating"]').length > 0;
  if (!dateMatch && !hasStars) return [];

  const lines = (root.innerText || '').split('\n').map(normalizeSpaces).filter(Boolean);
  if (lines.length === 0) return [];

  const author = pickShopeeAuthor(lines);
  const date = dateMatch?.[0] ?? '';
  const bodyLines = lines.filter((line) => {
    if (line === author) return false;
    if (date && line.includes(date)) return false;
    if (isShopeeNoiseLine(line)) return false;
    if (isShopeeMetaLine(line)) return false;
    return true;
  });
  const body = normalizeSpaces(bodyLines.join(' '));
  const cleanedBody = sanitizeShopeeReviewBody(body, author);
  if (!cleanedBody) return [];

  const ratingCount = root.querySelectorAll('svg[class*="icon-rating-solid"], svg[class*="rating"]').length;
  const rating = Math.max(1, Math.min(5, ratingCount || 0));

  return [{ author, rating, date, title: '', body: cleanedBody, verified: false, images: [] }];
}

function splitCompositeReviewText(text: string, expectedStar?: number): Review[] {
  const lines = text.split('\n').map(normalizeSpaces).filter(Boolean);
  const dateRegex = /\d{4}[-/.]\d{2}[-/.]\d{2}/;
  const dateIndexes: number[] = [];
  for (let i = 0; i < lines.length; i++) if (dateRegex.test(lines[i])) dateIndexes.push(i);
  if (dateIndexes.length <= 1) return [];

  const reviews: Review[] = [];
  for (let i = 0; i < dateIndexes.length; i++) {
    const start = Math.max(0, dateIndexes[i] - 2);
    const end = i + 1 < dateIndexes.length ? dateIndexes[i + 1] : lines.length;
    const block = lines.slice(start, end);
    if (block.length < 2) continue;

    const date = block.find((line) => dateRegex.test(line))?.match(dateRegex)?.[0] ?? '';
    const author = pickShopeeAuthor(block);
    const bodyLines = block.filter((line) => {
      if (line === author) return false;
      if (date && line.includes(date)) return false;
      if (isShopeeNoiseLine(line)) return false;
      if (isShopeeMetaLine(line)) return false;
      return true;
    });
    const body = normalizeSpaces(bodyLines.join(' '));
    const cleanedBody = sanitizeShopeeReviewBody(body, author);
    if (!cleanedBody) continue;

    reviews.push({ author, rating: expectedStar ?? 5, date, title: '', body: cleanedBody, verified: false, images: [] });
  }
  return reviews;
}

function sanitizeShopeeReviewBody(rawBody: string, author: string): string {
  let body = normalizeSpaces(String(rawBody ?? ''));
  if (!body) return '';

  // Keep buyer comment, strip noisy UI/meta fragments.
  body = body
    .replace(/\bhelpful\??\b/gi, ' ')
    .replace(/\b\d+\s*\|\s*variation\s*:\s*[^|]+/gi, ' ')
    .replace(/\b(?:variation|variant)\s*:\s*[^|]+/gi, ' ')
    .replace(/\b(?:color family|quantity)\s*:\s*[^|]+/gi, ' ')
    .replace(/seller'?s\s*response\s*:[\s\S]*$/gi, ' ')
    .replace(/\b\d{1,2}:\d{2}\b/g, ' ');

  body = normalizeSpaces(body);
  body = stripQuestionNoise(body);
  body = stripLeadingTrailingHandleTokens(body);
  if (!body) return '';

  const bodyLower = body.toLowerCase();
  const authorLower = normalizeSpaces(String(author ?? '')).toLowerCase();
  if (authorLower && bodyLower === authorLower) return '';
  if (!hasActualReviewContent(body)) return '';

  return body;
}

function stripQuestionNoise(text: string): string {
  return normalizeSpaces(
    String(text ?? '')
      .replace(/^\?+\s*/g, '')
      .replace(/\s*\?+$/g, '')
      .replace(/\s+\?/g, ' ')
      .replace(/\?\s+/g, ' '),
  );
}

function hasActualReviewContent(text: string): boolean {
  const t = normalizeSpaces(String(text ?? ''));
  if (!t) return false;
  // Exclude obvious non-review filler.
  if (/^(u|hi|hello|thanks?)\s+seller\b/i.test(t)) return false;
  const words = t.split(/\s+/).filter(Boolean);
  const alphaCount = (t.match(/[a-zA-Z]/g) ?? []).length;
  const handleLikeCount = words.filter((w) => isLikelyHandleToken(w)).length;
  if (alphaCount < 3) return false;
  if (words.length > 0 && handleLikeCount / words.length >= 0.75) return false;
  if (words.length <= 2 && !hasStrongDefectSignal(t) && !hasProductAspectSignal(t) && !hasReviewTextSignal(t)) return false;
  if (words.length === 1 && words[0].length < 4 && !hasStrongDefectSignal(t)) return false;
  // Single-word comments are allowed only if they carry review meaning.
  if (words.length === 1) {
    return hasStrongDefectSignal(t) || hasProductAspectSignal(t) || hasReviewTextSignal(t);
  }
  // Very short two-word text must still look like real feedback.
  if (words.length === 2) {
    return hasStrongDefectSignal(t) || hasProductAspectSignal(t) || hasReviewTextSignal(t);
  }
  return true;
}
function stripLeadingTrailingHandleTokens(text: string): string {
  const tokens = normalizeSpaces(text).split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return normalizeSpaces(text);
  let start = 0;
  let end = tokens.length - 1;
  let removed = 0;
  while (start <= end && removed < 2 && isLikelyHandleToken(tokens[start])) {
    start++;
    removed++;
  }
  while (end >= start && removed < 4 && isLikelyHandleToken(tokens[end])) {
    end--;
    removed++;
  }
  const sliced = tokens.slice(start, end + 1);
  return normalizeSpaces(sliced.join(' '));
}
function stripEdgeAuthorMentions(text: string, authorSet: Set<string>): string {
  const tokens = normalizeSpaces(text).split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return normalizeSpaces(text);
  let start = 0;
  let end = tokens.length - 1;
  const normalizeToken = (token: string) =>
    token.replace(/^[^\p{L}\p{N}._@*-]+|[^\p{L}\p{N}._@*-]+$/gu, '').toLowerCase();
  for (let i = 0; i < 2 && start <= end; i++) {
    const head = normalizeToken(tokens[start]);
    if (!head || !authorSet.has(head)) break;
    start++;
  }
  for (let i = 0; i < 3 && end >= start; i++) {
    const tail = normalizeToken(tokens[end]);
    if (!tail || !authorSet.has(tail)) break;
    end--;
  }
  return normalizeSpaces(tokens.slice(start, end + 1).join(' '));
}
function isLikelyHandleToken(token: string): boolean {
  const t = token.replace(/^[^\p{L}\p{N}._@*-]+|[^\p{L}\p{N}._@*-]+$/gu, '').toLowerCase();
  if (!t || t.length < 3) return false;
  if (/^[*x]+[a-z0-9*_-]*$/i.test(t) && /[*x]/i.test(t)) return true;
  if (!/^[a-z0-9._@*-]{3,}$/.test(t)) return false;
  if (/[0-9@._*-]/.test(t)) return true;
  if (t.length >= 10 && !hasReviewTextSignal(t) && !hasProductAspectSignal(t) && !hasStrongDefectSignal(t)) return true;
  return false;
}

function isShopeeNoiseLine(line: string): boolean {
  const t = normalizeSpaces(String(line ?? ''));
  const low = t.toLowerCase();
  if (!t) return true;
  if (low === 'helpful?' || low === 'helpful') return true;
  if (/^seller'?s\s*response/i.test(low)) return true;
  if (/^\d{1,2}:\d{2}$/.test(t)) return true;
  if (/^\d{1,2}:\d{2}\s*helpful\??$/i.test(t)) return true;
  return false;
}






function hasReviewTextSignal(text: string): boolean {
  if (!text) return false;
  if (/[.!?,]/.test(text)) return true;

  return /\b(good|great|nice|okay|ok|bad|poor|love|worth|recommended|legit|fake|scam|quality|item|product|delivery|seller|packaging|works|working|defective|damaged|broken|maganda|pangit|sira|maayos|mabilis|bilis|sulit|matibay|ayos)\b/i.test(
    text,
  );
}

function hasProductAspectSignal(text: string): boolean {
  if (!text) return false;
  return /\b(appearance|suitability|performance|functionality|quality|material|size|color|colour|packing|packaging|delivery|price|value|durable|defect|damage|damaged|broken|deformed|scratch|dent|yupi|gasgas|basag|sira|laki|liit|kulay|tibay|amoy|fit|works?|working|natanggap)\b/i.test(
    text,
  );
}

function hasStrongDefectSignal(text: string): boolean {
  if (!text) return false;
  return /\b(deformed|defective|damaged|broken|basag|sira|yupi|gasgas|dent|crack|cracked|warped|bent|leak|leaking|mali|wrong item)\b/i.test(
    text,
  );
}

function pickShopeeAuthor(lines: string[]): string {
  const dateIdx = lines.findIndex((line) => /\d{4}[-/.]\d{2}[-/.]\d{2}/.test(line));
  if (dateIdx > 0) {
    for (let i = dateIdx - 1; i >= Math.max(0, dateIdx - 3); i--) {
      const line = normalizeSpaces(lines[i] ?? '');
      if (!line) continue;
      if (isShopeeMetaLine(line)) continue;
      if (/^[a-z0-9._@*-]{3,}$/i.test(line) && line.length <= 28) return line;
    }
  }

  for (const line of lines) {
    if (!line) continue;
    if (isShopeeMetaLine(line)) continue;
    if (isLikelyShopeeAuthorLine(line)) return line;
  }

  for (const line of lines) {
    if (!line) continue;
    if (isShopeeMetaLine(line)) continue;
    if (line.split(/\s+/).length <= 2 && line.length <= 24) return line;
  }

  return 'Anonymous';
}
function isLikelyShopeeAuthorLine(line: string): boolean {
  const t = normalizeSpaces(line);
  if (!t) return false;
  if (t.length > 28) return false;
  if (/[.!?,:]/.test(t)) return false;
  if (hasReviewTextSignal(t)) return false;

  const tokens = t.split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 2) return false;
  return tokens.every((token) => /^[a-z0-9._-]{3,}$/i.test(token));
}

function isShopeeMetaLine(line: string): boolean {
  const t = normalizeSpaces(String(line ?? ''));
  const low = t.toLowerCase();
  if (!t) return true;
  if (low === 'helpful?') return true;
  if (/\d{4}[-/.]\d{2}[-/.]\d{2}/.test(t)) return true;
  if (/^(\d+\s*\|\s*)?(variation|variant)\s*:/i.test(t)) return true;
  if (/(^|\s)(variation|variant)(\s|$)/i.test(t)) return true;
  if (/(^|\s)(color family|quantity)(\s|:)/i.test(t)) return true;
  if (/^[★☆\s]+$/.test(t)) return true;
  if (/^[\d\s|:]+$/.test(t)) return true;
  return false;
}

function cleanupShopeeReviews(reviews: Review[]): Review[] {
  if (!Array.isArray(reviews) || reviews.length === 0) return [];

  return reviews
    .map((review) => {
      const author = normalizeSpaces(String(review?.author ?? 'Anonymous')) || 'Anonymous';
      const body = sanitizeShopeeReviewBody(String(review?.body ?? ''), author);
      return {
        ...review,
        author,
        body: normalizeSpaces(body),
      };
    })
    .filter((review) => {
      if (!review.body) return false;
      if (review.body.toLowerCase() === review.author.toLowerCase()) return false;
      if (!hasActualReviewContent(review.body)) return false;
      return true;
    });
}

function extractVariantNameFromLines(lines: string[]): string {
  for (const raw of lines) {
    const line = normalizeSpaces(raw);
    const low = line.toLowerCase();
    if (low.startsWith('variation:') || low.startsWith('variant:')) {
      const name = line.split(':').slice(1).join(':').trim();
      return name || line;
    }
    if (low.includes('variation') && low.includes(':')) {
      const idx = line.indexOf(':');
      if (idx >= 0) {
        const name = line.slice(idx + 1).trim();
        if (name) return name;
      }
    }
  }
  return '';
}
function findShopeeReviewRoot(): HTMLElement | null {
  return (
    (document.querySelector('[class*="shopee-product-rating"]') as HTMLElement | null) ??
    (document.querySelector('[data-testid*="review"]') as HTMLElement | null) ??
    (document.querySelector('[class*="product-rating"]') as HTMLElement | null)
  );
}

function getActiveShopeeReviewPage(): number | null {
  const root = findShopeeReviewRoot() ?? document.body;
  const candidates = Array.from(root.querySelectorAll('button, a, span, div')).filter(
    (el) => el instanceof HTMLElement,
  ) as HTMLElement[];

  for (const el of candidates) {
    const cls = (el.className || '').toString().toLowerCase();
    if (!cls.includes('active') && !cls.includes('selected') && el.getAttribute('aria-current') !== 'page') continue;
    const n = Number(normalizeSpaces(el.textContent || ''));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function getReviewFingerprint(reviews: Review[]): string {
  if (!reviews.length) return '';
  return reviews
    .slice(0, 3)
    .map((r) => `${r.author}|${r.date}|${r.body.slice(0, 50)}`)
    .join('||');
}

function extractShopeeSellerProfile() {
  const nameSelectors = [
    '[class*="shop-page-shop-description"] [class*="name"]',
    '[class*="shop-name"]',
    '[class*="shop-header"] [class*="name"]',
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

  const rootText = normalizeSpaces(document.body.innerText || '');
  const badges: string[] = [];
  if (/shopee mall/i.test(rootText)) badges.push('Shopee Mall');
  if (/preferred seller/i.test(rootText)) badges.push('Preferred Seller');
  if (/official store/i.test(rootText)) badges.push('Official Store');

  const metrics: Record<string, string> = {};
  const extractMetric = (label: string, key: string, pattern: RegExp) => {
    const m = rootText.match(pattern);
    if (m?.[1]) metrics[key] = `${label}: ${m[1].trim()}`;
  };
  extractMetric('Ratings', 'ratings', /\bRatings?\s+([0-9.,]+\s*[kKmM]?)/i);
  extractMetric('Response Rate', 'response_rate', /\bResponse Rate\s+([0-9]{1,3}%)/i);
  extractMetric('Response Time', 'response_time', /\bResponse Time\s+([A-Za-z0-9\s]+?)(?=\s+(Joined|Follower|Products|Ratings)|$)/i);
  extractMetric('Joined', 'joined', /\bJoined\s+([A-Za-z0-9\s]+?ago)/i);
  extractMetric('Follower', 'followers', /\bFollower\s+([0-9.,]+\s*[kKmM]?)/i);
  extractMetric('Products', 'products', /\bProducts\s+([0-9.,]+\s*[kKmM]?)/i);

  return {
    name: name || 'Unknown Seller',
    badges: Array.from(new Set(badges)),
    metrics,
  };
}





































