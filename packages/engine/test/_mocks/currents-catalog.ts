// Test-only catalog over the sampled NOAA CO-OPS current bundle in
// fixtures/currents-sample.json. The engine ships no station data: a catalog
// is the consumer's job. This loader exists so the subordinate tests can
// drive many stations at once, mirroring the Swift test support.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createCurrentPredictor,
  createSubordinateCurrentPredictor,
  type CurrentPredictor,
  type SubordinateCurrentOptions,
} from "../../src/index.js";

export interface FixtureConstituent {
  name: string;
  amplitude: number;
  phase: number;
}

export interface FixtureEvent {
  time: string;
  speed: number;
  kind: string;
}

interface SampleStation {
  id: string;
  name: string;
  type: "harmonic" | "subordinate";
  reference?: string;
  floodDirection?: number;
  ebbDirection?: number;
  offset?: number;
  constituents?: FixtureConstituent[];
  slackBeforeFloodOffset?: number;
  slackBeforeEbbOffset?: number;
  floodTimeOffset?: number;
  ebbTimeOffset?: number;
  floodSpeedRatio?: number;
  ebbSpeedRatio?: number;
}

export function loadFixture<T>(name: string): T {
  const path = fileURLToPath(new URL(`../../../../fixtures/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

const sample = loadFixture<{ stations: SampleStation[] }>("currents-sample");
const records = new Map(sample.stations.map((s) => [s.id, s]));

function harmonic(record: SampleStation): CurrentPredictor {
  return createCurrentPredictor(record.constituents ?? [], {
    floodDirection: record.floodDirection ?? 0,
    ebbDirection: record.ebbDirection ?? 0,
    meanFlow: record.offset ?? 0,
  });
}

export interface CatalogStation {
  type: "harmonic" | "subordinate";
  predictor: CurrentPredictor;
  reference?: CurrentPredictor;
  offsets?: SubordinateCurrentOptions;
}

export function catalogIds(): string[] {
  return [...records.keys()];
}

/** Build a predictor for a sampled station, resolving a subordinate's reference. */
export function catalogStation(id: string): CatalogStation | undefined {
  const record = records.get(id);
  if (!record) return undefined;
  if (record.type === "harmonic") return { type: "harmonic", predictor: harmonic(record) };

  const referenceRecord = records.get(record.reference ?? "");
  if (!referenceRecord || referenceRecord.type !== "harmonic") return undefined;
  const reference = harmonic(referenceRecord);
  const offsets: SubordinateCurrentOptions = {
    slackBeforeFloodOffset: record.slackBeforeFloodOffset ?? 0,
    slackBeforeEbbOffset: record.slackBeforeEbbOffset ?? 0,
    floodTimeOffset: record.floodTimeOffset ?? 0,
    ebbTimeOffset: record.ebbTimeOffset ?? 0,
    floodSpeedRatio: record.floodSpeedRatio ?? 1,
    ebbSpeedRatio: record.ebbSpeedRatio ?? 1,
    floodDirection: record.floodDirection ?? 0,
    ebbDirection: record.ebbDirection ?? 0,
  };
  return {
    type: "subordinate",
    predictor: createSubordinateCurrentPredictor(reference, offsets),
    reference,
    offsets,
  };
}
