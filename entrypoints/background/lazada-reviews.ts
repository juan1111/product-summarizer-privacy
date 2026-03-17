const RGV587_WAIT_MS = 8000;
const MAX_RETRIES = 3;
const TEMP_BLOCK_MESSAGE =
  'Lazada temporarily blocked review fetching. Please wait 1-5 minutes and try again.';

export async function fetchReviews(itemId: string) {
  const fiveStarReviews: any[] = [];
  const fourStarReviews: any[] = [];
  const threeStarReviews: any[] = [];
  const twoStarReviews: any[] = [];
  const oneStarReviews: any[] = [];
  const seen = new Set<string>();
  let totalReviews = 0;
  let rating: number | null = null;
  let temporaryBlockHint = 0;

  const cookies = await chrome.cookies.getAll({ domain: '.lazada.com.ph' });
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  console.log(`[BG][Lazada][1-star][Debug] start fetchReviews itemId=${itemId}`);

  // Star-filter-only flow: fetch 5* -> 1* buckets directly.
  temporaryBlockHint += await fillByFilter(itemId, cookieHeader, seen, fiveStarReviews, 5);
  temporaryBlockHint += await fillByFilter(itemId, cookieHeader, seen, fourStarReviews, 4);
  temporaryBlockHint += await fillByFilter(itemId, cookieHeader, seen, threeStarReviews, 3);
  temporaryBlockHint += await fillByFilter(itemId, cookieHeader, seen, twoStarReviews, 2);
  temporaryBlockHint += await fillByFilter(itemId, cookieHeader, seen, oneStarReviews, 1, true);

  console.log(
    `[BG][Lazada][1-star][Debug] final oneStarCount=${oneStarReviews.length} totalReturned=${
      fiveStarReviews.length +
      fourStarReviews.length +
      threeStarReviews.length +
      twoStarReviews.length +
      oneStarReviews.length
    }`,
  );

  const allReviews = [
    ...fiveStarReviews,
    ...fourStarReviews,
    ...threeStarReviews,
    ...twoStarReviews,
    ...oneStarReviews,
  ];

  // "Overall" is based on the combined fetched star buckets.
  totalReviews = allReviews.length;
  if (allReviews.length > 0) {
    const sum = allReviews.reduce((acc, r) => acc + (Number(r?.rating ?? 0) || 0), 0);
    const avg = sum / allReviews.length;
    rating = Number.isFinite(avg) ? Number(avg.toFixed(1)) : null;
  }

  if (allReviews.length === 0 && (totalReviews > 0 || temporaryBlockHint > 0)) {
    throw new Error(TEMP_BLOCK_MESSAGE);
  }

  return {
    reviews: [...allReviews],
    rating,
    totalReviews,
  };
}

async function seedOneStarPageOne(
  itemId: string,
  cookieHeader: string,
  seen: Set<string>,
  oneStarReviews: any[],
) {
  if (oneStarReviews.length >= 10) return;
  const url = `https://my.lazada.com.ph/pdp/review/getReviewList?itemId=${itemId}&pageSize=20&pageNo=1&filter=1`;
  const data = await fetchWithRetry(url, cookieHeader, itemId);
  const items = data?.model?.items ?? [];
  if (!Array.isArray(items) || items.length === 0) {
    console.log('[BG][Lazada][1-star][Debug] seed pageNo=1 filter=1 returned 0 items');
    return;
  }

  let added = 0;
  for (const raw of items) {
    const mapped = mapLazadaReview(raw);
    const key = `${mapped.author}|${mapped.date}|${mapped.body}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (mapped.rating === 1 && oneStarReviews.length < 10) {
      oneStarReviews.push(mapped);
      added++;
    }
  }

  console.log(
    `[BG][Lazada][1-star][Debug] seed pageNo=1 filter=1 items=${items.length} added=${added} oneStarCount=${oneStarReviews.length}`,
  );
}

async function fillByFilter(
  itemId: string,
  cookieHeader: string,
  seen: Set<string>,
  targetArr: any[],
  star: number,
  debugOneStar = false,
): Promise<number> {
  const maxPages = star === 1 ? 30 : 10;
  let emptyStreak = 0;
  let blockHint = 0;

  for (let page = 1; page <= maxPages; page++) {
    if (targetArr.length >= 10) break;

    const url = `https://my.lazada.com.ph/pdp/review/getReviewList?itemId=${itemId}&pageSize=20&pageNo=${page}&filter=${star}`;
    const data = await fetchWithRetry(url, cookieHeader, itemId);
    if (!data) {
      emptyStreak++;
      if (star !== 1 || emptyStreak >= 4) break;
      continue;
    }

    const items = data?.model?.items ?? [];
    const reviewCountHint = Number(data?.model?.ratings?.reviewCount ?? data?.model?.ratings?.rateCount ?? 0);
    if (!Array.isArray(items) || items.length === 0) {
      if (reviewCountHint > 0) blockHint++;
      emptyStreak++;
      if (debugOneStar && star === 1) {
        console.log(
          `[BG][Lazada][1-star][Debug] filter=1 page=${page} emptyStreak=${emptyStreak} oneStarCount=${targetArr.length}`,
        );
      }
      if (star !== 1 || emptyStreak >= 4) break;
      continue;
    }
    emptyStreak = 0;

    let added = 0;
    for (const raw of items) {
      const mapped = mapLazadaReview(raw);
      const key = `${mapped.author}|${mapped.date}|${mapped.body}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (mapped.rating === star && targetArr.length < 10) {
        targetArr.push(mapped);
        added++;
      }
    }

    if (debugOneStar && star === 1) {
      console.log(
        `[BG][Lazada][1-star][Debug] filter=1 page=${page} items=${items.length} added=${added} oneStarCount=${targetArr.length}`,
      );
    }

    await sleep(1200 + Math.random() * 1200);
  }

  return blockHint;
}

function mapLazadaReview(r: any) {
  const productReviewRating = Number(
    r?.rateDims?.PRODUCT_REVIEW ??
      r?.rateDims?.product_review ??
      r?.rateDims?.product ??
      r?.rating ??
      r?.score ??
      0,
  );

  return {
    body: r.reviewContent ?? r.content ?? r.body ?? '',
    author: r.reviewerName ?? r.buyerName ?? r.nickname ?? 'Anonymous',
    rating: Number.isFinite(productReviewRating) ? productReviewRating : 0,
    date: r.reviewTime ?? r.createdAt ?? r.gmtCreate ?? '',
    title: r.reviewTitle ?? r.title ?? '',
    verified: !!(r.buyerVerified ?? r.verified ?? false),
    images: (r.images ?? r.reviewImages ?? [])
      .map((img: any) => (typeof img === 'string' ? img : (img?.url ?? img?.src ?? '')))
      .filter(Boolean),
  };
}

function isTemporarilyBlockedPayload(data: any): boolean {
  if (!data || typeof data !== 'object') return false;

  const retArr: string[] = Array.isArray(data?.ret) ? data.ret : [];
  const hasKnownBlockCode = retArr.some(
    (r) => String(r).includes('RGV587') || String(r).includes('FAIL_SYS_USER_VALIDATE'),
  );
  if (hasKnownBlockCode) return true;

  // Lazada may return success=true with model=null when review API is temporarily blocked.
  return data?.success === true && data?.model == null;
}

async function fetchWithRetry(
  url: string,
  cookieHeader: string,
  itemId: string,
  attempt = 1,
): Promise<any | null> {
  let res: Response;

  try {
    res = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: `https://www.lazada.com.ph/products/i${itemId}.html`,
        'User-Agent': navigator.userAgent,
        'X-Requested-With': 'XMLHttpRequest',
      },
    });
  } catch (err: any) {
    console.error('[BG] network error:', err.message);
    return null;
  }

  if (!res.ok) {
    console.warn(`[BG] HTTP ${res.status}`);
    return null;
  }

  const data: any = await res.json().catch(() => null);
  if (!data || typeof data === 'string') return null;

  const isBlockedPayload = isTemporarilyBlockedPayload(data);
  if (!isBlockedPayload) return data;

  console.warn(`[BG] Lazada review API blocked payload (attempt ${attempt}/${MAX_RETRIES})`);
  if (attempt >= MAX_RETRIES) {
    console.error('[BG] Max retries reached for blocked payload');
    return data;
  }

  const waitMs = RGV587_WAIT_MS * attempt;
  await sleep(waitMs);

  const freshCookies = await chrome.cookies.getAll({ domain: '.lazada.com.ph' });
  const freshHeader = freshCookies.map((c) => `${c.name}=${c.value}`).join('; ');
  return fetchWithRetry(url, freshHeader, itemId, attempt + 1);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
