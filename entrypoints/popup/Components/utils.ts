export function normalizeInputUrl(input: string): string {
  const raw = (input ?? '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return encodeURI(raw);
  if (/^(?:[\w-]+\.)?(?:shopee\.ph|lazada\.(?:com\.ph|com))\//i.test(raw)) {
    return encodeURI(`https://${raw}`);
  }
  return raw;
}

export function isShopeeUrl(input: string): boolean {
  return /(?:^https?:\/\/)?(?:[\w-]+\.)?shopee\.ph\//i.test((input ?? '').trim());
}

export function isLazadaProductUrl(input: string): boolean {
  return /(?:^https?:\/\/)?(?:[\w-]+\.)?lazada\.(?:com\.ph|com)\/products\//i.test(
    (input ?? '').trim(),
  );
}

export function isSamePage(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.origin === ub.origin && ua.pathname === ub.pathname;
  } catch {
    return false;
  }
}

export async function waitForSupportedUrl(tabId: number, timeoutMs = 12000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const t = await chrome.tabs.get(tabId);
    const u = t.url ?? '';
    if (isShopeeUrl(u) || isLazadaProductUrl(u)) return;
    await new Promise((r) => setTimeout(r, 400));
  }
}

export async function waitForTabComplete(tabId: number, timeoutMs = 10000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const t = await chrome.tabs.get(tabId);
    if (t.status === 'complete') return;
    await new Promise((r) => setTimeout(r, 250));
  }
}

export async function sendScrapeMessageWithRetry(
  tabId: number,
  type: 'SCRAPE_LAZADA' | 'SCRAPE_SHOPEE',
): Promise<any> {
  let lastError = 'Failed to send scrape message.';
  for (let i = 0; i < 4; i++) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type });
      if (response) return response;
      lastError = 'No response from content script.';
    } catch (err: any) {
      lastError = err?.message ?? String(err);
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content-scripts/content.js'],
        });
      } catch {
        // ignore and retry
      }
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  throw new Error(lastError);
}

export function extractDisplayReviewSummary(input: string): string {
  const text = String(input ?? '').trim();
  if (!text) return 'No review summary generated.';
  if (!text.startsWith('{')) return text;

  try {
    const obj = JSON.parse(text);
    const reviewOnly = String(obj?.reviewSummary ?? '').trim();
    if (reviewOnly) return reviewOnly;
  } catch {
    return text;
  }

  return text;
}
