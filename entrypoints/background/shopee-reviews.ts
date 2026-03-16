export async function fetchShopeeReviews(shopId: string, itemId: string) {
  const cookies = await chrome.cookies.getAll({ domain: '.shopee.ph' });
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');

  const pageSize = 20;
  const maxPages = 10;
  const targetFiveStar = 10;
  const merged = new Map<string, any>();
  let totalReviews = 0;
  let firstSuccessUrl = '';
  let fetchedPages = 0;

  for (let page = 0; page < maxPages; page++) {
    const offset = page * pageSize;
    const pageResult = await fetchShopeeRatingsPage(shopId, itemId, offset, pageSize, cookieHeader);
    if (!pageResult) {
      if (page > 0) break;
      continue;
    }

    fetchedPages++;
    if (!firstSuccessUrl) firstSuccessUrl = pageResult.url;

    const ratings = pageResult.ratings;
    if (ratings.length === 0) break;

    if (totalReviews === 0) {
      totalReviews = Number(
        pageResult.json?.data?.item_rating_summary?.rating_total ??
          pageResult.json?.data?.item_rating_summary?.rating_count?.reduce?.(
            (a: number, b: number) => a + b,
            0,
          ) ??
          ratings.length,
      );
    }

    for (const raw of ratings) {
      const mapped = mapShopeeRatingToReview(raw);
      if (!mapped) continue;
      const key = `${mapped.author}|${mapped.date}|${mapped.body}`;
      if (!merged.has(key)) merged.set(key, mapped);
    }

    const current = Array.from(merged.values());
    const fiveStarCount = current.filter((r) => Number(r?.rating ?? 0) === 5).length;
    if (fiveStarCount >= targetFiveStar) break;
  }

  if (merged.size > 0) {
    const reviews = Array.from(merged.values());
    return {
      reviews,
      totalReviews: totalReviews || reviews.length,
      debug: {
        source: 'background',
        url: firstSuccessUrl,
        count: reviews.length,
        pages: fetchedPages,
        fiveStarCount: reviews.filter((r) => Number(r?.rating ?? 0) === 5).length,
      },
    };
  }

  return {
    reviews: [],
    totalReviews: 0,
    debug: { source: 'background', count: 0 },
  };
}

async function fetchShopeeRatingsPage(
  shopId: string,
  itemId: string,
  offset: number,
  limit: number,
  cookieHeader: string,
): Promise<{ ratings: any[]; json: any; url: string } | null> {
  const candidates = [
    `https://shopee.ph/api/v2/item/get_ratings?shopid=${shopId}&itemid=${itemId}&limit=${limit}&offset=${offset}&type=0&filter=0`,
    `https://shopee.ph/api/v2/item/get_ratings?shopid=${shopId}&itemid=${itemId}&limit=${limit}&offset=${offset}&type=0&filter=0&flag=1`,
    `https://shopee.ph/api/v2/item/get_ratings?shop_id=${shopId}&item_id=${itemId}&limit=${limit}&offset=${offset}&type=0&filter=0`,
  ];

  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          Cookie: cookieHeader,
          Referer: `https://shopee.ph/product/${shopId}/${itemId}`,
          'User-Agent': navigator.userAgent,
          'X-Requested-With': 'XMLHttpRequest',
        },
      });

      if (!res.ok) continue;
      const json = await res.json().catch(() => null);
      const ratings = extractShopeeRatingsArray(json);
      if (!Array.isArray(ratings)) continue;
      return { ratings, json, url };
    } catch {
      continue;
    }
  }

  return null;
}

function extractShopeeRatingsArray(json: any): any[] {
  const candidates = [
    json?.data?.ratings,
    json?.ratings,
    json?.data?.data?.ratings,
    json?.data?.item_ratings,
  ];

  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }

  return [];
}

function mapShopeeRatingToReview(r: any) {
  const images = (r?.images ?? [])
    .map((img: any) => {
      if (!img) return '';
      if (typeof img === 'string') {
        if (img.startsWith('http://') || img.startsWith('https://')) return img;
        return `https://down-ph.img.susercontent.com/file/${img}`;
      }
      const objectUrl = img.url ?? img.image ?? img.image_url ?? img.path ?? '';
      if (!objectUrl) return '';
      if (
        typeof objectUrl === 'string' &&
        (objectUrl.startsWith('http://') || objectUrl.startsWith('https://'))
      ) {
        return objectUrl;
      }
      return `https://down-ph.img.susercontent.com/file/${objectUrl}`;
    })
    .filter(Boolean);

  const author = normalizeSpaces(String(r?.author_username ?? r?.author_name ?? 'Anonymous'));
  const body = sanitizeShopeeReviewBody(r?.comment ?? '', author);
  if (!body) return null;

  return {
    author: author || 'Anonymous',
    rating: Number(r?.rating_star ?? 0),
    date: r?.ctime ? new Date(Number(r.ctime) * 1000).toISOString() : '',
    title: '',
    body,
    verified: !!(r?.is_buyer_purchase ?? false),
    images,
  };
}

function normalizeSpaces(text: string): string {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeShopeeReviewBody(rawBody: string, author: string): string {
  let body = normalizeSpaces(rawBody);
  if (!body) return '';

  body = body
    .replace(/\bhelpful\?\b/gi, ' ')
    .replace(/\b\d+\s*\|\s*variation\s*:\s*[^|]+/gi, ' ')
    .replace(/\b(?:variation|variant)\s*:\s*[^|]+/gi, ' ')
    .replace(/\b(?:color family|quantity)\s*:\s*[^|]+/gi, ' ');
  body = normalizeSpaces(body);
  if (!body) return '';

  const bodyLower = body.toLowerCase();
  const authorLower = normalizeSpaces(author).toLowerCase();
  if (authorLower && bodyLower === authorLower) return '';
  if (!hasReviewTextSignal(body) && body.split(/\s+/).filter(Boolean).length <= 5) return '';
  if (isMostlyUsernameBlob(body)) return '';

  return body;
}

function hasReviewTextSignal(text: string): boolean {
  if (!text) return false;
  if (/[.!?,]/.test(text)) return true;
  return /\b(good|great|nice|okay|ok|bad|poor|love|worth|recommended|legit|fake|scam|quality|item|product|delivery|seller|packaging|works|working|defective|damaged|broken|maganda|pangit|sira|maayos|mabilis|bilis|sulit|matibay|ayos)\b/i.test(
    text,
  );
}

function isMostlyUsernameBlob(text: string): boolean {
  const tokens = text.split(/\s+/).map((t) => t.trim()).filter(Boolean);
  if (tokens.length < 3) return false;
  if (hasReviewTextSignal(text)) return false;
  return tokens.every((t) => /^[a-z]+$/i.test(t) || /^[a-z0-9._-]+$/i.test(t));
}

