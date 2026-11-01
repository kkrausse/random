//! Config loading: read config.ts (+ local.ts) → strip types with oxc → evaluate in a
//! fresh QuickJS context → convert the declared bindings into plain Rust data.
//! JS functions in the config are kept as persistent handles and called by the engine.

use crate::log;
use crate::output::{KeyCombo, MOUSE_NAMES, media_code, parse_key};
use anyhow::{Context as _, Result, anyhow, bail};
use rquickjs::{Array, Context, Ctx, Function, Object, Persistent, Runtime, Value};
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

// ------------------------------------------------------------------ data model

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Button {
    Left,
    Right,
    Wheel,
    Back,
    Forward,
    Prev,
    Next,
    Play,
    VolUp,
    VolDown,
}

impl Button {
    pub const ALL: [Button; 10] = [
        Button::Left,
        Button::Right,
        Button::Wheel,
        Button::Back,
        Button::Forward,
        Button::Prev,
        Button::Next,
        Button::Play,
        Button::VolUp,
        Button::VolDown,
    ];

    pub fn name(self) -> &'static str {
        match self {
            Button::Left => "trigger",
            Button::Right => "leader",
            Button::Wheel => "wheel",
            Button::Back => "left-of-wheel",
            Button::Forward => "right-of-wheel",
            Button::Prev => "d-left",
            Button::Next => "d-right",
            Button::Play => "play",
            Button::VolUp => "d-up",
            Button::VolDown => "d-down",
        }
    }

    pub fn from_name(s: &str) -> Option<Button> {
        Button::ALL.into_iter().find(|b| b.name() == s)
    }

    /// CG mouse button number (0 left, 1 right, 2 middle, 3 back, 4 forward).
    pub fn mouse_number(self) -> Option<u8> {
        match self {
            Button::Left => Some(0),
            Button::Right => Some(1),
            Button::Wheel => Some(2),
            Button::Back => Some(3),
            Button::Forward => Some(4),
            _ => None,
        }
    }

    pub fn from_mouse_number(n: i64) -> Option<Button> {
        Button::ALL.into_iter().find(|b| b.mouse_number() == Some(n as u8))
    }

    /// The output that reproduces this button's original behavior.
    pub fn native(self) -> Action {
        match self.mouse_number() {
            Some(n) => Action::Click(n),
            None => Action::Media(match self {
                Button::Prev => crate::output::NX_PREVIOUS,
                Button::Next => crate::output::NX_NEXT,
                Button::Play => crate::output::NX_PLAY,
                Button::VolUp => crate::output::NX_SOUND_UP,
                _ => crate::output::NX_SOUND_DOWN,
            }),
        }
    }
}

#[derive(Clone, Debug)]
pub enum Action {
    Key(KeyCombo),
    Media(u8),
    Click(u8),
    Scroll { dy: i32, dx: i32 },
    Run(String),
    Layer(String),
    Seq(Vec<Action>),
    All(Vec<Action>),
    Js(usize),
    Pass,
}

#[derive(Clone, Debug)]
pub struct Gesture {
    pub left: Option<Action>,
    pub right: Option<Action>,
    pub up: Option<Action>,
    pub down: Option<Action>,
    pub tap: Option<Action>,
    pub threshold: f64,
}

#[derive(Clone, Debug)]
pub enum Binding {
    Act(Action),
    TapHold { tap: Action, hold: Action, ms: u64 },
    Gesture(Box<Gesture>),
}

#[derive(Default, Debug)]
pub struct Bindings {
    pub buttons: HashMap<Button, Binding>,
    /// JS function id for scroll.
    pub scroll: Option<usize>,
}

#[derive(Debug)]
pub struct Combo {
    pub buttons: Vec<Button>,
    pub action: Action,
    pub ms: u64,
}

pub struct Config {
    pub base: Bindings,
    pub layers: HashMap<String, Bindings>,
    pub apps: HashMap<String, Bindings>,
    pub chords: Vec<Combo>,
    pub sequences: Vec<Combo>,
    pub files: Vec<PathBuf>,
    pub js: Option<Js>,
}

impl Config {
    pub fn empty() -> Config {
        Config {
            base: Bindings::default(),
            layers: HashMap::new(),
            apps: HashMap::new(),
            chords: vec![],
            sequences: vec![],
            files: vec![],
            js: None,
        }
    }

    pub fn summary(&self) -> String {
        let mut s = String::new();
        let mut section = |title: &str, b: &Bindings| {
            let mut keys: Vec<_> = b.buttons.iter().collect();
            keys.sort_by_key(|(k, _)| k.name());
            for (k, v) in keys {
                s.push_str(&format!("  {title}{:<8} {}\n", k.name(), describe_binding(v)));
            }
            if b.scroll.is_some() {
                s.push_str(&format!("  {title}{:<8} <function>\n", "scroll"));
            }
        };
        section("", &self.base);
        let mut layers: Vec<_> = self.layers.iter().collect();
        layers.sort_by_key(|(k, _)| k.as_str());
        for (name, b) in layers {
            section(&format!("[layer {name}] "), b);
        }
        let mut apps: Vec<_> = self.apps.iter().collect();
        apps.sort_by_key(|(k, _)| k.as_str());
        for (name, b) in apps {
            section(&format!("[app {name}] "), b);
        }
        for c in &self.chords {
            let names: Vec<_> = c.buttons.iter().map(|b| b.name()).collect();
            s.push_str(&format!("  chord {} ({} ms) {}\n", names.join("+"), c.ms, describe(&c.action)));
        }
        for c in &self.sequences {
            let names: Vec<_> = c.buttons.iter().map(|b| b.name()).collect();
            s.push_str(&format!("  sequence {} ({} ms) {}\n", names.join(","), c.ms, describe(&c.action)));
        }
        if s.is_empty() {
            s.push_str("  (no bindings: everything passes through)\n");
        }
        s
    }
}

pub fn describe(a: &Action) -> String {
    match a {
        Action::Key(k) => format!("key({:?})", k.spec),
        Action::Media(c) => format!("media({c})"),
        Action::Click(n) => format!("click({:?})", MOUSE_NAMES[*n as usize]),
        Action::Scroll { dy, dx } => format!("scroll({dy}, {dx})"),
        Action::Run(c) => format!("run({c:?})"),
        Action::Layer(l) => format!("layer({l:?})"),
        Action::Seq(v) => format!("seq({})", v.iter().map(describe).collect::<Vec<_>>().join(", ")),
        Action::All(v) => format!("[{}]", v.iter().map(describe).collect::<Vec<_>>().join(", ")),
        Action::Js(_) => "<function>".into(),
        Action::Pass => "passthrough".into(),
    }
}

fn describe_binding(b: &Binding) -> String {
    match b {
        Binding::Act(a) => describe(a),
        Binding::TapHold { tap, hold, ms } => format!("tapHold({}, {}, {ms} ms)", describe(tap), describe(hold)),
        Binding::Gesture(g) => {
            let mut parts = vec![];
            for (n, a) in [("left", &g.left), ("right", &g.right), ("up", &g.up), ("down", &g.down), ("tap", &g.tap)] {
                if let Some(a) = a {
                    parts.push(format!("{n}: {}", describe(a)));
                }
            }
            format!("gesture({{ {} }}, threshold {})", parts.join(", "), g.threshold)
        }
    }
}

// ------------------------------------------------------------------ JS runtime

/// Field order matters: persistent handles must drop before the context/runtime.
pub struct Js {
    fns: Vec<Persistent<Function<'static>>>,
    maps: Vec<SourceFile>,
    ctx: Context,
    _rt: Runtime,
}

struct SourceFile {
    name: String,
    map: oxc_sourcemap::SourceMap,
}

pub enum JsResult {
    Nothing,
    Pass,
    Act(Action),
}

pub struct JsCall<'a> {
    pub args: Vec<f64>,
    pub app: &'a str,
    pub layers: &'a [String],
    pub dx: f64,
}

thread_local! {
    static DEADLINE: Cell<Option<Instant>> = const { Cell::new(None) };
    static OUTBOX: RefCell<Vec<Action>> = const { RefCell::new(Vec::new()) };
}

const HANDLER_BUDGET: Duration = Duration::from_millis(50);
const LOAD_BUDGET: Duration = Duration::from_millis(2000);

/// Actions queued by `ctx.send(...)` during the last JS call.
pub fn take_outbox() -> Vec<Action> {
    OUTBOX.with(|o| std::mem::take(&mut *o.borrow_mut()))
}

impl Js {
    pub fn call(&self, id: usize, call: JsCall) -> Result<JsResult> {
        let f = self.fns.get(id).ok_or_else(|| anyhow!("bad function id {id}"))?.clone();
        DEADLINE.with(|d| d.set(Some(Instant::now() + HANDLER_BUDGET)));
        let result = self.ctx.with(|ctx| -> Result<JsResult> {
            let run = || -> rquickjs::Result<Value> {
                let f = f.restore(&ctx)?;
                let invoke: Function = ctx.globals().get("__invoke")?;
                let args = Array::new(ctx.clone())?;
                for (i, a) in call.args.iter().enumerate() {
                    args.set(i, *a)?;
                }
                let layers = Array::new(ctx.clone())?;
                for (i, l) in call.layers.iter().enumerate() {
                    layers.set(i, l.as_str())?;
                }
                invoke.call((f, args, call.app, layers, call.dx))
            };
            let v = match run() {
                Ok(v) => v,
                Err(e) => return Err(self.js_error(&ctx, e)),
            };
            if v.is_undefined() || v.is_null() {
                return Ok(JsResult::Nothing);
            }
            if v.as_string().map(|s| s.to_string().ok().as_deref() == Some("pass")).unwrap_or(false) {
                return Ok(JsResult::Pass);
            }
            Ok(JsResult::Act(to_action(&ctx, v, None, "handler return value")?))
        });
        DEADLINE.with(|d| d.set(None));
        result
    }

    pub fn fn_count(&self) -> usize {
        self.fns.len()
    }

    fn js_error(&self, ctx: &Ctx, e: rquickjs::Error) -> anyhow::Error {
        js_error(ctx, e, &self.maps)
    }
}

fn js_error(ctx: &Ctx, e: rquickjs::Error, maps: &[SourceFile]) -> anyhow::Error {
    if !matches!(e, rquickjs::Error::Exception) {
        return anyhow!("{e}");
    }
    let exc = ctx.catch();
    let (msg, stack) = match exc.as_exception() {
        Some(ex) => (ex.message().unwrap_or_default(), ex.stack().unwrap_or_default()),
        None => (format!("{exc:?}"), String::new()),
    };
    let msg = if msg.contains("interrupted") { format!("{msg} (handler exceeded {} ms)", HANDLER_BUDGET.as_millis()) } else { msg };
    // Map the first frame that points into a config file back to the TS source.
    for line in stack.lines() {
        for sf in maps {
            let needle = format!("{}:", sf.name);
            if let Some(pos) = line.find(&needle) {
                let rest = &line[pos + needle.len()..];
                let nums: Vec<u32> = rest
                    .trim_end_matches(')')
                    .split(':')
                    .map_while(|p| p.trim().parse().ok())
                    .collect();
                if let Some(&gen_line) = nums.first() {
                    let gen_col = nums.get(1).copied().unwrap_or(1);
                    let table = sf.map.generate_lookup_table();
                    if let Some(tok) =
                        sf.map.lookup_token(&table, gen_line.saturating_sub(1), gen_col.saturating_sub(1))
                    {
                        return anyhow!(
                            "{}:{}:{}: {msg}",
                            sf.name,
                            tok.get_src_line() + 1,
                            tok.get_src_col() + 1
                        );
                    }
                    return anyhow!("{}: {msg} (generated line {gen_line})", sf.name);
                }
            }
        }
    }
    anyhow!("{msg}")
}

// ------------------------------------------------------------------ TS → JS

fn strip_types(path: &Path, src: &str) -> Result<(String, oxc_sourcemap::SourceMap)> {
    use oxc_allocator::Allocator;
    use oxc_codegen::{Codegen, CodegenOptions};
    use oxc_parser::Parser;
    use oxc_semantic::SemanticBuilder;
    use oxc_span::SourceType;
    use oxc_transformer::{TransformOptions, Transformer};

    let name = path.display().to_string();
    let alloc = Allocator::default();
    let source_type = SourceType::ts();
    let ret = Parser::new(&alloc, src, source_type).parse();
    if !ret.errors.is_empty() {
        let msgs: Vec<String> = ret.errors.iter().map(|d| format_diag(&name, src, d)).collect();
        bail!("{}", msgs.join("\n"));
    }
    let mut program = ret.program;
    let scoping = SemanticBuilder::new().build(&program).semantic.into_scoping();
    let tr = Transformer::new(&alloc, path, &TransformOptions::default()).build_with_scoping(scoping, &mut program);
    if !tr.errors.is_empty() {
        let msgs: Vec<String> = tr.errors.iter().map(|d| format_diag(&name, src, d)).collect();
        bail!("{}", msgs.join("\n"));
    }
    let out = Codegen::new()
        .with_options(CodegenOptions { source_map_path: Some(path.to_path_buf()), ..CodegenOptions::default() })
        .build(&program);
    let map = out.map.ok_or_else(|| anyhow!("no source map"))?;
    // Stripping `import type` leaves an `export {}` marker; we evaluate as a script.
    // Blank it in place so generated line numbers (and the source map) stay valid.
    let code = out.code.lines().map(|l| if l.trim() == "export {};" { "" } else { l }).collect::<Vec<_>>().join("\n");
    Ok((code, map))
}

fn format_diag(name: &str, src: &str, d: &oxc_diagnostics::OxcDiagnostic) -> String {
    let offset = d.labels.as_ref().and_then(|l| l.first()).map(|l| l.offset()).unwrap_or(0);
    let before = &src[..offset.min(src.len())];
    let line = before.matches('\n').count() + 1;
    let col = before.len() - before.rfind('\n').map(|i| i + 1).unwrap_or(0) + 1;
    format!("{name}:{line}:{col}: {}", d.message)
}

// ------------------------------------------------------------------ loading

const PRELUDE: &str = include_str!("prelude.js");

/// Load `path` and, if present, `local.ts` next to it.
pub fn load(path: &Path) -> Result<Config> {
    let mut files = vec![path.to_path_buf()];
    let local = path.with_file_name("local.ts");
    if local.exists() && local != path {
        files.push(local);
    }

    let rt = Runtime::new()?;
    rt.set_memory_limit(64 << 20);
    rt.set_interrupt_handler(Some(Box::new(|| {
        DEADLINE.with(|d| d.get().map(|t| Instant::now() > t).unwrap_or(false))
    })));
    let ctx = Context::full(&rt)?;
    let mut maps = vec![];
    let mut fns = vec![];

    let cfg = ctx.with(|ctx| -> Result<Config> {
        install_natives(&ctx)?;
        ctx.eval::<(), _>(PRELUDE).map_err(|e| js_error(&ctx, e, &[])).context("prelude")?;
        for file in &files {
            let src = std::fs::read_to_string(file).with_context(|| format!("reading {}", file.display()))?;
            let (code, map) = strip_types(file, &src)?;
            let name = file.display().to_string();
            maps.push(SourceFile { name: name.clone(), map });
            let mut opts = rquickjs::context::EvalOptions::default();
            opts.global = true;
            opts.strict = false;
            opts.filename = Some(name.clone());
            DEADLINE.with(|d| d.set(Some(Instant::now() + LOAD_BUDGET)));
            let r = ctx.eval_with_options::<(), _>(code, opts);
            DEADLINE.with(|d| d.set(None));
            r.map_err(|e| js_error(&ctx, e, &maps))?;
        }
        let cfg: Object = ctx.globals().get("__cfg")?;
        collect(&ctx, &cfg, &mut fns)
    })?;
    take_outbox(); // ignore anything sent at load time

    let mut cfg = cfg;
    cfg.files = files;
    cfg.js = Some(Js { fns, maps, ctx, _rt: rt });
    validate(&cfg);
    Ok(cfg)
}

fn install_natives(ctx: &Ctx) -> Result<()> {
    let g = ctx.globals();
    g.set(
        "__log",
        Function::new(ctx.clone(), |msg: String| {
            log!("config: {msg}");
        })?,
    )?;
    g.set(
        "__send",
        Function::new(ctx.clone(), send_native)?,
    )?;
    Ok(())
}

fn send_native<'js>(v: Value<'js>) -> rquickjs::Result<()> {
    let ctx = v.ctx().clone();
    match to_action(&ctx, v, None, "ctx.send") {
        Ok(a) => OUTBOX.with(|o| o.borrow_mut().push(a)),
        Err(e) => log!("ctx.send: {e:#}"),
    }
    Ok(())
}

type Fns = Vec<Persistent<Function<'static>>>;

fn collect<'js>(ctx: &Ctx<'js>, cfg: &Object<'js>, fns: &mut Fns) -> Result<Config> {
    let mut out = Config::empty();
    out.base = to_bindings(ctx, cfg.get("base")?, fns, "bind")?;
    if let Some(f) = cfg.get::<_, Option<Function>>("scroll")? {
        out.base.scroll = Some(save_fn(ctx, f, fns));
    }
    let layers: Object = cfg.get("layers")?;
    for k in layers.keys::<String>() {
        let k = k?;
        out.layers.insert(k.clone(), to_bindings(ctx, layers.get(&k)?, fns, &format!("defineLayer({k:?})"))?);
    }
    let apps: Object = cfg.get("apps")?;
    for k in apps.keys::<String>() {
        let k = k?;
        out.apps.insert(k.clone(), to_bindings(ctx, apps.get(&k)?, fns, &format!("app({k:?})"))?);
    }
    for (field, list) in [("chords", &mut out.chords), ("sequences", &mut out.sequences)] {
        let arr: Array = cfg.get(field)?;
        for item in arr.iter::<Object>() {
            let item = item?;
            let what = if field == "chords" { "chord" } else { "sequence" };
            let names: Vec<String> = item.get("buttons").with_context(|| format!("{what}: buttons must be an array of button names"))?;
            let mut buttons = vec![];
            for n in &names {
                buttons.push(Button::from_name(n).ok_or_else(|| anyhow!("{what}: unknown button {n:?}"))?);
            }
            if buttons.len() < 2 {
                bail!("{what}([{}]): needs at least two buttons", names.join(", "));
            }
            let action = to_action(ctx, item.get("action")?, Some(fns), what)?;
            let ms: f64 = item.get("ms")?;
            list.push(Combo { buttons, action, ms: ms as u64 });
        }
    }
    Ok(out)
}

fn save_fn<'js>(ctx: &Ctx<'js>, f: Function<'js>, fns: &mut Fns) -> usize {
    fns.push(Persistent::save(ctx, f));
    fns.len() - 1
}

fn to_bindings<'js>(ctx: &Ctx<'js>, obj: Value<'js>, fns: &mut Fns, what: &str) -> Result<Bindings> {
    let obj = obj.into_object().ok_or_else(|| anyhow!("{what}: expected an object of bindings"))?;
    let mut b = Bindings::default();
    for k in obj.keys::<String>() {
        let k = k?;
        let v: Value = obj.get(&k)?;
        if k == "scroll" {
            let f = v.into_function().ok_or_else(|| anyhow!("{what}: scroll must be a function"))?;
            b.scroll = Some(save_fn(ctx, f, fns));
            continue;
        }
        let button = Button::from_name(&k).ok_or_else(|| {
            let names: Vec<_> = Button::ALL.iter().map(|b| b.name()).collect();
            anyhow!("{what}: unknown button {k:?} (expected one of {} or scroll)", names.join(", "))
        })?;
        let ctxname = format!("{what} {k}");
        b.buttons.insert(button, to_binding(ctx, v, fns, &ctxname)?);
    }
    Ok(b)
}

fn type_of<'js>(v: &Value<'js>) -> Option<String> {
    v.as_object().and_then(|o| o.get::<_, Option<String>>("type").ok().flatten())
}

fn to_binding<'js>(ctx: &Ctx<'js>, v: Value<'js>, fns: &mut Fns, what: &str) -> Result<Binding> {
    match type_of(&v).as_deref() {
        Some("tapHold") => {
            let o = v.as_object().unwrap();
            let tap = to_action(ctx, o.get("tap")?, Some(fns), &format!("{what} tapHold tap"))?;
            let hold = to_action(ctx, o.get("hold")?, Some(fns), &format!("{what} tapHold hold"))?;
            let ms: f64 = o.get("ms")?;
            Ok(Binding::TapHold { tap, hold, ms: ms as u64 })
        }
        Some("gesture") => {
            let o = v.as_object().unwrap();
            let dirs: Object = o.get("dirs").with_context(|| format!("{what}: gesture needs an object of directions"))?;
            let mut opt = |name: &str| -> Result<Option<Action>> {
                let v: Value = dirs.get(name)?;
                if v.is_undefined() || v.is_null() {
                    return Ok(None);
                }
                Ok(Some(to_action(ctx, v, Some(fns), &format!("{what} gesture {name}"))?))
            };
            let g = Gesture {
                left: opt("left")?,
                right: opt("right")?,
                up: opt("up")?,
                down: opt("down")?,
                tap: opt("tap")?,
                threshold: o.get("threshold")?,
            };
            Ok(Binding::Gesture(Box::new(g)))
        }
        _ => Ok(Binding::Act(to_action(ctx, v, Some(fns), what)?)),
    }
}

fn to_action<'js>(ctx: &Ctx<'js>, v: Value<'js>, fns: Option<&mut Fns>, what: &str) -> Result<Action> {
    if let Some(f) = v.as_function() {
        return match fns {
            Some(fns) => Ok(Action::Js(save_fn(ctx, f.clone(), fns))),
            None => bail!("{what}: functions can't be used here"),
        };
    }
    if let Some(arr) = v.as_array() {
        let mut out = vec![];
        let mut fns = fns;
        for item in arr.iter::<Value>() {
            out.push(to_action(ctx, item?, fns.as_deref_mut(), what)?);
        }
        return Ok(Action::All(out));
    }
    if let Some(s) = v.as_string() {
        let s = s.to_string()?;
        if s == "pass" {
            return Ok(Action::Pass);
        }
        bail!("{what}: got the string {s:?}; wrap it, e.g. key({s:?})");
    }
    let Some(o) = v.as_object() else {
        bail!("{what}: expected an action, got {}", v.type_name());
    };
    let ty: String = o.get::<_, Option<String>>("type")?.ok_or_else(|| anyhow!("{what}: object is not an action"))?;
    Ok(match ty.as_str() {
        "key" => {
            let spec: String = o.get("spec")?;
            Action::Key(parse_key(&spec).with_context(|| what.to_string())?)
        }
        "media" => {
            let name: String = o.get("name")?;
            Action::Media(media_code(&name).ok_or_else(|| anyhow!("{what}: unknown media key {name:?}"))?)
        }
        "click" => {
            let name: String = o.get("name")?;
            let n = MOUSE_NAMES
                .iter()
                .position(|m| *m == name)
                .ok_or_else(|| anyhow!("{what}: unknown mouse button {name:?}"))?;
            Action::Click(n as u8)
        }
        "scroll" => {
            let dy: f64 = o.get::<_, Option<f64>>("dy")?.unwrap_or(0.0);
            let dx: f64 = o.get::<_, Option<f64>>("dx")?.unwrap_or(0.0);
            Action::Scroll { dy: dy as i32, dx: dx as i32 }
        }
        "run" => Action::Run(o.get("cmd")?),
        "layer" => Action::Layer(o.get("name")?),
        "seq" => {
            let arr: Array = o.get("actions")?;
            let mut out = vec![];
            let mut fns = fns;
            for item in arr.iter::<Value>() {
                out.push(to_action(ctx, item?, fns.as_deref_mut(), what)?);
            }
            Action::Seq(out)
        }
        "passthrough" => Action::Pass,
        "tapHold" | "gesture" => bail!("{what}: {ty}(...) is only valid directly in bind/defineLayer/app"),
        other => bail!("{what}: unknown action type {other:?}"),
    })
}

/// Non-fatal checks: warn about layers that are referenced but never defined.
fn validate(cfg: &Config) {
    fn walk(a: &Action, out: &mut Vec<String>) {
        match a {
            Action::Layer(l) => out.push(l.clone()),
            Action::Seq(v) | Action::All(v) => v.iter().for_each(|a| walk(a, out)),
            _ => {}
        }
    }
    let mut refs = vec![];
    let all = std::iter::once(&cfg.base).chain(cfg.layers.values()).chain(cfg.apps.values());
    for b in all {
        for binding in b.buttons.values() {
            match binding {
                Binding::Act(a) => walk(a, &mut refs),
                Binding::TapHold { tap, hold, .. } => {
                    walk(tap, &mut refs);
                    walk(hold, &mut refs);
                }
                Binding::Gesture(_) => {}
            }
        }
    }
    for r in refs {
        if !cfg.layers.contains_key(&r) {
            log!("warning: layer({r:?}) is used but never defined with defineLayer");
        }
    }
}
