// browser-control execute --session <session> --file qemu-perf/inspect.js
return { at: Date.now(), bootAt: state.boot, tuiStart: state.tuiStart,
  text: await page.frames()[1].locator('body').innerText(),
  screens: await page.frames()[1].evaluate(() => window.__screenEvents ?? []),
};
