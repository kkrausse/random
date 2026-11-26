import { apiFetch, wsUrl, signedOut } from "./endpoint";
import { useEffect, useRef, useState } from "react";
import type { WatchState } from "./types.ts";

export type LiveStatus = "connecting" | "live" | "offline";

// The list over a WebSocket: the server forwards each faplex watch line as it changes.
export function useLive() {
  const [state, setState] = useState<WatchState>();
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [error, setError] = useState<string>();
  const ws = useRef<WebSocket>(undefined);

  useEffect(() => {
    let closed = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      clearTimeout(timer);
      if (closed || (ws.current && ws.current.readyState <= WebSocket.OPEN)) return;
      setStatus("connecting");
      const socket = new WebSocket(wsUrl(`/api/live`));
      ws.current = socket;
      socket.onopen = () => {
        retry = 0;
        setStatus("live");
      };
      socket.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data.error) setError(data.error);
        else {
          setError(undefined);
          setState(data);
        }
      };
      socket.onclose = (e) => {
        if (ws.current === socket) ws.current = undefined;
        if (closed) return;
        setStatus("offline");
        // A 401 on upgrade closes as 1006 with no detail: ask the page whether we are signed out.
        if (e.code === 1006) void apiFetch("/api/theme").then((r) => r.status === 401 && signedOut());
        timer = setTimeout(connect, Math.min(10_000, 500 * 2 ** retry++));
      };
    };
    connect();
    // Back from the background: the socket may be dead without looking closed, so start over.
    let hiddenAt = 0;
    const fresh = () => {
      const old = ws.current;
      ws.current = undefined;
      old?.close();
      retry = 0;
      connect();
    };
    const wake = () => {
      if (document.hidden) return void (hiddenAt = Date.now());
      if (hiddenAt && Date.now() - hiddenAt > 1000) fresh();
      else connect();
      hiddenAt = 0;
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    return () => {
      closed = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      ws.current?.close();
    };
  }, []);

  const warm = (key: string) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify({ warm: key }));
  };
  return { state, status, error, warm };
}
