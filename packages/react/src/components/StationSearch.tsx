import { useState, useRef, useCallback, useEffect, useId, type KeyboardEvent } from "react";

import { useStations } from "../hooks/use-stations.js";
import type { StationSummary } from "../types.js";

const RECENT_KEY = "slackwater-recent-searches";
const MAX_RECENT = 5;

function getRecentSearches(): StationSummary[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed = raw ? (JSON.parse(raw) as StationSummary[]) : [];
    // Discard entries persisted by older versions that lack the full station shape
    return parsed.filter((r) => typeof r.latitude === "number");
  } catch {
    return [];
  }
}

function saveRecentSearch(station: StationSummary): void {
  try {
    const recent = getRecentSearches().filter((r) => r.id !== station.id);
    recent.unshift(station);
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
  } catch {
    // Ignore localStorage errors
  }
}

export interface StationSearchProps {
  onSelect: (station: StationSummary) => void;
  placeholder?: string;
  className?: string;
}

export function StationSearch({
  onSelect,
  placeholder = "Search stations...",
  className,
}: StationSearchProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [recentSearches, setRecentSearches] = useState<StationSummary[]>([]);
  const instanceId = useId();
  const listboxId = `${instanceId}-results`;
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Load recent searches on mount
  useEffect(() => {
    setRecentSearches(getRecentSearches());
  }, []);

  // Debounce the query
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const { data: results = [] } = useStations(
    { query: debouncedQuery },
    { enabled: debouncedQuery.length >= 2 },
  );

  const showResults = isOpen && debouncedQuery.length >= 2 && results.length > 0;
  // !showResults guards the debounce window where the input is cleared but the
  // debounced query still has results — both lists would render with the same id
  const showRecent = isOpen && !showResults && query.length === 0 && recentSearches.length > 0;

  const handleSelect = useCallback(
    (station: StationSummary) => {
      setQuery(station.name);
      setIsOpen(false);
      setActiveIndex(-1);
      saveRecentSearch(station);
      setRecentSearches(getRecentSearches());
      onSelect(station);
    },
    [onSelect],
  );

  const handleRecentSelect = useCallback(
    (recent: StationSummary) => {
      setQuery(recent.name);
      setIsOpen(false);
      setActiveIndex(-1);
      onSelect(recent);
    },
    [onSelect],
  );

  const dropdownItems = showResults ? results : [];
  const totalItems = showRecent ? recentSearches.length : dropdownItems.length;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (!showResults && !showRecent) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((i) => Math.min(i + 1, totalItems - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (activeIndex >= 0 && activeIndex < totalItems) {
            if (showRecent) {
              handleRecentSelect(recentSearches[activeIndex]);
            } else {
              handleSelect(dropdownItems[activeIndex]);
            }
          }
          break;
        case "Escape":
          setIsOpen(false);
          setActiveIndex(-1);
          break;
      }
    },
    [
      showResults,
      showRecent,
      dropdownItems,
      recentSearches,
      activeIndex,
      totalItems,
      handleSelect,
      handleRecentSelect,
    ],
  );

  return (
    <div className={`relative ${className ?? ""}`}>
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIsOpen(true);
          setActiveIndex(-1);
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => {
          // Delay to allow click on result
          setTimeout(() => setIsOpen(false), 200);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full min-h-12 px-4 py-[13px] border border-white/10 rounded-full bg-white/8 backdrop-blur-xl text-white text-[17px] placeholder:text-(--sw-foam)/62 outline-none transition-colors focus:border-(--sw-go)/60 focus:ring-2 focus:ring-(--sw-go)/25"
        role="combobox"
        aria-expanded={showResults || showRecent}
        aria-controls={listboxId}
        aria-activedescendant={activeIndex >= 0 ? `${instanceId}-option-${activeIndex}` : undefined}
        autoComplete="off"
      />
      {showRecent && (
        <ul
          ref={listRef}
          id={listboxId}
          className="absolute top-full left-0 right-0 z-50 mt-2 p-1 list-none bg-(--sw-canvas) border-[0.5px] border-(--sw-card-stroke) rounded-[18px] shadow-md max-h-80 overflow-y-auto"
          role="listbox"
        >
          <li
            className="px-3 py-1 font-mono text-[11px] font-medium uppercase tracking-[1.6px] text-(--sw-go)"
            role="presentation"
          >
            Recent
          </li>
          {recentSearches.map((recent, i) => (
            <li
              key={recent.id}
              id={`${instanceId}-option-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              className={`flex flex-col px-3 py-2 rounded-xl cursor-pointer ${
                i === activeIndex ? "bg-white/8" : "hover:bg-white/5"
              }`}
              onMouseDown={() => handleRecentSelect(recent)}
            >
              <span className="text-[15px] font-medium text-white">{recent.name}</span>
              <span className="text-xs text-(--sw-foam)/55">
                {[recent.region, recent.country].filter(Boolean).join(", ")}
              </span>
            </li>
          ))}
        </ul>
      )}
      {showResults && (
        <ul
          ref={listRef}
          id={listboxId}
          className="absolute top-full left-0 right-0 z-50 mt-2 p-1 list-none bg-(--sw-canvas) border-[0.5px] border-(--sw-card-stroke) rounded-[18px] shadow-md max-h-80 overflow-y-auto"
          role="listbox"
        >
          {results.map((station, i) => (
            <li
              key={station.id}
              id={`${instanceId}-option-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              className={`flex flex-col px-3 py-2 rounded-xl cursor-pointer ${
                i === activeIndex ? "bg-white/8" : "hover:bg-white/5"
              }`}
              onMouseDown={() => handleSelect(station)}
            >
              <span className="text-[15px] font-medium text-white">{station.name}</span>
              <span className="text-xs text-(--sw-foam)/55">
                {[station.region, station.country].filter(Boolean).join(", ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
