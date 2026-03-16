export function StarRating({
  rating,
  max = 5,
}: {
  rating: number;
  max?: number;
}) {
  return (
    <span className="flex gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <span
          key={i}
          className={`text-xs ${i < Math.round(rating) ? "text-orange-500" : "text-slate-500"}`}
        >
          ★
        </span>
      ))}
    </span>
  );
}

export function DataRow({
  label,
  value,
  accent,
  mono,
  truncate,
}: {
  label: string;
  value: string;
  accent?: boolean;
  mono?: boolean;
  truncate?: boolean;
}) {
  return (
    <div className="flex gap-2">
      <span className="text-[10px] uppercase tracking-wider text-slate-500 min-w-[60px] pt-0.5">
        {label}
      </span>
      <span
        className={`text-xs flex-1 leading-relaxed ${
          accent ? "text-orange-500 font-bold" : "text-slate-700"
        } ${mono ? "font-mono" : ""} ${truncate ? "truncate" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}
