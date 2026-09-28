import { Effect, Schema } from "effect";
import { Region, SearchRequest } from "./domain";
import { RouteSearch, searchLayer } from "./services";

let region: Region | undefined;
let active = 0;
self.onmessage = async (event: MessageEvent) => {
  const id = ++active;
  try {
    if (event.data.type === "load") {
      region = Schema.decodeUnknownSync(Region)(event.data.region);
      self.postMessage({ type: "loaded", id });
    } else if (event.data.type === "search" && region) {
      const request = Schema.decodeUnknownSync(SearchRequest)(event.data.request);
      const search = Effect.gen(function* () { const service = yield* RouteSearch; return yield* service.run(request); });
      const routes = await Effect.runPromise(search.pipe(Effect.provide(searchLayer(region))));
      if (active === id) self.postMessage({ type: "results", id, routes });
    }
  } catch (error) { self.postMessage({ type: "error", id, message: String(error) }); }
};
