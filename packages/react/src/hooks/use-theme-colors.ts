import { useMemo } from "react";

/** The map's colors, resolved from the `--sw-*` variables for MapLibre's paint properties. */
export interface ThemeColors {
  /** A station whose state the map doesn't know. */
  steel: string;
  /** The focused station. */
  paper: string;
  /** The plate under every pin, and the halo under labels. */
  mapInk: string;
  mapLabel: string;
}

const FALLBACKS: ThemeColors = {
  steel: "#5888a8",
  paper: "#fcfcfc",
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
        mapInk: readCSSVar(probe, "--sw-map-ink", FALLBACKS.mapInk),
        mapLabel: readCSSVar(probe, "--sw-map-label", FALLBACKS.mapLabel),
      };
    } finally {
      probe.remove();
    }
  }, []);
}
