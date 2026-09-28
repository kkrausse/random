import { Context, Effect, Layer, Schema } from "effect";
import { Region, SearchRequest, type Route } from "./domain";
import { generate } from "./search";

export class RegionError extends Schema.TaggedError<RegionError>()("RegionError", { reason: Schema.String }) {}
export class RegionStore extends Context.Service<RegionStore, { readonly load: () => Effect.Effect<Region, RegionError> }>()("trail/RegionStore") {}
export class RouteSearch extends Context.Service<RouteSearch, { readonly run: (request: SearchRequest) => Effect.Effect<Route[]> }>()("trail/RouteSearch") {}

export const regionLayer = Layer.effect(RegionStore, Effect.gen(function* () {
  const load = Effect.fn("RegionStore.load")(function* () {
    const response = yield* Effect.tryPromise({ try: () => fetch("/kings-beach.json"), catch: e => new RegionError({ reason: String(e) }) });
    if (!response.ok) return yield* Effect.fail(new RegionError({ reason: `Package HTTP ${response.status}` }));
    const json = yield* Effect.tryPromise({ try: () => response.json(), catch: e => new RegionError({ reason: String(e) }) });
    return yield* Schema.decodeUnknownEffect(Region)(json).pipe(Effect.mapError(e => new RegionError({ reason: String(e) })));
  });
  return RegionStore.of({ load });
}));

export const searchLayer = (region: Region) => Layer.effect(RouteSearch, Effect.gen(function* () {
  const run = Effect.fn("RouteSearch.run")(function* (request: SearchRequest) { return generate(region, request); });
  return RouteSearch.of({ run });
}));
