import type { Vivari, VivariProcess } from '@vivari/core';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

// One renderer and one I/O owner per guest shell. Hidden terminals keep parsing
// live output; selecting a tab never replays terminal queries or restarts a job.
export class ShellSessions {
  private next = 1;
  readonly sessions = new Map<number, ShellSession>();
  constructor(private vm: () => Vivari, private tabs: HTMLElement, private panes: HTMLElement, private log: (s: string) => void) {}
  async open() {
    if (this.sessions.size >= 4) throw Error('Close a shell before opening another (limit 4)');
    const id = this.next++;
    const session = new ShellSession(id, this.tabs, this.panes, this.log, () => this.select(id), () => {
      this.sessions.delete(id);
      const next = this.sessions.keys().next().value;
      if (next !== undefined) this.select(next);
    });
    this.sessions.set(id, session);
    this.select(id);
    await session.start(this.vm());
    return id;
  }
  select(id: number) { for (const [key, session] of this.sessions) session.show(key === id); }
}

class ShellSession {
  readonly terminal = new Terminal({ convertEol: true, fontSize: 14, scrollback: 5000 });
  private fit = new FitAddon();
  private pane = document.createElement('section');
  private screen = document.createElement('div');
  private tab = document.createElement('button');
  private status = document.createElement('span');
  private observer: ResizeObserver;
  private proc?: VivariProcess;
  private writer?: WritableStreamDefaultWriter<string>;
  private queue: string[] = [];
  private queued = 0;
  private sending = false;
  private pendingOutput = 0;
  private closed = false;
  private stopping = false;
  private starting = false;
  private vm?: Vivari;
  transcript = '';
  state = 'created';
  constructor(readonly id: number, tabs: HTMLElement, panes: HTMLElement, private log: (s: string) => void, select: () => void, private removed: () => void) {
    this.tab.textContent = `Shell ${id}`;
    this.tab.onclick = select;
    tabs.append(this.tab);
    this.screen.className = 'shell-screen';
    this.screen.setAttribute('aria-label', `Shell ${id} terminal`);
    this.pane.dataset.shell = String(id);
    const stop = document.createElement('button');
    stop.textContent = 'Stop shell'; stop.onclick = () => this.stop();
    const restart = document.createElement('button');
    restart.textContent = 'Restart shell';
    restart.onclick = () => { if (this.vm) void this.start(this.vm).catch(e => this.report(String(e))); };
    const close = document.createElement('button');
    close.textContent = 'Close shell'; close.onclick = () => this.dispose();
    this.pane.append(this.status, stop, restart, close, this.screen);
    panes.append(this.pane);
    this.terminal.loadAddon(this.fit);
    this.terminal.open(this.screen);
    this.terminal.onData(data => this.send(data));
    this.terminal.onResize(size => { this.proc?.resize(size); this.updateStatus(); });
    this.observer = new ResizeObserver(() => { if (!this.pane.hidden) { this.fit.fit(); this.updateStatus(); } });
    this.observer.observe(this.screen);
  }
  private report(state: string) {
    this.state = state;
    this.updateStatus();
    this.log(`[shell ${this.id}] ${state}\n`);
  }
  private updateStatus() { this.status.textContent = `Shell ${this.id}: ${this.state} · terminal ${this.terminal.cols}×${this.terminal.rows} `; }
  show(visible: boolean) {
    this.pane.hidden = !visible;
    this.tab.setAttribute('aria-pressed', String(visible));
    if (visible) { this.fit.fit(); this.updateStatus(); this.terminal.focus(); }
  }
  async start(vm: Vivari) {
    if (this.closed || this.proc || this.starting) return;
    this.starting = true; this.vm = vm; this.stopping = false;
    this.report('starting');
    try {
      const proc = await vm.spawn('sh', [], { cwd: '/workspace', env: { TERM: 'xterm-256color' }, terminal: { cols: this.terminal.cols, rows: this.terminal.rows } });
      this.proc = proc;
      proc.resize({ cols: this.terminal.cols, rows: this.terminal.rows });
      if (this.closed || this.stopping) proc.kill();
      this.writer = proc.input.getWriter();
      this.report(this.stopping ? 'stopping' : 'running');
      void this.consume(proc);
    } catch (e) { this.report(`failed: ${e}`); throw e; }
    finally { this.starting = false; }
  }
  send(data: string) {
    if (!this.writer || this.closed || this.stopping) return;
    // Bound pending input, including the in-flight write. Never silently truncate
    // a paste into a different command. WritableStream writes are serialized.
    if (this.queued + data.length > 65536) { this.log(`[shell ${this.id}] input exceeds 64 Ki characters; paste rejected\n`); return; }
    this.queue.push(data); this.queued += data.length;
    void this.flush();
  }
  private async flush() {
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.queue.length && this.writer && !this.stopping) {
        const data = this.queue.shift()!;
        try { await this.writer.write(data); } finally { this.queued -= data.length; }
      }
    } catch (e) { this.log(`[shell ${this.id}] input failed: ${e}\n`); this.stop(); }
    finally { this.sending = false; }
  }
  private async consume(proc: VivariProcess) {
    try {
      for await (const chunk of proc.output) {
        if (this.closed || this.stopping) continue;
        this.transcript = (this.transcript + chunk).slice(-262144);
        if (this.pendingOutput + chunk.length > 262144) {
          this.log(`[shell ${this.id}] renderer backlog exceeded 256 Ki characters; stopping shell\n`);
          this.stop(); continue;
        }
        this.pendingOutput += chunk.length;
        this.terminal.write(chunk, () => { this.pendingOutput -= chunk.length; });
      }
      const code = await proc.exit;
      this.report(`exited ${code}`);
    } catch (e) { proc.kill(); this.report(`output failed: ${e}`); await proc.exit; }
    finally {
      // A stopped session cannot restart until its original output/exit settles.
      this.queue = []; this.queued = 0;
      this.writer?.releaseLock(); this.writer = undefined; this.proc = undefined;
    }
  }
  stop() {
    if (this.stopping) return;
    this.stopping = true;
    this.queued -= this.queue.reduce((n, s) => n + s.length, 0);
    this.queue = []; // queued count now includes only a possible in-flight write
    this.report('stopping');
    this.proc?.kill();
  }
  dispose() {
    if (this.closed) return;
    this.stop(); this.closed = true;
    this.observer.disconnect(); this.terminal.dispose();
    this.tab.remove(); this.pane.remove(); this.removed();
  }
}
