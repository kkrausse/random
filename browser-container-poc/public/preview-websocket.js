// Vite's WebSocket API forwards to a real guest-loopback socket (text HMR only).
window.WebSocket = class GuestWebSocket extends EventTarget {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  CONNECTING = 0; OPEN = 1; CLOSING = 2; CLOSED = 3;
  readyState = 0; bufferedAmount = 0; extensions = ""; protocol = ""; binaryType = "blob";
  constructor(url, protocols = []) {
    super(); this.url = String(url);
    const target = new URL(url);
    const channel = new MessageChannel(); this.port = channel.port1;
    this.port.onmessage = ({ data }) => {
      let event;
      if (data.type === "ws-open") {
        this.readyState = 1; this.protocol = data.protocol; event = new Event("open");
      } else if (data.type === "ws-message") {
        event = new MessageEvent("message", { data: data.data });
      } else if (data.type === "ws-close") {
        this.readyState = 3;
        event = new CloseEvent("close", { code: data.code, reason: data.reason, wasClean: data.code === 1000 });
        this.port.close();
      } else { event = new Event("error"); }
      this.dispatchEvent(event); this[`on${event.type}`]?.(event);
    };
    parent.postMessage({ source: "guest-ws", request: {
      type: "ws-open", path: target.pathname + target.search,
      protocols: typeof protocols === "string" ? [protocols] : protocols,
    } }, location.origin, [channel.port2]);
    window.addEventListener("pagehide", () => this.close(), { once: true });
  }
  send(data) {
    if (this.readyState !== 1) throw new DOMException("WebSocket is not open", "InvalidStateError");
    if (typeof data !== "string") throw new TypeError("The POC bridge supports text messages only");
    this.port.postMessage({ type: "ws-send", data });
  }
  close(code = 1000, reason = "") {
    this.readyState = 2; this.port.postMessage({ type: "ws-close", code, reason });
  }
};
