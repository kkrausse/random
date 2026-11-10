//! Merging tabs and apps into one list and ordering it.

use nucleo_matcher::pattern::{CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config as MatcherConfig, Matcher, Utf32Str};

use crate::apps;
use crate::icons::Icon;
use crate::server::Connections;

#[derive(Clone, Copy)]
pub enum Target {
    Tab {
        connection: u64,
        tab_id: i64,
        window_id: i64,
        /// Pid of the browser app showing this tab, if known.
        browser: Option<i32>,
    },
    App {
        pid: i32,
    },
}

pub struct Item {
    pub title: String,
    pub subtitle: String,
    /// Favicon or app icon, once we have one.
    pub icon: Option<Icon>,
    pub target: Target,
    /// What fuzzy queries match against.
    haystack: String,
    /// Milliseconds since the epoch this was last used.
    recency: f64,
    /// The thing the user is on right now.
    current: bool,
}

fn host(url: &str) -> &str {
    let rest = url.split_once("://").map_or(url, |(_, rest)| rest);
    let host = rest.split(['/', '?', '#']).next().unwrap_or(rest);
    host.strip_prefix("www.").unwrap_or(host)
}

/// Snapshot of everything switchable. Main thread only (reads NSWorkspace).
///
/// `browser_bundle_id` pins the browser; otherwise each connection uses the
/// browser detected from its socket, falling back to Chrome.
pub fn collect(connections: &Connections, browser_bundle_id: Option<&str>) -> Vec<Item> {
    let frontmost = apps::frontmost_pid();
    let pinned = browser_bundle_id.and_then(apps::pid_for_bundle);

    let mut items = Vec::new();
    for (&connection, state) in connections.lock().unwrap().iter() {
        let browser = match browser_bundle_id {
            Some(_) => pinned,
            None => state
                .browser_pid
                .or_else(|| apps::pid_for_bundle("com.google.Chrome")),
        };
        let in_browser = browser.is_some() && browser == frontmost;
        for tab in &state.tabs {
            items.push(Item {
                title: if tab.title.is_empty() {
                    tab.url.clone()
                } else {
                    tab.title.clone()
                },
                subtitle: host(&tab.url).to_string(),
                icon: tab
                    .icon
                    .as_ref()
                    .and_then(|key| state.icons.get(key).cloned()),
                target: Target::Tab {
                    connection,
                    tab_id: tab.id,
                    window_id: tab.window_id,
                    browser,
                },
                haystack: format!("{} {}", tab.title, tab.url),
                recency: tab.last_accessed,
                // Refined below: only the most recent active tab is "current".
                current: in_browser && tab.active,
            });
        }
    }
    // Every window has an active tab; the one the user is looking at is the
    // most recently accessed of them.
    let focused_tab = items
        .iter()
        .filter(|item| item.current)
        .map(|item| item.recency)
        .fold(f64::MIN, f64::max);
    for item in &mut items {
        item.current &= item.recency == focused_tab;
    }

    for app in apps::running() {
        items.push(Item {
            haystack: app.name.clone(),
            title: app.name,
            subtitle: "App".into(),
            icon: app.icon,
            target: Target::App { pid: app.pid },
            recency: app.last_active,
            current: Some(app.pid) == frontmost,
        });
    }
    items
}

/// Indices into `items`, best first.
///
/// Empty query: most recently used first, with the current item(s) moved to
/// the end so hotkey + Enter toggles to the previous thing. Otherwise: fuzzy
/// score, ties broken by recency.
pub fn rank(items: &[Item], query: &str) -> Vec<usize> {
    let by_recency = |a: &usize, b: &usize| items[*b].recency.total_cmp(&items[*a].recency);
    let query = query.trim();
    if query.is_empty() {
        let mut order: Vec<usize> = (0..items.len()).collect();
        order.sort_by(|a, b| {
            items[*a]
                .current
                .cmp(&items[*b].current)
                .then(by_recency(a, b))
        });
        return order;
    }

    let mut matcher = Matcher::new(MatcherConfig::DEFAULT);
    let pattern = Pattern::parse(query, CaseMatching::Smart, Normalization::Smart);
    let mut buffer = Vec::new();
    let mut scored: Vec<(u32, usize)> = items
        .iter()
        .enumerate()
        .filter_map(|(index, item)| {
            let score = pattern.score(Utf32Str::new(&item.haystack, &mut buffer), &mut matcher)?;
            Some((score, index))
        })
        .collect();
    scored.sort_by(|(score_a, a), (score_b, b)| score_b.cmp(score_a).then(by_recency(a, b)));
    scored.into_iter().map(|(_, index)| index).collect()
}
