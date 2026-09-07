// Source overlay: upstream's fs.watchFile is push-based, despite its interval argument.
// Poll Linux metadata for mounted paths; retain upstream push watches elsewhere.
export function patchPoll(source:string) {
  const before='      this._prev = this._stat();\n      const h = host();';
  if(source.split(before).length!==2)throw Error('StatWatcher start source changed');
  source=source.replace(before,`      this._prev = this._stat();
      if ((filename === '/workspace' || filename.startsWith('/workspace/')) &&
          filename !== '/workspace/node_modules' && !filename.startsWith('/workspace/node_modules/')) {
        this._poll = require('timers').setInterval(() => {
          const curr = this._stat(), prev = this._prev;
          const changed = (!curr !== !prev) || (curr && prev &&
            (curr.mtimeMs !== prev.mtimeMs || curr.size !== prev.size || curr.ino !== prev.ino));
          this._prev = curr;
          if (changed) {
            const zero = () => { const s = new (require('fs').Stats)();
              for (const key of ['dev','ino','mode','nlink','uid','gid','rdev','size','blksize','blocks','atimeMs','mtimeMs','ctimeMs','birthtimeMs']) s[key] = this._bigint ? 0n : 0;
              for (const key of ['atime','mtime','ctime','birthtime']) s[key] = new Date(0);
              return s; };
            this.emit('change', curr || zero(), prev || zero());
          }
        }, Math.max(100, Number(interval) || 5007));
        if (!this._persistent) this._poll.unref?.();
        return;
      }
      const h = host();`);
  const stop='      this._stopped = true;\n      const h = host();';
  if(source.split(stop).length!==2)throw Error('StatWatcher stop source changed');
  return source.replace(stop,"      this._stopped = true;\n      if (this._poll) require('timers').clearInterval(this._poll);\n      const h = host();");
}
