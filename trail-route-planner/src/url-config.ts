import type { SearchPreferences, SearchRequest } from "./domain";
import type { MapAccessMode } from "./route-map";
import { DEFAULT_SEARCH_PREFERENCES } from "./search";
import { toKilometers, type DistanceUnit } from "./units";

export type SortOrder = "score" | "distance" | "motorcycle" | "road";
export interface PlannerConfig {
  region: string;
  start: string | null; // Stable OSM node ID; never a graph array index.
  minKm: number;
  maxKm: number;
  mode: SearchRequest["mode"];
  shape: SearchRequest["shape"];
  seed: number;
  preferences: SearchPreferences;
  units: DistanceUnit;
  sort: SortOrder;
  accessMode: MapAccessMode;
}

export const REGION_ID = "kings-beach-v0";
export const DEFAULT_CONFIG: PlannerConfig = {
  region: REGION_ID, start: null, minKm: toKilometers(2, "mi"), maxKm: toKilometers(6, "mi"),
  mode: "hike", shape: "loop", seed: 3, preferences: { ...DEFAULT_SEARCH_PREFERENCES },
  units: "mi", sort: "score", accessMode: "motorcycle",
};

export function resolveStart(nodes: readonly { id: string }[], requested: string | null, fallback: number): number {
  const index = nodes.findIndex(node => node.id === requested);
  return index >= 0 ? index : fallback;
}

const keys = ["region", "start", "minKm", "maxKm", "mode", "shape", "seed", "car", "motorcycle", "bicycle", "units", "sort", "access"] as const;
const oneOf = <T extends string>(value: string | null, choices: readonly T[], fallback: T): T =>
  choices.find(choice => choice === value) ?? fallback;
const number = (value: string | null, fallback: number, min: number, max: number, integer = false): number => {
  if (value === null || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max && (!integer || Number.isSafeInteger(parsed)) ? parsed : fallback;
};

export function parseConfig(search: string): PlannerConfig {
  const params = new URLSearchParams(search);
  const minKm = number(params.get("minKm"), DEFAULT_CONFIG.minKm, 0.1, 1000);
  const maxKm = number(params.get("maxKm"), DEFAULT_CONFIG.maxKm, 0.1, 1000);
  return {
    region: REGION_ID,
    start: /^\d+$/.test(params.get("start") ?? "") ? params.get("start") : null,
    minKm: minKm < maxKm ? minKm : DEFAULT_CONFIG.minKm,
    maxKm: minKm < maxKm ? maxKm : DEFAULT_CONFIG.maxKm,
    mode: oneOf(params.get("mode"), ["hike", "gravel"], DEFAULT_CONFIG.mode),
    shape: oneOf(params.get("shape"), ["loop", "out-and-back"], DEFAULT_CONFIG.shape),
    seed: number(params.get("seed"), DEFAULT_CONFIG.seed, 0, 2147483647, true),
    preferences: {
      motorcar: number(params.get("car"), DEFAULT_CONFIG.preferences.motorcar, -5, 5, true),
      motorcycle: number(params.get("motorcycle"), DEFAULT_CONFIG.preferences.motorcycle, -5, 5, true),
      bicycle: number(params.get("bicycle"), DEFAULT_CONFIG.preferences.bicycle, -5, 5, true),
    },
    units: oneOf(params.get("units"), ["mi", "km"], DEFAULT_CONFIG.units),
    sort: oneOf(params.get("sort"), ["score", "distance", "motorcycle", "road"], DEFAULT_CONFIG.sort),
    accessMode: oneOf(params.get("access"), ["motorcycle", "motorcar", "bicycle"], DEFAULT_CONFIG.accessMode),
  };
}

export function serializeConfig(config: PlannerConfig, search = ""): string {
  const params = new URLSearchParams(search);
  for (const key of keys) params.delete(key);
  params.set("region", config.region);
  if (config.start) params.set("start", config.start);
  params.set("minKm", String(config.minKm));
  params.set("maxKm", String(config.maxKm));
  params.set("mode", config.mode);
  params.set("shape", config.shape);
  params.set("seed", String(config.seed));
  params.set("car", String(config.preferences.motorcar));
  params.set("motorcycle", String(config.preferences.motorcycle));
  params.set("bicycle", String(config.preferences.bicycle));
  params.set("units", config.units);
  params.set("sort", config.sort);
  params.set("access", config.accessMode);
  return params.toString();
}
