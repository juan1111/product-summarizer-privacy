import { summarizeWithGemini } from './background/gemini';
import { fetchReviews, fetchShopeeReviews } from './background/reviews';

export default defineBackground(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'FETCH_REVIEWS') {
      fetchReviews(message.itemId)
        .then(sendResponse)
        .catch((err) => sendResponse({ error: err.message }));
      return true;
    }

    if (message.type === 'FETCH_SHOPEE_REVIEWS') {
      fetchShopeeReviews(message.shopId, message.itemId)
        .then(sendResponse)
        .catch((err) => sendResponse({ error: err.message }));
      return true;
    }

    if (message.type === 'SUMMARIZE_WITH_GEMINI') {
      summarizeWithGemini(message.payload)
        .then((summary) => sendResponse({ summary }))
        .catch((err) => sendResponse({ error: err.message }));
      return true;
    }
  });
});
