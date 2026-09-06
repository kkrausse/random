export interface ModelRoute {
  baseURL: string;
  headers: Record<string, string>;
}

function cleanHeaders(input: Headers) {
  const headers = new Headers(input);
  const connection = headers.get('connection')?.split(',') ?? [];
  for (const name of [...connection.map(value => value.trim()), 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length']) {
    if (name) headers.delete(name);
  }
  return headers;
}

export function modelProxy(routes: ReadonlyMap<string, ModelRoute>) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const match = /^\/api\/model\/([^/]+)\/(.*)$/.exec(url.pathname);
    const route = match && routes.get(match[1]);
    if (!route || !match) return new Response('Unknown model route', { status: 404 });
    if (!['GET', 'POST'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
    const base = new URL(route.baseURL.replace(/\/$/, '') + '/');
    const upstream = new URL(base.href + match[2] + url.search);
    if (upstream.origin !== base.origin || !upstream.pathname.startsWith(base.pathname)) return new Response('Invalid model path', { status: 400 });
    const headers = cleanHeaders(request.headers);
    for (const name of [...headers.keys()]) {
      if (['cookie', 'origin', 'referer', 'authorization', 'x-api-key', 'api-key', 'x-goog-api-key', 'forwarded'].includes(name) || name.startsWith('x-forwarded-') || name.startsWith('sec-')) headers.delete(name);
    }
    headers.set('accept-encoding', 'identity');
    for (const [name, value] of Object.entries(route.headers)) headers.set(name, value);
    try {
      const response = await fetch(upstream, {
        method: request.method, headers, body: request.body,
        signal: request.signal, redirect: 'manual',
      });
      const outgoing = cleanHeaders(response.headers);
      outgoing.delete('set-cookie');
      // fetch decodes compressed responses; don't advertise their wire encoding.
      outgoing.delete('content-encoding');
      outgoing.set('cache-control', 'no-store');
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers: outgoing });
    } catch {
      return new Response('Model upstream unavailable', { status: 502 });
    }
  };
}
