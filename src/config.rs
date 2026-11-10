use serde::Deserialize;

/// `~/.config/switcher/config.toml`. Every key is optional.
#[derive(Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Config {
    /// Global hotkey in `global-hotkey` syntax, e.g. "alt+space", "cmd+shift+KeyK".
    pub hotkey: String,
    /// Loopback port the browser extension connects to.
    pub port: u16,
    /// Bundle id of the browser to bring forward when a tab is picked. Unset:
    /// the browser is detected from the extension's socket, falling back to
    /// Chrome.
    pub browser_bundle_id: Option<String>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            hotkey: "alt+space".into(),
            port: 47600,
            browser_bundle_id: None,
        }
    }
}

pub fn load() -> Config {
    let Some(path) = dirs::home_dir().map(|home| home.join(".config/switcher/config.toml")) else {
        return Config::default();
    };
    let Ok(text) = std::fs::read_to_string(&path) else {
        return Config::default();
    };
    toml::from_str(&text).unwrap_or_else(|error| {
        eprintln!("switcher: ignoring {}: {error}", path.display());
        Config::default()
    })
}
