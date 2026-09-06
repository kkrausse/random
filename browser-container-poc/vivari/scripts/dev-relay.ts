import type { ServerWebSocket } from 'bun';

const origins = new Set(['http://127.0.0.1:5192', 'http://127.0.0.1:5190']);
const token = crypto.randomUUID() + crypto.randomUUID();
type Browser = ServerWebSocket<{ runtime?: string; connectedAt: string; helloTimer?: ReturnType<typeof setTimeout> }>;
type Pending = {
  browser: Browser;
  controller: ReadableStreamDefaultController<Uint8Array>;
  timer: ReturnType<typeof setTimeout>;
};
const browsers = new Map<string, Browser>();
const pending = new Map<string, Pending>();
const encoder = new TextEncoder();

function finish(id: string, message: Record<string, unknown>) {
  const request = pending.get(id);
  if (!request) return;
  pending.delete(id);
  clearTimeout(request.timer);
  try {
    request.controller.enqueue(encoder.encode(JSON.stringify({ ...message, type: 'result', id }) + '\n'));
    request.controller.close();
  } catch { /* The HTTP client may already have disconnected. */ }
}

function cancel(id: string, error: string) {
  const request = pending.get(id);
  if (!request) return;
  request.browser.send(JSON.stringify({ type: 'cancel', id }));
  finish(id, { error });
}

const server = Bun.serve<{ runtime?: string; connectedAt: string; helloTimer?: ReturnType<typeof setTimeout> }, {}>({
  hostname: '127.0.0.1',
  port: 5193,
  idleTimeout: 0,
  maxRequestBodySize: 2 * 1024 * 1024,
  async fetch(request, server) {
    const url = new URL(request.url);
    const origin = request.headers.get('origin');
    const headers = new Headers({ 'Cache-Control': 'no-store', Vary: 'Origin' });
    if (origin && origins.has(origin)) {
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Content-Type');
    }
    const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
    if (!['127.0.0.1:5193', 'localhost:5193'].includes(request.headers.get('host') ?? '')) {
      return json({ error: 'Invalid relay host' }, 403);
    }
    if (origin !== null && !origins.has(origin)) return json({ error: 'Origin not allowed' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (url.pathname === '/token' && request.method === 'GET') {
      if (!origin || !origins.has(origin)) return json({ error: 'Browser origin required' }, 403);
      return json({ token });
    }
    if (url.pathname === '/browser' && request.method === 'GET') {
      if (!origin || !origins.has(origin) || url.searchParams.get('token') !== token) {
        return json({ error: 'Invalid browser origin or token' }, 403);
      }
      if (server.upgrade(request, { data: { connectedAt: new Date().toISOString() } })) return;
      return json({ error: 'WebSocket upgrade required' }, 400);
    }
    if (url.pathname === '/runtimes' && request.method === 'GET') {
      return json({ runtimes: [...browsers].map(([id, browser]) => ({ id, connectedAt: browser.data.connectedAt })) });
    }
    if (url.pathname !== '/request' || request.method !== 'POST') return json({ error: 'Not found' }, 404);
    let body: Record<string, unknown>;
    try {
      const value = await request.json();
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      body = value;
    } catch { return json({ error: 'Expected a JSON object' }, 400); }
    if (typeof body.runtime !== 'string' || !body.runtime || typeof body.op !== 'string' || !body.op) {
      return json({ error: 'Explicit runtime and op are required' }, 400);
    }
    if (body.args !== undefined && (!body.args || typeof body.args !== 'object' || Array.isArray(body.args))) {
      return json({ error: 'args must be an object' }, 400);
    }
    const id = body.requestId ?? crypto.randomUUID();
    if (typeof id !== 'string' || !id || id.length > 200) return json({ error: 'Invalid requestId' }, 400);
    if (pending.has(id)) return json({ error: 'requestId already active' }, 409);
    const timeout = body.timeout ?? 120_000;
    if (typeof timeout !== 'number' || !Number.isInteger(timeout) || timeout < 1 || timeout > 86_400_000) {
      return json({ error: 'timeout must be 1..86400000 milliseconds' }, 400);
    }
    const browser = browsers.get(body.runtime);
    if (!browser) return json({ error: `Runtime not connected: ${body.runtime}` }, 404);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const timer = setTimeout(() => cancel(id, `Request timed out after ${timeout}ms`), timeout);
        pending.set(id, { browser, controller, timer });
        controller.enqueue(encoder.encode(JSON.stringify({ type: 'accepted', id }) + '\n'));
        browser.send(JSON.stringify({ type: 'request', id, op: body.op, args: body.args ?? {} }));
      },
      cancel() { cancel(id, 'HTTP client disconnected'); },
    });
    headers.set('Content-Type', 'application/x-ndjson');
    return new Response(stream, { headers });
  },
  websocket: {
    idleTimeout: 0,
    maxPayloadLength: 2 * 1024 * 1024,
    open(browser) {
      browser.data.helloTimer = setTimeout(() => browser.close(1008, 'hello required'), 5000);
    },
    message(browser, raw) {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
        if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error();
      } catch { browser.close(1008, 'Invalid JSON message'); return; }
      if (message.type === 'hello') {
        if (browser.data.runtime || typeof message.id !== 'string' || !message.id || message.id.length > 200 || browsers.has(message.id)) {
          browser.close(1008, 'Invalid or duplicate runtime id');
          return;
        }
        clearTimeout(browser.data.helloTimer);
        browser.data.runtime = message.id;
        browsers.set(message.id, browser);
        return;
      }
      if (!browser.data.runtime) { browser.close(1008, 'hello required'); return; }
      if (typeof message.id !== 'string') return;
      const request = pending.get(message.id);
      if (!request || request.browser !== browser) return;
      if (message.type === 'event' && message.event === 'output' && typeof message.data === 'string') {
        try {
          request.controller.enqueue(encoder.encode(JSON.stringify({ type: 'event', id: message.id, event: 'output', data: message.data }) + '\n'));
        } catch { cancel(message.id, 'HTTP client disconnected'); }
      } else if (message.type === 'event' && message.event === 'ready' && message.data && typeof message.data === 'object') {
        try {
          request.controller.enqueue(encoder.encode(JSON.stringify({ type: 'event', id: message.id, event: 'ready', data: message.data }) + '\n'));
        } catch { cancel(message.id, 'HTTP client disconnected'); }
      } else if (message.type === 'result') {
        finish(message.id, { result: message.result, error: message.error });
      }
    },
    close(browser) {
      clearTimeout(browser.data.helloTimer);
      if (browser.data.runtime && browsers.get(browser.data.runtime) === browser) browsers.delete(browser.data.runtime);
      for (const [id, request] of pending) {
        if (request.browser === browser) finish(id, { error: 'Browser disconnected' });
      }
    },
  },
});

console.log(`Development relay listening on ${server.url}`);
