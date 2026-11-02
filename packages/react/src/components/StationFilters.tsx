import type { StationSummary } from "../types.js";

export type StationFilter = StationSummary["kind"] | undefined;

const CHIPS: { label: string; spoken: string; kind: StationFilter }[] = [
  { label: "All", spoken: "Show all", kind: undefined },
  { label: "Tides", spoken: "Show tides", kind: "tide" },
  { label: "Currents", spoken: "Show currents", kind: "current" },
];

export function StationFilters({
  value,
  onChange,
}: {
  value: StationFilter;
  onChange: (filter: StationFilter) => void;
}) {
  return (
    <div className="flex flex-wrap gap-x-1.5 px-1">
      {CHIPS.map((chip) => {
        const selected = value === chip.kind;
        return (
          <button
            key={chip.label}
            type="button"
            aria-label={chip.spoken}
            aria-pressed={selected}
            // Tapping the active filter returns to All.
            onClick={() => onChange(selected ? undefined : chip.kind)}
            className="flex min-h-11 cursor-pointer items-center border-0 bg-transparent p-0"
          >
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium bg-white/8 backdrop-blur-[20px] backdrop-saturate-[1.4] ${
                selected ? "text-(--sw-go)" : "text-(--sw-foam)/60"
              }`}
              style={selected ? { backgroundColor: "rgb(136 184 104 / 0.25)" } : undefined}
            >
              {chip.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
