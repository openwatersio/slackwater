import { useEffect, useId, useRef, useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";

import { useCurrentStations } from "../hooks/use-current-station.js";
import { useStations } from "../hooks/use-stations.js";
import type { StationSummary } from "../types.js";
import { SEARCH_LIMIT, rankSearch } from "../utils/card.js";
import { StationCard, type CardStation } from "./StationCard.js";
import { StationCredits } from "./StationCredits.js";

export interface StationSearchProps {
  /** Called with the picked station; its `kind` says which routes serve it. */
  onSelect: (station: CardStation) => void;
  placeholder?: string;
  className?: string;
}

type Filter = StationSummary["kind"] | undefined;

const CHIPS: { label: string; spoken: string; kind: Filter }[] = [
  { label: "All", spoken: "Show all", kind: undefined },
  { label: "Tides", spoken: "Show tides", kind: "tide" },
  { label: "Currents", spoken: "Show currents", kind: "current" },
];

const GLASS = "bg-white/8 backdrop-blur-[20px] backdrop-saturate-[1.4]";

/**
 * Station search after the app's: a field, the All / Tides / Currents
 * filter, and the matching stations of both kinds as cards.
 */
export function StationSearch({
  onSelect,
  placeholder = "Harbor, bay, or channel",
  className,
}: StationSearchProps) {
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  const [filter, setFilter] = useState<Filter>();
  const resultsId = useId();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearched(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const active = searched.length >= 2;
  const params = { query: searched, maxResults: SEARCH_LIMIT };
  const options = { enabled: active, placeholderData: keepPreviousData };
  const tides = useStations(params, options);
  const currents = useCurrentStations(params, options);
  const settled = active && !tides.isFetching && !currents.isFetching;
  // Results change once both kinds have answered, so the cards don't reshuffle as each arrives.
  const shown = useRef<{ results: CardStation[]; cut: boolean }>({ results: [], cut: false });
  if (!active) shown.current = { results: [], cut: false };
  else if (settled) {
    const lists = [
      filter === "current" ? [] : (tides.data ?? []),
      filter === "tide" ? [] : (currents.data ?? []),
    ];
    const results = rankSearch<CardStation>(searched, lists);
    // A kind that filled its request may have had more, and the merge may have dropped some.
    const cut =
      lists.some((list) => list.length >= SEARCH_LIMIT) || lists.flat().length > results.length;
    shown.current = { results, cut };
  }
  const { results, cut } = shown.current;
  // An API without the current routes still finds its tide stations.
  const error = tides.error && currents.error ? tides.error : undefined;

  return (
    <div className={`flex flex-col text-white ${className ?? ""}`} role="search">
      <div
        className={`flex min-h-12 items-center gap-[9px] rounded-full px-4 py-[13px] focus-within:ring-2 focus-within:ring-(--sw-go)/40 ${GLASS}`}
      >
        <svg
          width={17}
          height={17}
          viewBox="0 0 16 16"
          aria-hidden="true"
          className="shrink-0 text-(--sw-foam)/70"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
        >
          <circle cx={6.8} cy={6.8} r={5.3} />
          <path d="m10.8 10.8 4 4" />
        </svg>
        <input
          ref={input}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQuery("");
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          aria-controls={resultsId}
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[17px] text-(--sw-paper) outline-none placeholder:text-(--sw-foam)/62 [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            type="button"
            aria-label="Clear search text"
            onClick={() => {
              setQuery("");
              input.current?.focus();
            }}
            // A 44 px target around the 17 px glyph, without growing the field.
            className="-m-[13.5px] flex shrink-0 cursor-pointer border-0 bg-transparent p-[13.5px] text-(--sw-foam)/50"
          >
            <svg width={17} height={17} viewBox="0 0 16 16" aria-hidden="true">
              <circle cx={8} cy={8} r={8} fill="currentColor" />
              <path
                d="m5.3 5.3 5.4 5.4m0-5.4-5.4 5.4"
                stroke="var(--sw-canvas)"
                strokeWidth={1.6}
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-x-1.5 px-1">
        {CHIPS.map((chip) => {
          const selected = filter === chip.kind;
          return (
            <button
              key={chip.label}
              type="button"
              aria-label={chip.spoken}
              aria-pressed={selected}
              // Tapping the active filter returns to All.
              onClick={() => setFilter(selected ? undefined : chip.kind)}
              className="flex min-h-11 cursor-pointer items-center border-0 bg-transparent p-0"
            >
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${GLASS} ${
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

      <div id={resultsId} className="flex flex-col gap-3 pt-1.5">
        <p className="sr-only" role="status">
          {settled ? (results.length ? `${results.length} stations` : "No matches") : ""}
        </p>
        {error ? (
          <p className="m-0 px-1.5 text-sm text-(--sw-attention)">{error.message}</p>
        ) : settled && results.length === 0 ? (
          <p className="m-0 px-1.5 text-[17px] text-(--sw-foam)/62" aria-hidden="true">
            No matches
          </p>
        ) : (
          cut && (
            // Said above the results, where it is read, not sixty cards down.
            <p className="m-0 px-1.5 font-(family-name:--sw-font-mono) text-[11px] font-medium tracking-[1.2px] text-(--sw-foam)/50 uppercase">
              First {SEARCH_LIMIT} — keep typing to narrow
            </p>
          )
        )}
        {results.length > 0 && (
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,360px),1fr))] gap-3 p-0">
            {results.map((station) => (
              <li key={`${station.kind}:${station.id}`}>
                <StationCard station={station} onSelect={onSelect} />
              </li>
            ))}
          </ul>
        )}
        <StationCredits stations={results} />
      </div>
    </div>
  );
}
