import type { ScrapeResult } from "../types";
import { StarRating } from "../shared-ui";
import { extractDisplayReviewSummary } from "../utils";

const SHOW_REVIEW_COMMENTS = false;

export function ReviewsTab({ result }: { result: ScrapeResult }) {
  const visibleReviews = result.reviews;
  const fiveStarCount = visibleReviews.filter((review) => Number(review.rating) === 5).length;
  const fourStarCount = visibleReviews.filter((review) => Number(review.rating) === 4).length;
  const threeStarCount = visibleReviews.filter((review) => Number(review.rating) === 3).length;
  const twoStarCount = visibleReviews.filter((review) => Number(review.rating) === 2).length;
  const oneStarCount = visibleReviews.filter((review) => Number(review.rating) === 1).length;
  const reviewTexts = visibleReviews.map((review) =>
    `${review.title ?? ""} ${review.body ?? ""}`.trim(),
  );
  const proCounts = buildPointCounts(result.aiSummary?.pros ?? [], reviewTexts);
  const conCounts = buildPointCounts(result.aiSummary?.cons ?? [], reviewTexts);

  return (
    <div className="p-4 space-y-3">
      {result.aiSummary && (
        <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-orange-500">
            AI Review Summary
          </p>
          <p className="text-xs text-slate-700 leading-relaxed">
            {extractDisplayReviewSummary(result.aiSummary.reviewSummary)}
          </p>
          <p className="text-[10px] text-slate-500">
            Debug: 5* {fiveStarCount}/10 | 4* {fourStarCount}/10 | 3* {threeStarCount}/10 | 2* {twoStarCount}/10 | 1* {oneStarCount}/10
          </p>
          <p className="text-[10px] text-slate-500">
            Point counts are based on {visibleReviews.length} fetched reviews.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-emerald-400 mb-1">
                Pros
              </p>
              <div className="space-y-1">
                {(result.aiSummary.pros || []).slice(0, 6).map((pro, idx) => (
                  <p
                    key={`pro-${idx}`}
                    className="text-[11px] text-slate-700 leading-relaxed"
                  >
                    + {pro} {formatCount(proCounts[idx] ?? 0)}
                  </p>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-red-600 mb-1">
                Cons
              </p>
              <div className="space-y-1">
                {(result.aiSummary.cons || []).slice(0, 6).map((con, idx) => (
                  <p
                    key={`con-${idx}`}
                    className="text-[11px] text-slate-700 leading-relaxed"
                  >
                    - {con} {formatCount(conCounts[idx] ?? 0)}
                  </p>
                ))}
              </div>
            </div>
          </div>

          <div className="pt-1 space-y-2">
            <StarSummaryCard
              label="5* Summary"
              value={result.aiSummary.star5Summary}
            />
            <StarSummaryCard
              label="4* Summary"
              value={result.aiSummary.star4Summary}
            />
            <StarSummaryCard
              label="3* Summary"
              value={result.aiSummary.star3Summary}
            />
            <StarSummaryCard
              label="2* Summary"
              value={result.aiSummary.star2Summary}
            />
            <StarSummaryCard
              label="1* Summary"
              value={result.aiSummary.star1Summary}
            />
          </div>
        </div>
      )}

      {visibleReviews.length === 0 || !SHOW_REVIEW_COMMENTS ? (
        <div className="text-center py-8 text-slate-500 text-xs">
          <p className="text-2xl mb-2">Reviews</p>
          {/* <p className="text-slate-600">
            {SHOW_REVIEW_COMMENTS
              ? "No reviews fetched."
              : "Reviews/comments are temporarily hidden."}
          </p> */}
          {SHOW_REVIEW_COMMENTS && (
            <p className="text-slate-500 mt-1 leading-relaxed">
              Try scrolling to the reviews section on the product page first,
              then scrape again. Some reviews require being logged in.
            </p>
          )}
        </div>
      ) : (
        visibleReviews.map((review, i) => (
          <div
            key={i}
            className="bg-white border border-slate-200 rounded-lg p-3"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-slate-900">
                {review.author}
              </span>
              <span className="text-[10px] text-slate-500">{review.date}</span>
            </div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <StarRating rating={review.rating} />
              {review.verified && (
                <span className="text-[9px] bg-green-900 text-green-400 px-1.5 rounded">
                  Verified
                </span>
              )}
              {review.sentiment && (
                <span
                  className={`text-[9px] px-1.5 rounded ${
                    review.sentiment.label === "positive"
                      ? "bg-emerald-900 text-emerald-300"
                      : review.sentiment.label === "negative"
                        ? "bg-red-900 text-red-300"
                        : "bg-zinc-700 text-slate-700"
                  }`}
                >
                  {review.sentiment.label}
                </span>
              )}
            </div>
            {review.title && (
              <p className="text-xs font-medium text-slate-700 mb-0.5">
                {review.title}
              </p>
            )}
            <p className="text-[11px] text-slate-600 leading-relaxed">
              {review.body}
            </p>
          </div>
        ))
      )}
    </div>
  );
}

function buildPointCounts(points: string[], reviewTexts: string[]): number[] {
  if (!Array.isArray(points) || points.length === 0) return [];
  if (!Array.isArray(reviewTexts) || reviewTexts.length === 0)
    return points.map(() => 0);

  const normalizedPoints = points.map((point) => {
    const phrase = normalizePointText(point);
    return {
      phrase,
      tokens: extractPointTokens(phrase),
    };
  });

  const counts = points.map(() => 0);

  // One review contributes to at most one point.
  for (const rawText of reviewTexts) {
    const text = normalizePointText(rawText);
    if (!text) continue;

    const reviewTokenSet = new Set(extractPointTokens(text));
    let bestIdx = -1;
    let bestScore = 0;

    for (let i = 0; i < normalizedPoints.length; i++) {
      const point = normalizedPoints[i];
      if (!point.phrase || point.tokens.length === 0) continue;

      const score = computePointMatchScore(text, reviewTokenSet, point.phrase, point.tokens);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0 && bestScore > 0) counts[bestIdx]++;
  }

  return counts;
}

function computePointMatchScore(
  text: string,
  reviewTokenSet: Set<string>,
  phrase: string,
  phraseTokens: string[],
): number {
  if (!text || !phrase || phraseTokens.length === 0) return 0;
  if (text.includes(phrase)) return 100 + phraseTokens.length;

  const hits = phraseTokens.reduce((sum, token) => {
    if (reviewTokenSet.has(token)) return sum + 1;
    return sum;
  }, 0);

  const minHits = phraseTokens.length >= 4 ? 2 : 1;
  if (hits < minHits) return 0;
  return hits;
}

function extractPointTokens(text: string): string[] {
  const STOP = new Set([
    "the",
    "and",
    "for",
    "with",
    "very",
    "item",
    "product",
    "good",
    "great",
    "some",
    "can",
    "be",
    "to",
    "of",
  ]);
  return text
    .split(/\s+/)
    .map((t) => normalizeToken(t))
    .filter((t) => t.length >= 3)
    .filter((t) => !STOP.has(t));
}

function normalizeToken(token: string): string {
  let t = String(token ?? "")
    .toLowerCase()
    .trim();
  if (!t) return "";

  if (t.endsWith("ing") && t.length > 6) t = t.slice(0, -3);
  else if (t.endsWith("ed") && t.length > 5) t = t.slice(0, -2);
  else if (t.endsWith("es") && t.length > 5) t = t.slice(0, -2);
  else if (t.endsWith("s") && t.length > 4) t = t.slice(0, -1);
  return t;
}

function normalizePointText(text: string): string {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatCount(count: number): string {
  // Show only repeated points (2+ mentions).
  if (!Number.isFinite(count) || count <= 1) return "";
  return `(${count} reviews)`;
}

function StarSummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded p-2">
      <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
        {label}
      </p>
      <p className="text-[11px] text-slate-700 leading-relaxed">
        {value || "Limited review evidence"}
      </p>
    </div>
  );
}
