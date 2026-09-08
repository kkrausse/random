import { mountOpenCodeClient } from "./client";

// The standalone harness opts into fixtures explicitly; embedding imports client.ts.
mountOpenCodeClient(document.getElementById("app")!, { mock: true });
