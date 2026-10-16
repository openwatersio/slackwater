import { useMemo } from "react";

/** The map's colors, resolved from the `--sw-*` variables for MapLibre's paint properties. */
export interface ThemeColors {
  /** A station whose state the map doesn't know. */
  steel: string;
  paper: string;
  /** A current at slack. */
  go: string;
  /** A rising tide. */
  graphHigh: string;
  /** A falling tide. */
  graphLow: string;
  /** The plate under every pin, and the halo under labels. */
  mapInk: string;
  mapLabel: string;
}

const FALLBACKS: ThemeColors = {
  steel: "#5888a8",
  paper: "#fcfcfc",
  go: "#88b868",
  graphHigh: "#2dd4bf",
  graphLow: "#fbbf24",
  mapInk: "#152256",
  mapLabel: "#ffffff",
};

/**
 * A variable as a computed color MapLibre can parse: applied as the `color` of
 * a probe element and read back, since the raw value may itself be a `var()`.
 */
function readCSSVar(probe: HTMLElement, name: string, fallback: string): string {
  probe.style.color = `var(${name}, ${fallback})`;
  return getComputedStyle(probe).color;
}

/** Reads the map colors from the `--sw-*` variables once per mount. */
export function useThemeColors(): ThemeColors {
  return useMemo(() => {
    if (typeof document === "undefined") return FALLBACKS;
    const probe = document.createElement("span");
    probe.style.display = "none";
    document.body.appendChild(probe);
    try {
      return {
        steel: readCSSVar(probe, "--sw-steel", FALLBACKS.steel),
        paper: readCSSVar(probe, "--sw-paper", FALLBACKS.paper),
        go: readCSSVar(probe, "--sw-go", FALLBACKS.go),
        graphHigh: readCSSVar(probe, "--sw-graph-high", FALLBACKS.graphHigh),
        graphLow: readCSSVar(probe, "--sw-graph-low", FALLBACKS.graphLow),
        mapInk: readCSSVar(probe, "--sw-map-ink", FALLBACKS.mapInk),
        mapLabel: readCSSVar(probe, "--sw-map-label", FALLBACKS.mapLabel),
      };
    } finally {
      probe.remove();
    }
  }, []);
}
