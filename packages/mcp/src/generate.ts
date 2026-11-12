import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Station } from "@slackwater/database";
import { currentStationUnavailableIn } from "slackwater";
import { normalize, type CatalogIndex, type StationInfo, type Versions } from "./catalog.js";

export function buildCatalog(records: Station[], versions: Versions) {
  const byId = new Map(records.map((s) => [s.id, s]));
  if (byId.size !== records.length) throw new Error("Duplicate station IDs");
  records = [...records].sort((a, b) => a.id.localeCompare(b.id));
  const bins = new Map<string, string[]>();
  for (const s of records) {
    if (s.quality?.accepted === false) continue;
    const key = `${s.kind}:${s.id.replace(/@\d+$/, "")}`;
    bins.set(key, [...(bins.get(key) ?? []), s.id]);
  }
  const models = new Map<string, Station>();
  const refusal = (s: Station) => {
    if (s.quality?.accepted === false)
      return { code: "rejected", message: "This station is not accepted by the catalog" };
    if (s.license.commercial_use !== true)
      return { code: "permission", message: "This service cannot serve this station's model" };
    if (s.source.name === "Canadian Hydrographic Service")
      return {
        code: "redistribution",
        message: "CHS predictions cannot be redistributed by this service",
      };
    const reference =
      s.kind === "current" && s.harmonic_constituents.length
        ? undefined
        : (s.current?.offsets?.reference ?? s.offsets?.reference);
    if (reference) {
      const ref = byId.get(reference);
      if (
        !ref ||
        ref.kind !== s.kind ||
        !ref.harmonic_constituents.length ||
        ref.quality?.accepted === false ||
        ref.license.commercial_use !== true ||
        ref.source.name === "Canadian Hydrographic Service"
      )
        return {
          code: "reference_unavailable",
          message: "The required reference model cannot be served",
        };
    }
    if (s.kind === "current") {
      const unavailable = currentStationUnavailableIn({ byId: (id: string) => byId.get(id) }, s);
      if (unavailable) return { code: unavailable.reason, message: unavailable.message };
    } else if (!s.harmonic_constituents.length && !reference)
      return { code: "no-model", message: "No tide model is available" };
    return undefined;
  };
  const stations: StationInfo[] = [...records]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((s) => {
      const unavailable = refusal(s);
      const reference = s.current?.offsets?.reference ?? s.offsets?.reference;
      if (!unavailable) {
        const model = JSON.parse(JSON.stringify(s)) as Station;
        if (s.kind === "tide" && !model.harmonic_constituents.length && reference)
          model.harmonic_constituents = byId.get(reference)!.harmonic_constituents;
        models.set(s.id, model);
      }
      const base = s.id.replace(/@\d+$/, "");
      return {
        id: s.id,
        name: s.name,
        kind: s.kind,
        latitude: s.latitude,
        longitude: s.longitude,
        timezone: s.timezone,
        source: s.source,
        license: s.license,
        attribution: s.attribution,
        type: s.type,
        chart_datum: s.chart_datum,
        datums: Object.keys(s.datums),
        reference,
        flood_direction: s.current?.flood_direction,
        ebb_direction: s.current?.ebb_direction,
        bins: bins.get(`${s.kind}:${base}`) ?? [],
        discoverable: s.quality?.accepted !== false,
        predictions: !unavailable,
        unavailable,
        aliases: s.aliases ?? [],
        search: normalize(
          [s.id, s.name, s.region, s.country, s.source.id, ...(s.aliases ?? [])]
            .filter(Boolean)
            .join(" "),
        ),
      };
    });
  const aliases: Record<string, string> = {};
  for (const s of records) {
    const replacement = s.quality?.redundant;
    if (
      s.kind === "tide" &&
      s.quality?.accepted === false &&
      replacement &&
      byId.get(replacement)?.kind === "tide" &&
      models.has(replacement) &&
      (s.license.commercial_use !== true || byId.get(replacement)!.license.commercial_use === true)
    )
      aliases[s.id] = replacement;
  }
  const index: CatalogIndex = { versions, stations, aliases };
  return { index, models };
}

export async function generateCatalog(records: Station[], versions: Versions, destination: string) {
  const { index, models } = buildCatalog(records, versions);
  const digest = createHash("sha256")
    .update(JSON.stringify(index))
    .update(JSON.stringify([...models]))
    .digest("hex");
  const directory = join(destination, digest, "stations");
  await mkdir(directory, { recursive: true });
  index.files = {};
  for (const [id, model] of models) {
    const name = `${Buffer.from(id, "utf8").toString("base64url")}.json`;
    const path = `${digest}/stations/${name}`;
    const modelTemporary = join(directory, `.${randomUUID()}.json`);
    try {
      await writeFile(modelTemporary, JSON.stringify(model));
      await rename(modelTemporary, join(directory, name));
    } finally {
      await rm(modelTemporary, { force: true });
    }
    index.files[id] = path;
  }
  const temporary = join(destination, `.index-${randomUUID()}.json`);
  try {
    await writeFile(temporary, JSON.stringify(index));
    await rename(temporary, join(destination, "index.json"));
  } finally {
    await rm(temporary, { force: true });
  }
  return index;
}
