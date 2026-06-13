import index from "./public/index.html";

const jsHeaders = {
  "Content-Type": "text/javascript; charset=utf-8",
};

const buildWorker = async () => {
  const result = await Bun.build({
    entrypoints: ["./public/analysis-worker.ts"],
    target: "browser",
    format: "esm",
    sourcemap: "inline",
  });

  if (!result.success || !result.outputs[0]) {
    return new Response("Could not build analysis worker.", { status: 500 });
  }

  return new Response(result.outputs[0], { headers: jsHeaders });
};

const buildWorklet = async () => {
  const result = await Bun.build({
    entrypoints: ["./public/feature-worklet.ts"],
    target: "browser",
    format: "esm",
    sourcemap: "inline",
  });

  if (!result.success || !result.outputs[0]) {
    return new Response("Could not build feature worklet.", { status: 500 });
  }

  return new Response(result.outputs[0], { headers: jsHeaders });
};

const server = Bun.serve({
  port: Number(Bun.env.PORT) || 4173,
  routes: {
    "/": index,
    "/analysis-worker.js": buildWorker,
    "/feature-worklet.js": buildWorklet,
  },
  development: true,
});

console.log(`Listening on ${server.url}`);
