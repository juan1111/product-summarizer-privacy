import { useCallback, useEffect, useRef, useState } from "react";
import { OverviewTab } from "./tabs/OverviewTab";
import { DescriptionTab } from "./tabs/DescriptionTab";
import { ReviewsTab } from "./tabs/ReviewsTab";
import { StarRating } from "./shared-ui";
import type { ScrapeResult, Tab } from "./types";
import {
  isLazadaProductUrl,
  isShopeeUrl,
  isSamePage,
  normalizeInputUrl,
  sendScrapeMessageWithRetry,
  waitForSupportedUrl,
  waitForTabComplete,
} from "./utils";

const ONBOARDING_KEY = "popup_onboarding_done";

export default function UrlPage() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("Scraping...");
  const [result, setResult] = useState<ScrapeResult | null>(null);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [copied, setCopied] = useState(false);
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const cancelAnalyzeRef = useRef(false);
  const analyzeRunIdRef = useRef(0);
  const activeTabIdRef = useRef<number | null>(null);

  const summarizeWithGemini = useCallback(async (scraped: ScrapeResult) => {
    const response = await chrome.runtime.sendMessage({
      type: "SUMMARIZE_WITH_GEMINI",
      payload: {
        title: scraped.title,
        price: scraped.price,
        description: scraped.description,
        reviews: scraped.reviews,
        skuOptions: scraped.skuOptions,
        sellerProfile: scraped.sellerProfile,
      },
    });

    if (response?.error) {
      throw new Error(response.error);
    }

    return response?.summary ?? null;
  }, []);

  const handleScrape = useCallback(async () => {
    const runId = ++analyzeRunIdRef.current;
    let onTabUpdated:
      | ((tabId: number, changeInfo: any, updatedTab: chrome.tabs.Tab) => void)
      | null = null;
    let trackedUrl = "";
    cancelAnalyzeRef.current = false;
    setError("");
    setResult(null);
    setLoading(true);
    setLoadingMsg("Finding tab...");

    try {
      const ensureNotCancelled = () => {
        if (cancelAnalyzeRef.current || analyzeRunIdRef.current !== runId) {
          throw new Error("ANALYZE_CANCELLED");
        }
      };

      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      ensureNotCancelled();
      if (!tab?.id) throw new Error("No active tab found.");

      activeTabIdRef.current = tab.id;
      const currentUrl = tab.url ?? "";
      trackedUrl = currentUrl;
      const targetUrl = normalizeInputUrl(url.trim());
      const targetIsLazada = isLazadaProductUrl(targetUrl);
      const targetIsShopee = isShopeeUrl(targetUrl);
      const targetIsSupported = targetIsLazada || targetIsShopee;
      const isLazada = isLazadaProductUrl(currentUrl);
      const isShopee = isShopeeUrl(currentUrl);

      const cancelByNavigation = (reason: string) => {
        if (cancelAnalyzeRef.current) return;
        cancelAnalyzeRef.current = true;
        analyzeRunIdRef.current += 1;
        if (activeTabIdRef.current) {
          chrome.tabs
            .sendMessage(activeTabIdRef.current, { type: "CANCEL_SCRAPE" })
            .catch(() => {});
        }
        setLoading(false);
        setLoadingMsg("Cancelled.");
        setError(reason);
      };

      if (
        targetUrl &&
        targetIsSupported &&
        !isSamePage(currentUrl, targetUrl)
      ) {
        setLoadingMsg("Navigating to page...");
        await chrome.tabs.update(tab.id, { url: targetUrl });
        await waitForSupportedUrl(tab.id, 15000);
        await waitForTabComplete(tab.id, 12000);
        await new Promise((r) => setTimeout(r, 700));
        trackedUrl = targetUrl;
        ensureNotCancelled();
      } else if (targetUrl && !targetIsSupported) {
        throw new Error("Please paste a valid Lazada/Shopee product URL.");
      } else if (!isLazada && !isShopee) {
        throw new Error(
          "Please navigate to a Lazada/Shopee product page first, or paste a product URL above.",
        );
      }

      const refreshedTab = await chrome.tabs.get(tab.id);
      ensureNotCancelled();
      const activeUrl = refreshedTab.url ?? "";
      trackedUrl = activeUrl || trackedUrl;
      const activeIsLazada = isLazadaProductUrl(activeUrl);
      const activeIsShopee = isShopeeUrl(activeUrl);
      const platform = activeIsLazada
        ? "lazada"
        : activeIsShopee
          ? "shopee"
          : targetIsLazada
            ? "lazada"
            : targetIsShopee
              ? "shopee"
              : null;

      if (!platform) {
        throw new Error(
          `Current tab is not a supported product page. URL: ${activeUrl || "unknown"}`,
        );
      }

      onTabUpdated = (
        updatedTabId: number,
        changeInfo: any,
        updatedTab: chrome.tabs.Tab,
      ) => {
        if (updatedTabId !== tab.id) return;
        const nextUrl = changeInfo.url ?? updatedTab?.url ?? "";
        if (!nextUrl) return;
        if (!isSamePage(trackedUrl, nextUrl)) {
          cancelByNavigation(
            "Analysis cancelled because you navigated to another product/page.",
          );
        }
      };
      chrome.tabs.onUpdated.addListener(onTabUpdated);

      setLoadingMsg("Extracting product data...");
      try {
        const injected = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content-scripts/content.js"],
        });
        ensureNotCancelled();
        console.log("[Popup][Debug] executeScript result:", injected);
      } catch (injectErr: any) {
        console.error("[Popup][Debug] executeScript failed:", injectErr);
      }

      setLoadingMsg(
        platform === "lazada"
          ? "Waiting for Lazada to load reviews... (up to 8s)"
          : "Fetching Shopee product + reviews...",
      );

      console.log("[Popup][Debug] sending message", {
        tabId: tab.id,
        platform,
        type: platform === "lazada" ? "SCRAPE_LAZADA" : "SCRAPE_SHOPEE",
        url: activeUrl,
      });
      const response = await sendScrapeMessageWithRetry(
        tab.id,
        platform === "lazada" ? "SCRAPE_LAZADA" : "SCRAPE_SHOPEE",
      );
      ensureNotCancelled();
      console.log("[Popup][Debug] message response:", response);

      if (response?.error) throw new Error(response.error);
      const scraped = response as ScrapeResult;

      setLoadingMsg("Generating AI summary with Gemini...");
      try {
        const summary = await summarizeWithGemini(scraped);
        ensureNotCancelled();
        if (summary) {
          scraped.aiSummary = summary;
        }
      } catch (aiErr: any) {
        console.warn("[Popup][Gemini] summarize failed:", aiErr);
      }

      setResult(scraped);
      setActiveTab("overview");
    } catch (e: any) {
      if (e?.message !== "ANALYZE_CANCELLED") {
        setError(e.message ?? "Something went wrong.");
      }
    } finally {
      if (onTabUpdated) {
        chrome.tabs.onUpdated.removeListener(onTabUpdated);
      }
      activeTabIdRef.current = null;
      if (analyzeRunIdRef.current === runId) {
        setLoading(false);
      }
    }
  }, [url, summarizeWithGemini]);

  const handleCancelAnalyze = useCallback(() => {
    cancelAnalyzeRef.current = true;
    analyzeRunIdRef.current += 1;
    if (activeTabIdRef.current) {
      chrome.tabs
        .sendMessage(activeTabIdRef.current, { type: "CANCEL_SCRAPE" })
        .catch(() => {});
    }
    setLoading(false);
    setLoadingMsg("Cancelled.");
  }, []);

  const handleCopyJSON = () => {
    if (!result) return;
    navigator.clipboard.writeText(JSON.stringify(result, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleScrape();
  };

  useEffect(() => {
    chrome.storage.local.get([ONBOARDING_KEY], (res) => {
      const done = Boolean(res?.[ONBOARDING_KEY]);
      setShowOnboarding(!done);
      setOnboardingChecked(true);
    });
  }, []);

  if (!onboardingChecked) {
    return (
      <div
        className="flex items-center justify-center min-h-screen bg-[#eef1f7]"
        style={{ width: 420 }}
      >
        <p className="text-xs text-slate-500">Loading...</p>
      </div>
    );
  }

  return (
    <div
      className="relative flex flex-col min-h-screen w-full bg-[#eef1f7]"
      style={{ minWidth: 360 }}
    >
      <OnboardingModal
        open={showOnboarding}
        tutorialStep={tutorialStep}
        onClose={() => {
          chrome.storage.local.set({ [ONBOARDING_KEY]: true });
          setShowOnboarding(false);
          setTutorialStep(0);
        }}
        onNext={() =>
          setTutorialStep((prev) =>
            Math.min(prev + 1, TUTORIAL_STEPS.length - 1),
          )
        }
        onPrev={() => setTutorialStep((prev) => Math.max(prev - 1, 0))}
      />

      <HeaderSection
        url={url}
        loading={loading}
        loadingMsg={loadingMsg}
        error={error}
        onChangeUrl={setUrl}
        onKeyDown={handleKeyDown}
        onAction={loading ? handleCancelAnalyze : handleScrape}
      />

      {result && (
        <>
          <ProductHeader result={result} />
          <TabsBar
            activeTab={activeTab}
            onChange={setActiveTab}
            result={result}
          />

          <div className="flex-1 min-h-0 overflow-y-auto">
            {activeTab === "overview" && <OverviewTab result={result} />}
            {activeTab === "description" && <DescriptionTab result={result} />}
            {activeTab === "reviews" && <ReviewsTab result={result} />}
          </div>

          <FooterActions
            copied={copied}
            result={result}
            onCopyJSON={handleCopyJSON}
          />
        </>
      )}

      {!result && !loading && !error && <EmptyState />}

      {!showOnboarding && (
        <button
          onClick={() => {
            setTutorialStep(0);
            setShowOnboarding(true);
          }}
          className="absolute bottom-3 right-3 text-[10px] px-2.5 py-1.5 rounded-md bg-slate-100 border border-slate-200 text-slate-600 hover:text-slate-800 shadow-sm"
        >
          Help
        </button>
      )}
    </div>
  );
}

function HeaderSection({
  url,
  loading,
  loadingMsg,
  error,
  onChangeUrl,
  onKeyDown,
  onAction,
}: {
  url: string;
  loading: boolean;
  loadingMsg: string;
  error: string;
  onChangeUrl: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onAction: () => void;
}) {
  return (
    <div className="px-5 pt-6 pb-4 border-b border-slate-200">
      <div className="relative flex flex-col items-center text-center gap-1 mb-4">
        <span className="text-4xl font-bold tracking-tight text-slate-900">
          VeriBuy
        </span>
        <span className="text-[12px] text-slate-500">
          Verify before you buy! Paste any product URL and analyze instantly
        </span>
        <span className="absolute right-0 top-0 text-[10px] text-slate-400 font-mono">
          v1.0
        </span>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={url}
          onChange={(e) => onChangeUrl(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Paste Lazada/Shopee product URL (or scrape active tab)"
          className="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-900 placeholder-slate-400 outline-none focus:border-indigo-400 transition-colors"
        />
        <button
          onClick={onAction}
          className="px-4 py-2 bg-gradient-to-r from-blue-300 to-purple-300 hover:from-blue-400 hover:to-purple-400 disabled:from-slate-300 disabled:to-slate-300 disabled:cursor-not-allowed rounded-lg text-xs font-bold text-white transition-colors whitespace-nowrap"
        >
          {loading ? "Cancel" : "Analyze Product"}
        </button>
      </div>

      {loading && (
        <div className="mt-2 flex items-center gap-2 text-xs text-orange-500">
          <svg
            className="animate-spin h-3 w-3 flex-shrink-0"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          {loadingMsg}
        </div>
      )}

      {error && (
        <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">
          ⚠ {error}
        </div>
      )}
    </div>
  );
}

function ProductHeader({ result }: { result: ScrapeResult }) {
  return (
    <div className="px-4 py-3 border-b border-slate-200 bg-white">
      <div className="flex gap-3">
        {result.images[0] && (
          <img
            src={result.images[0]}
            alt={result.title}
            className="w-14 h-14 rounded-lg object-cover border border-slate-200 flex-shrink-0"
          />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs text-slate-900 font-semibold leading-tight line-clamp-2 mb-1">
            {result.title}
          </p>
          <div className="flex items-center gap-2">
            <span className="text-orange-500 font-bold text-sm">
              {result.price}
            </span>
            {result.rating && (
              <span className="flex items-center gap-1">
                <StarRating rating={Number(result.rating)} />
                <span className="text-[10px] text-slate-500">
                  {Number(result.rating).toFixed(1)} ({result.totalReviews})
                </span>
              </span>
            )}
          </div>
          <p className="text-[10px] text-slate-500 font-mono mt-0.5">
            ID: {result.itemId}
          </p>
        </div>
      </div>
    </div>
  );
}

function TabsBar({
  activeTab,
  onChange,
  result,
}: {
  activeTab: Tab;
  onChange: (tab: Tab) => void;
  result: ScrapeResult;
}) {
  return (
    <div className="flex border-b border-slate-200">
      {(["overview", "description", "reviews"] as Tab[]).map((tab) => (
        <button
          key={tab}
          onClick={() => onChange(tab)}
          className={`flex-1 py-2 text-xs font-semibold uppercase tracking-wider transition-colors ${
            activeTab === tab
              ? "text-orange-500 border-b-2 border-orange-500 bg-white/30"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          {tab}
          {tab === "reviews" && result.totalReviews > 0 && (
            <span className="ml-1 text-[9px] bg-orange-500 text-white rounded-full px-1.5">
              {result.reviews.length}/{result.totalReviews}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function FooterActions({
  copied,
  result,
  onCopyJSON,
}: {
  copied: boolean;
  result: ScrapeResult;
  onCopyJSON: () => void;
}) {
  return (
    <div className="px-4 py-3 border-t border-slate-200 flex gap-2">
      <button
        onClick={onCopyJSON}
        className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-semibold text-slate-700 transition-colors"
      >
        {copied ? "✓ Copied!" : "{ } Copy JSON"}
      </button>
      <button
        onClick={() => {
          const blob = new Blob([JSON.stringify(result, null, 2)], {
            type: "application/json",
          });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `${result.platform ?? "product"}-${result.itemId}.json`;
          a.click();
        }}
        className="flex-1 py-2 bg-orange-500 hover:bg-orange-400 rounded-lg text-xs font-bold text-white transition-colors"
      >
        ↓ Export JSON
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
      <p className="text-sm text-slate-700 font-semibold mb-1">
        Ready to analyze
      </p>
      <p className="text-xs text-slate-500 leading-relaxed">
        Navigate to a Lazada or Shopee product page and click SCRAPE, or paste a
        product URL above.
      </p>
      <div className="mt-5 text-xs text-slate-500">Supported platforms:</div>
      <div className="mt-2 flex gap-2">
        <span className="px-2.5 py-1 rounded-full text-[11px] bg-blue-100 text-blue-700">
          Lazada
        </span>
        <span className="px-2.5 py-1 rounded-full text-[11px] bg-rose-100 text-rose-700">
          Shopee
        </span>
      </div>
    </div>
  );
}

function OnboardingModal({
  open,
  tutorialStep,
  onClose,
  onNext,
  onPrev,
}: {
  open: boolean;
  tutorialStep: number;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
}) {
  if (!open) return null;

  return (
    <div className="absolute inset-0 z-30 bg-slate-950/35 backdrop-blur-[1px] p-4 flex items-center">
      <div className="w-full bg-white border border-slate-200 rounded-xl shadow-lg p-4">
        <p className="text-[10px] uppercase tracking-wider text-orange-500 mb-1">
          Quick Tutorial
        </p>
        <p className="text-sm font-semibold text-slate-900">
          {TUTORIAL_STEPS[tutorialStep].title}
        </p>
        <p className="text-xs text-slate-600 mt-1 leading-relaxed">
          {TUTORIAL_STEPS[tutorialStep].description}
        </p>

        <div className="mt-3 flex items-center gap-1.5">
          {TUTORIAL_STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === tutorialStep ? "w-6 bg-orange-500" : "w-2 bg-slate-300"
              }`}
            />
          ))}
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={onClose}
            className="px-2.5 py-1.5 text-[11px] text-slate-500 hover:text-slate-700"
          >
            Skip
          </button>
          <button
            onClick={onPrev}
            disabled={tutorialStep === 0}
            className="px-2.5 py-1.5 text-[11px] rounded border border-slate-200 text-slate-600 disabled:opacity-40"
          >
            Back
          </button>
          {tutorialStep < TUTORIAL_STEPS.length - 1 ? (
            <button
              onClick={onNext}
              className="ml-auto px-3 py-1.5 text-[11px] rounded bg-orange-500 hover:bg-orange-400 text-white font-semibold"
            >
              Next
            </button>
          ) : (
            <button
              onClick={onClose}
              className="ml-auto px-3 py-1.5 text-[11px] rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
            >
              Finish
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const TUTORIAL_STEPS = [
  {
    title: "Paste or Open Product Page",
    description:
      "Paste a Lazada/Shopee product URL, or stay on an active product tab.",
  },
  {
    title: "Click Analyze Product",
    description:
      "The extension navigates (if needed), injects scraper, and extracts product data.",
  },
  {
    title: "Review Results",
    description:
      "Check Overview, Description, and Reviews tabs for extracted data and AI summary.",
  },
  {
    title: "Login for Better Results",
    description:
      "For more complete price/rating/review data, login first to Lazada or Shopee before scraping.",
  },
  {
    title: "Copy or Export",
    description:
      "Use Copy JSON or Export JSON for your thesis workflow and analysis.",
  },
];
