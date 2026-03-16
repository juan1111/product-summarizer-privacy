import { scrapeLazadaData } from './content/lazada';
import { scrapeShopeeData } from './content/shopee';

export default defineContentScript({
  matches: [
    'https://*.lazada.com.ph/products/*',
    'https://*.lazada.com/products/*',
    'https://shopee.ph/*',
    'https://*.shopee.ph/*',
  ],
  main() {
    let activeCancelState: { cancelled: boolean } | null = null;

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === 'CANCEL_SCRAPE') {
        if (activeCancelState) activeCancelState.cancelled = true;
        sendResponse({ ok: true });
        return;
      }

      if (message.type === 'SCRAPE_LAZADA') {
        const cancelState = { cancelled: false };
        activeCancelState = cancelState;
        scrapeLazadaData()
          .then((data) => {
            if (cancelState.cancelled) return sendResponse({ error: 'SCRAPE_CANCELLED' });
            sendResponse(data);
          })
          .catch((err) => sendResponse({ error: err.message }));
        return true;
      }

      if (message.type === 'SCRAPE_SHOPEE') {
        const cancelState = { cancelled: false };
        activeCancelState = cancelState;
        scrapeShopeeData(() => cancelState.cancelled)
          .then((data) => {
            if (cancelState.cancelled) return sendResponse({ error: 'SCRAPE_CANCELLED' });
            sendResponse(data);
          })
          .catch((err) => sendResponse({ error: err.message }));
        return true;
      }
    });
  },
});
