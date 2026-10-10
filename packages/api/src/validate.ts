import openapi from "./openapi.js";

// Valid datums, sourced from the OpenAPI spec so there's a single source of truth.
const DATUMS = new Set((openapi.components.parameters.datum.schema.enum ?? []) as string[]);

type Query = Record<string, unknown>;

/**
 * Thrown for invalid request parameters. The routes' error handler turns this
 * into a 400 with `{ message, errors }`.
 *
 * Replaces express-openapi-validator, whose Ajv codegen (`new Function`) is
 * disallowed on edge runtimes like Cloudflare Workers. The API surface is small
 * and fixed, so explicit coercion is simpler than a general-purpose validator.
 */
export class ValidationError extends Error {
  status = 400;
  errors: Array<{ path: string; message: string }>;
  constructor(errors: Array<{ path: string; message: string }>) {
    super(errors[0]?.message ?? "Invalid request");
    this.name = "ValidationError";
    this.errors = errors;
  }
}

function fail(path: string, message: string): never {
  throw new ValidationError([{ path, message }]);
}

interface NumberOptions {
  required?: boolean;
  min?: number;
  max?: number;
  integer?: boolean;
  default?: number;
}

export function number(query: Query, name: string, opts: NumberOptions = {}): number | undefined {
  const raw = query[name];
  if (raw === undefined || raw === "") {
    if (opts.required) fail(name, `${name} is required`);
    return opts.default;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) fail(name, `${name} must be a number`);
  if (opts.integer && !Number.isInteger(value)) fail(name, `${name} must be an integer`);
  if (opts.min !== undefined && value < opts.min) fail(name, `${name} must be >= ${opts.min}`);
  if (opts.max !== undefined && value > opts.max) fail(name, `${name} must be <= ${opts.max}`);
  return value;
}

// A repeated query parameter arrives as an array.
export function string(query: Query, name: string): string | undefined {
  const raw = query[name];
  if (raw === undefined || raw === "") return undefined;
  if (typeof raw !== "string") fail(name, `${name} must be given once`);
  return raw;
}

export function date(query: Query, name: string, fallback: () => Date): Date {
  const raw = query[name];
  if (raw === undefined || raw === "") return fallback();
  const value = new Date(String(raw));
  if (Number.isNaN(value.getTime())) fail(name, `${name} must be an ISO 8601 date-time`);
  return value;
}

export function datum(query: Query): string | undefined {
  const raw = query.datum;
  if (raw === undefined || raw === "") return undefined;
  const value = String(raw);
  if (!DATUMS.has(value)) fail("datum", `datum must be one of: ${[...DATUMS].join(", ")}`);
  return value;
}

export function units(query: Query): "meters" | "feet" {
  const raw = query.units ?? "meters";
  if (raw !== "meters" && raw !== "feet") fail("units", `units must be "meters" or "feet"`);
  return raw;
}

export function bbox(query: Query): [number, number, number, number] | undefined {
  const raw = query.bbox;
  if (raw === undefined || raw === "") return undefined;
  const parts = String(raw).split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    fail("bbox", "bbox must be four comma-separated numbers: minLon,minLat,maxLon,maxLat");
  }
  const [minLon, minLat, maxLon, maxLat] = parts;
  try {
    number({ minLon }, "minLon", { min: -180, max: 180 });
    number({ minLat }, "minLat", { min: -90, max: 90 });
    number({ maxLon }, "maxLon", { min: -180, max: 180 });
    number({ maxLat }, "maxLat", { min: -90, max: 90 });
    if (minLat > maxLat) fail("bbox", "minLat must be <= maxLat");
  } catch (error) {
    fail("bbox", `bbox must use minLon,minLat,maxLon,maxLat order: ${(error as Error).message}`);
  }
  return parts as [number, number, number, number];
}
