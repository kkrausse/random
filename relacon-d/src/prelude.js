// Evaluated before config.ts. Builders return plain objects; the Rust side converts
// __cfg into its own data once evaluation finishes. Keep in sync with relacon.d.ts.
var __cfg = { base: {}, layers: {}, apps: {}, chords: [], sequences: [], scroll: null };

var passthrough = { type: "passthrough" };

function key(spec) { return { type: "key", spec: String(spec) }; }
function media(name) { return { type: "media", name: String(name) }; }
function click(name) { return { type: "click", name: String(name) }; }
function scroll(dy, dx) { return { type: "scroll", dy: dy || 0, dx: dx || 0 }; }
function run(cmd) { return { type: "run", cmd: String(cmd) }; }
function seq(...actions) { return { type: "seq", actions }; }
function layer(name) { return { type: "layer", name: String(name) }; }

function tapHold(tap, hold, opts) {
  return { type: "tapHold", tap, hold, ms: (opts && opts.ms) ?? 200 };
}

function bind(button, binding) { __cfg.base[button] = binding; }

function defineLayer(name, map) {
  __cfg.layers[name] = Object.assign(__cfg.layers[name] || {}, map);
}

function chord(buttons, action, opts) {
  __cfg.chords.push({ buttons, action, ms: (opts && opts.ms) ?? 50 });
}

function sequence(buttons, action, opts) {
  __cfg.sequences.push({ buttons, action, ms: (opts && opts.ms) ?? 800 });
}

// gesture("left-of-wheel", { left: ..., right: ... }, { threshold }) binds directly;
// gesture({ left: ... }, { threshold }) returns a binding for defineLayer/app.
function gesture(a, b, c) {
  if (typeof a === "string") {
    __cfg.base[a] = { type: "gesture", dirs: b, threshold: (c && c.threshold) ?? 40 };
    return;
  }
  return { type: "gesture", dirs: a, threshold: (b && b.threshold) ?? 40 };
}

function onScroll(fn) { __cfg.scroll = fn; }

function app(bundleId, map) {
  __cfg.apps[bundleId] = Object.assign(__cfg.apps[bundleId] || {}, map);
}

var console = {
  log: (...a) => __log(a.map(String).join(" ")),
  error: (...a) => __log(a.map(String).join(" ")),
};

function __invoke(fn, args, app, layers, dx) {
  const ctx = {
    app,
    layers,
    dx,
    log: (...a) => __log(a.map(String).join(" ")),
    send: (action) => __send(action),
  };
  return fn(...args, ctx);
}
