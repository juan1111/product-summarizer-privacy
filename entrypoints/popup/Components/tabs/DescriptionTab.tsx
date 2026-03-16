import type { ScrapeResult } from "../types";

export function DescriptionTab({ result }: { result: ScrapeResult }) {
  return (
    <div className="p-4 space-y-3">
      {result.aiSummary?.descriptionSummary && (
        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <p className="text-[10px] uppercase tracking-wider text-orange-500 mb-1.5">
            AI Description Summary
          </p>
          <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">
            {result.aiSummary.descriptionSummary}
          </p>
        </div>
      )}
      {!result.aiSummary?.descriptionSummary && (
        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <p className="text-xs text-slate-600 leading-relaxed">
            No AI description summary generated.
          </p>
        </div>
      )}
    </div>
  );
}
