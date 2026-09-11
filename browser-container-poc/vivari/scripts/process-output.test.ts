import { expect, test } from 'bun:test';
import { runtimeSourceUrl } from './runtime-source.mjs';
const { VivariProcess } = await import(runtimeSourceUrl('packages/core/src/process.ts').href);

test('resize retains the newest pre-start size and removes its startup listener on exit', () => {
  const listeners = new Map<string, (m: any) => void>();
  const posts: any[] = [];
  const bridge = {
    on(type: string, fn: (m: any) => void) { listeners.set(type, fn); return () => listeners.delete(type); },
    post(type: string, data: any) { posts.push({ type, ...data }); },
  };
  const proc = new VivariProcess(bridge as any, 7, 'sh', [], { terminal: { cols: 100, rows: 30 } });
  expect(posts[0].terminal).toEqual({ cols: 100, rows: 30 });
  proc.resize({ cols: 70, rows: 20 }); proc.resize({ cols: 71, rows: 21 });
  expect(posts.length).toBe(1);
  expect(() => proc.resize({ cols: NaN, rows: 20 })).toThrow(RangeError);
  listeners.get('proc-started')!({ execId: 8 }); expect(posts.length).toBe(1);
  listeners.get('proc-started')!({ execId: 7 });
  expect(posts.at(-1)).toEqual({ type: 'proc-resize', execId: 7, cols: 71, rows: 21 });
  expect(listeners.has('proc-started')).toBe(false);
  listeners.get('proc-exit')!({ execId: 7, code: 0 });
  proc.resize({ cols: 80, rows: 24 }); expect(posts.length).toBe(2);
  expect(listeners.size).toBe(0);
});

test('a stalled output consumer errors and kills only its own process; exit removes listeners', async () => {
  const listeners = new Map<string, Set<(m: any) => void>>();
  const posts: any[] = [];
  const bridge = {
    on(type: string, fn: (m: any) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn); return () => listeners.get(type)!.delete(fn);
    },
    post(type: string, data: any) { posts.push({ type, ...data }); },
  };
  const emit = (type: string, data: any) => { for (const fn of listeners.get(type) || []) fn(data); };
  const a = new VivariProcess(bridge as any, 1, 'sh', [], {});
  const b = new VivariProcess(bridge as any, 2, 'sh', [], {});
  emit('proc-out', { execId: 1, chunk: 'x'.repeat(1 << 20) });
  emit('proc-out', { execId: 2, chunk: 'sibling' });
  emit('proc-out', { execId: 1, chunk: 'overflow' });
  await expect(a.output.getReader().read()).rejects.toThrow('backlog exceeded');
  expect(posts.filter(p => p.type === 'proc-kill')).toEqual([{ type: 'proc-kill', execId: 1 }]);
  expect((await b.output.getReader().read()).value).toBe('sibling');
  emit('proc-exit', { execId: 1, code: 143 });
  expect(await a.exit).toBe(143);
  expect(listeners.get('proc-out')!.size).toBe(1);
  emit('proc-exit', { execId: 2, code: 0 });
  expect(await b.exit).toBe(0);
  expect(listeners.get('proc-out')!.size).toBe(0);
});
