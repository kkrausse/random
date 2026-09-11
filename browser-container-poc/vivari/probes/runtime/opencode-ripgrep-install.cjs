const fs = require('node:fs');

fs.mkdirSync('/direct/node_modules/.bin', { recursive: true });
fs.symlinkSync('../ripgrep/lib/rg.mjs', '/direct/node_modules/.bin/rg');
fs.chmodSync('/direct/node_modules/ripgrep/lib/rg.mjs', 0o755);
console.log('OPENCODE_RIPGREP_INSTALL_PASS');
