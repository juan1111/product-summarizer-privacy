import { useState } from "react";
import type { ScrapeResult } from "../types";
import { DataRow } from "../shared-ui";

function riskColor(risk: "low" | "medium" | "high") {
  if (risk === "low") return "text-emerald-600";
  if (risk === "medium") return "text-orange-500";
  return "text-red-600";
}

export function OverviewTab({ result }: { result: ScrapeResult }) {
  const [copiedUrl, setCopiedUrl] = useState(false);

  return (
    <div className="p-4 space-y-3">
      <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-2">
        <p className="text-[10px] uppercase tracking-wider text-orange-500">
          Product Overview
        </p>
        <DataRow label="Title" value={result.title} />
        <DataRow label="Price" value={result.price} accent />
        <DataRow
          label="Rating"
          value={
            result.rating
              ? `${result.rating} / 5 (${result.totalReviews} reviews)`
              : "No ratings yet"
          }
        />
        {result.sentiment && (
          <DataRow
            label="Sentiment"
            value={`${result.sentiment.overall} (P:${result.sentiment.positive} N:${result.sentiment.neutral} Neg:${result.sentiment.negative})`}
          />
        )}
        <DataRow label="Item ID" value={result.itemId} mono />
        <div className="flex gap-2 items-start">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 min-w-[60px] pt-0.5">
            URL
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-slate-700 leading-relaxed truncate">
              {result.url}
            </p>
            <button
              onClick={() => {
                navigator.clipboard.writeText(result.url);
                setCopiedUrl(true);
                setTimeout(() => setCopiedUrl(false), 1500);
              }}
              className="mt-1 text-[10px] px-2 py-1 rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600"
            >
              {copiedUrl ? "Copied!" : "Copy Link"}
            </button>
          </div>
        </div>
      </div>

      {result.aiSummary && (
        <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-orange-500">
            AI Risk Analysis
          </p>
          <div className="flex gap-2">
            <span className="text-[10px] uppercase tracking-wider text-slate-500 min-w-[60px] pt-0.5">
              Scam Risk
            </span>
            <span
              className={`text-xs flex-1 leading-relaxed font-bold ${riskColor(result.aiSummary.fraudRisk)}`}
            >
              {`${result.aiSummary.fraudRisk.toUpperCase()} (${result.aiSummary.fraudScore}/100)`}
            </span>
          </div>
          <DataRow label="Risk Note" value={result.aiSummary.fraudVerdict} />

          {(result.aiSummary.productSignals?.length > 0 ||
            result.aiSummary.scamSignals?.length > 0) && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">
                Product Risk Signals
              </p>
              <div className="space-y-1">
                {(result.aiSummary.productSignals?.length
                  ? result.aiSummary.productSignals
                  : result.aiSummary.scamSignals || []
                )
                  .slice(0, 6)
                  .map((s, i) => (
                    <p
                      key={`product-signal-${i}`}
                      className="text-[11px] text-slate-700 leading-relaxed"
                    >
                      - {s}
                    </p>
                  ))}
              </div>
            </div>
          )}

          {result.aiSummary.storeSignals?.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">
                Store/Seller Signals
              </p>
              <div className="space-y-1">
                {result.aiSummary.storeSignals.slice(0, 6).map((s, i) => (
                  <p
                    key={`store-signal-${i}`}
                    className="text-[11px] text-slate-700 leading-relaxed"
                  >
                    - {s}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
