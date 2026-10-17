// Builds dist/ with content-hashed CSV and JS names. Cloudflare caches .csv and
// .js for hours but passes .html and .json through, so index.html and
// version.json always point the page at the newest files.
//   bun build.ts && ../scripts/deploy-artifact.sh --public dist polo-schedule
import { parseCSV } from './schedule.js';

const dir = import.meta.dir, out = `${dir}/dist`;
const read = (name: string) => Bun.file(`${dir}/${name}`).text();
const hash = (text: string) => new Bun.CryptoHasher('sha256').update(text).digest('hex').slice(0, 10);
const hashed = (name: string, text: string) => name.replace(/\.(\w+)$/, `.${hash(text)}.$1`);

const csv = await read('schedule.csv');
parseCSV(csv); // refuse to publish a CSV the page would reject

const schedule = await read('schedule.js'), scheduleName = hashed('schedule.js', schedule);
const app = (await read('app.js')).replace("'./schedule.js'", `'./${scheduleName}'`), appName = hashed('app.js', app);
const csvName = hashed('schedule.csv', csv);

await Bun.$`rm -rf ${out}`;
await Promise.all([
  Bun.write(`${out}/${csvName}`, csv),
  Bun.write(`${out}/${scheduleName}`, schedule),
  Bun.write(`${out}/${appName}`, app),
  Bun.write(`${out}/version.json`, JSON.stringify({ csv: csvName }) + '\n'),
  Bun.write(`${out}/index.html`, (await read('index.html'))
    .replace('src="app.js"', `src="${appName}"`)
    .replace('href="schedule.csv"', `href="${csvName}"`)),
]);
console.log(`dist/: ${appName} ${scheduleName} ${csvName}`);
