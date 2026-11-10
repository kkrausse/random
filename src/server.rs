//! Loopback WebSocket server the browser extension connects to.
//!
//! One thread per connection. Each connection owns a full tab snapshot that is
//! replaced on every `tabs` message and dropped when the socket closes.

use std::collections::HashMap;
use std::io::ErrorKind;
use std::net::{Ipv4Addr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, Sender, channel};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Deserialize;
use tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tungstenite::http::StatusCode;
use tungstenite::{Error, Message};

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Tab {
    pub id: i64,
    pub window_id: i64,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub url: String,
    /// Milliseconds since the epoch.
    #[serde(default)]
    pub last_accessed: f64,
    #[serde(default)]
    pub active: bool,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum Incoming {
    Tabs {
        tabs: Vec<Tab>,
    },
    Ping,
    #[serde(other)]
    Unknown,
}

pub struct Connection {
    pub tabs: Vec<Tab>,
    outgoing: Sender<String>,
}

/// Live extension connections keyed by connection id.
pub type Connections = Arc<Mutex<HashMap<u64, Connection>>>;

/// Asks the extension behind `connection` to focus a tab. Returns false if it is gone.
pub fn activate_tab(
    connections: &Connections,
    connection: u64,
    tab_id: i64,
    window_id: i64,
) -> bool {
    let message = serde_json::json!({ "type": "activate", "tabId": tab_id, "windowId": window_id });
    connections
        .lock()
        .unwrap()
        .get(&connection)
        .is_some_and(|connection| connection.outgoing.send(message.to_string()).is_ok())
}

/// Binds `127.0.0.1:port` and serves on background threads. `changed` runs after
/// every change to the tab set.
pub fn serve(
    port: u16,
    connections: Connections,
    changed: impl Fn() + Send + Sync + 'static,
) -> std::io::Result<()> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, port))?;
    let changed = Arc::new(changed);
    let next_id = AtomicU64::new(1);
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let id = next_id.fetch_add(1, Ordering::Relaxed);
            let connections = connections.clone();
            let changed = changed.clone();
            std::thread::spawn(move || {
                let (outgoing, queued) = channel();
                if let Err(error) =
                    run_connection(stream, id, &connections, outgoing, queued, &*changed)
                {
                    eprintln!("switcher: connection {id}: {error}");
                }
                if connections.lock().unwrap().remove(&id).is_some() {
                    changed();
                }
            });
        }
    });
    Ok(())
}

/// Web pages may open sockets to localhost, so only extension origins get in.
fn check_origin(request: &Request, response: Response) -> Result<Response, ErrorResponse> {
    let allowed = request
        .headers()
        .get("origin")
        .and_then(|origin| origin.to_str().ok())
        .is_some_and(|origin| origin.starts_with("chrome-extension://"));
    if allowed {
        return Ok(response);
    }
    let mut rejection = ErrorResponse::new(Some("origin not allowed".into()));
    *rejection.status_mut() = StatusCode::FORBIDDEN;
    Err(rejection)
}

fn run_connection(
    stream: TcpStream,
    id: u64,
    connections: &Connections,
    outgoing: Sender<String>,
    queued: Receiver<String>,
    changed: &dyn Fn(),
) -> Result<(), Box<dyn std::error::Error>> {
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    let mut socket = tungstenite::accept_hdr(stream, check_origin).map_err(|e| e.to_string())?;
    // A short read timeout turns the blocking read into a poll, so this one
    // thread can also flush queued `activate` messages promptly.
    socket
        .get_ref()
        .set_read_timeout(Some(Duration::from_millis(15)))?;
    connections.lock().unwrap().insert(
        id,
        Connection {
            tabs: Vec::new(),
            outgoing,
        },
    );

    loop {
        while let Ok(message) = queued.try_recv() {
            socket.send(Message::text(message))?;
        }
        let text = match socket.read() {
            Ok(Message::Text(text)) => text,
            Ok(Message::Close(_)) | Err(Error::ConnectionClosed | Error::AlreadyClosed) => {
                return Ok(());
            }
            Ok(_) => continue,
            Err(Error::Io(error))
                if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) =>
            {
                continue;
            }
            Err(error) => return Err(error.into()),
        };
        match serde_json::from_str(&text) {
            Ok(Incoming::Tabs { tabs }) => {
                if let Some(connection) = connections.lock().unwrap().get_mut(&id) {
                    connection.tabs = tabs;
                }
                changed();
            }
            Ok(Incoming::Ping) => socket.send(Message::text(r#"{"type":"pong"}"#))?,
            Ok(Incoming::Unknown) => {}
            Err(error) => eprintln!("switcher: connection {id}: bad message: {error}"),
        }
    }
}
