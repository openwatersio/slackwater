import type { Station } from "@slackwater/database";

export interface Versions {
  server: string;
  engine: string;
  database: string;
}
export interface StationInfo {
  id: string;
  name: string;
  kind: Station["kind"];
  latitude: number;
  longitude: number;
  timezone: string;
  source: Station["source"];
  license: Station["license"];
  attribution: string;
  type: Station["type"];
  chart_datum?: string;
  datums: string[];
  reference?: string;
  flood_direction?: number;
  ebb_direction?: number;
  bins: string[];
  predictions: boolean;
  unavailable?: { code: string; message: string };
  discoverable: boolean;
  search: string;
  aliases: string[];
}
export interface CatalogIndex {
  versions: Versions;
  stations: StationInfo[];
  aliases: Record<string, string>;
  files?: Record<string, string>;
}
export interface SearchInput {
  kind: Station["kind"];
  query?: string;
  latitude?: number;
  longitude?: number;
  radius_nm?: number;
}
export class ToolError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function normalize(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}
export class Catalog {
  private entries: Map<string, StationInfo>;
  constructor(
    public index: CatalogIndex,
    private readModel: (id: string) => Promise<Station | undefined>,
  ) {
    this.entries = new Map(index.stations.map((s) => [s.id, s]));
  }
  station(id: string): StationInfo & { requested_id: string } {
    const canonical = Object.hasOwn(this.index.aliases, id) ? this.index.aliases[id] : id;
    const station = this.entries.get(canonical);
    if (!station) {
      const primary = this.entries.get(canonical.replace(/@\d+$/, ""));
      throw new ToolError(
        "not_found",
        `Station not found: ${id}${primary ? `. Available bins: ${primary.bins.join(", ")}` : ""}`,
      );
    }
    return { ...station, requested_id: id };
  }
  async model(id: string): Promise<Station> {
    const info = this.station(id);
    if (!info.predictions) throw new ToolError(info.unavailable!.code, info.unavailable!.message);
    const model = await this.readModel(info.id);
    if (!model || model.id !== info.id)
      throw new ToolError("catalog_error", "Station model does not match the catalog");
    return model;
  }
  find(input: SearchInput) {
    const query = normalize(input.query?.trim() ?? "");
    const located = input.latitude !== undefined && input.longitude !== undefined;
    if (
      (input.latitude === undefined) !== (input.longitude === undefined) ||
      (!query && !located) ||
      (query && located)
    )
      throw new ToolError("invalid_input", "Supply either a query or a coordinate pair");
    if (query.length > 100 || (query && query.length < 2))
      throw new ToolError("invalid_input", "Search text must contain 2 to 100 characters");
    if (
      located &&
      (!Number.isFinite(input.latitude) ||
        !Number.isFinite(input.longitude) ||
        Math.abs(input.latitude!) > 90 ||
        Math.abs(input.longitude!) > 180)
    )
      throw new ToolError("invalid_input", "Coordinates are out of range");
    const radius = input.radius_nm ?? 50;
    if (!Number.isFinite(radius) || radius <= 0 || radius > 200)
      throw new ToolError(
        "invalid_input",
        "Radius must be greater than zero and at most 200 nautical miles",
      );
    const words = query.split(/\s+/);
    const rows = this.index.stations
      .filter((s) => s.discoverable && s.kind === input.kind && !/@\d+$/.test(s.id))
      .map((s) => {
        const name = normalize(s.name);
        const distance = located
          ? distanceNM(input.latitude!, input.longitude!, s.latitude, s.longitude)
          : undefined;
        const rank =
          s.id.toLowerCase() === query || name === query ? 0 : name.startsWith(query) ? 1 : 2;
        return { ...s, distance_nm: distance, rank };
      })
      .filter((s) =>
        located ? s.distance_nm! <= radius : words.every((w) => s.search.includes(w)),
      )
      .sort(
        (a, b) =>
          (located ? a.distance_nm! - b.distance_nm! : a.rank - b.rank) || a.id.localeCompare(b.id),
      );
    return {
      stations: rows.slice(0, 10).map(({ rank: _rank, ...s }) => s),
      truncated: rows.length > 10,
    };
  }
}
function distanceNM(lat: number, lon: number, otherLat: number, otherLon: number) {
  const r = Math.PI / 180;
  const h =
    Math.sin(((otherLat - lat) * r) / 2) ** 2 +
    Math.cos(lat * r) * Math.cos(otherLat * r) * Math.sin(((otherLon - lon) * r) / 2) ** 2;
  return 3440.065 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
