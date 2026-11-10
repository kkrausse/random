use serde::Deserialize;

/// `~/.config/switcher/config.toml`. Every key is optional.
#[derive(Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Config {
    /// Global hotkey in `global-hotkey` syntax, e.g. "alt+space", "cmd+shift+KeyK".
    pub hotkey: String,
    /// Loopback port the browser extension connects to.
    pub port: u16,
    /// Bundle id of the browser the extension lives in; brought to the front when a tab is picked.
    pub browser_bundle_id: String,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            hotkey: "alt+space".into(),
            port: 47600,
            browser_bundle_id: "com.google.Chrome".into(),
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
