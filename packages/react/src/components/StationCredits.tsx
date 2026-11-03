import { useMemo } from "react";

import type { StationSummary } from "../types.js";
import { distinctCredits } from "../utils/credit.js";

export interface StationCreditsProps {
  /** The stations shown; each distinct `attribution` among them is printed once. */
  stations: Pick<StationSummary, "attribution">[];
  className?: string;
}

/** The shown stations' credits, once under a list, because a credit runs to a paragraph that no card has room for. */
export function StationCredits({ stations, className }: StationCreditsProps) {
  const credits = useMemo(() => distinctCredits(stations.map((s) => s.attribution)), [stations]);
  if (credits.length === 0) return null;
  return (
    <div
      className={`flex flex-col gap-2 px-1.5 text-[11px] leading-snug text-(--sw-foam)/62 wrap-anywhere ${className ?? ""}`}
      style={{ fontFamily: "var(--sw-font-sans)" }}
    >
      {credits.map((credit) => (
        <p key={credit} className="m-0">
          {credit}
        </p>
      ))}
    </div>
  );
}
