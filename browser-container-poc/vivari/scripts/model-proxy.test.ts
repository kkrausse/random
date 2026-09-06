import { test, expect } from 'bun:test';
import { modelProxy } from './model-proxy';

test('forwards SDK-selected paths, opaque bodies and status; isolates credentials', async () => {
  const upstream = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(request) {
    expect(new URL(request.url).pathname).toBe('/v1/new/endpoint');
    expect(new URL(request.url).search).toBe('?beta=1');
    expect(await request.text()).toBe(' {"opaque": true} ');
    expect(request.headers.get('authorization')).toBe('Bearer server-key');
    expect(request.headers.get('cookie')).toBeNull();
    expect(request.headers.get('x-api-key')).toBeNull();
    expect(request.headers.get('anthropic-version')).toBe('2023-06-01');
    return new Response('upstream rate limit', { status: 429, headers: { 'retry-after': '7', 'set-cookie': 'secret=1' } });
  } });
  try {
    const proxy = modelProxy(new Map([['test', { baseURL: `${upstream.url}v1`, headers: { authorization: 'Bearer server-key' } }]]));
    const response = await proxy(new Request('http://app/api/model/test/new/endpoint?beta=1', {
      method: 'POST', body: ' {"opaque": true} ', headers: {
        authorization: 'Bearer browser-key', cookie: 'session=private', 'x-api-key': 'other-key', 'anthropic-version': '2023-06-01',
      },
    }));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('7');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.text()).toBe('upstream rate limit');
    expect((await proxy(new Request('http://app/api/model/unknown/messages'))).status).toBe(404);
  } finally { await upstream.stop(true); }
});

test('streams before upstream completion and propagates client abort through Bun', async () => {
  const cancelled = Promise.withResolvers<void>();
  const upstream = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch(request) {
    request.signal.addEventListener('abort', () => cancelled.resolve(), { once: true });
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('data: first\n\n')); },
      cancel() { cancelled.resolve(); },
    }), { headers: { 'content-type': 'text/event-stream' } });
  } });
  const proxy = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: modelProxy(new Map([
    ['test', { baseURL: `${upstream.url}v1`, headers: {} }],
  ])) });
  const abort = new AbortController();
  try {
    const response = await fetch(`${proxy.url}api/model/test/messages`, { signal: abort.signal });
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: first\n\n');
    abort.abort();
    await cancelled.promise;
  } finally {
    abort.abort();
    await proxy.stop(true);
    await upstream.stop(true);
  }
}, 5000);

test('does not follow upstream redirects', async () => {
  const upstream = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch() {
    return new Response(null, { status: 307, headers: { location: 'https://example.invalid/' } });
  } });
  try {
    const response = await modelProxy(new Map([['test', { baseURL: upstream.url.href, headers: {} }]]))(
      new Request('http://app/api/model/test/messages'),
    );
    expect(response.status).toBe(307);
  } finally { await upstream.stop(true); }
});
