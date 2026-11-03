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
 * A variable as a color MapLibre can parse. The probe element resolves any
 * `var()` in the value; painting the result on one canvas pixel turns syntax
 * MapLibre rejects, such as `oklch()`, into sRGB.
 */
function readCSSVar(
  probe: HTMLElement,
  pixel: CanvasRenderingContext2D,
  name: string,
  fallback: string,
): string {
  probe.style.color = `var(${name}, ${fallback})`;
  pixel.clearRect(0, 0, 1, 1);
  pixel.fillStyle = getComputedStyle(probe).color;
  pixel.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = pixel.getImageData(0, 0, 1, 1).data;
  return a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${+(a / 255).toFixed(2)})`;
}

/** Reads the map colors from the `--sw-*` variables once per mount. */
export function useThemeColors(): ThemeColors {
  return useMemo(() => {
    if (typeof document === "undefined") return FALLBACKS;
    const probe = document.createElement("span");
    probe.style.display = "none";
    document.body.appendChild(probe);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const pixel = canvas.getContext("2d", { willReadFrequently: true })!;
    const read = (name: string, fallback: string) => readCSSVar(probe, pixel, name, fallback);
    try {
      return {
        steel: read("--sw-steel", FALLBACKS.steel),
        paper: read("--sw-paper", FALLBACKS.paper),
        go: read("--sw-go", FALLBACKS.go),
        graphHigh: read("--sw-graph-high", FALLBACKS.graphHigh),
        graphLow: read("--sw-graph-low", FALLBACKS.graphLow),
        mapInk: read("--sw-map-ink", FALLBACKS.mapInk),
        mapLabel: read("--sw-map-label", FALLBACKS.mapLabel),
      };
    } finally {
      probe.remove();
    }
  }, []);
}
