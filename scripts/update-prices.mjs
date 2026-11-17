// Snapshot CSFloat prices for every item in the page's cases.
// CSFloat doesn't allow browser requests from other sites, so this runs in
// GitHub Actions and publishes prices.json to the `prices` branch.
//   min[name]   = lowest current listing (cents), from the public price list
//   sales[name] = { t: unix time, s: [[float, price cents, paint index], ...] } recent sales of gold items
import fs from 'node:fs';

const NAMES = JSON.parse(fs.readFileSync(new URL('../names.json', import.meta.url), 'utf8'));
const PER_RUN = Number(process.env.PER_RUN || 400);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const UA = { 'user-agent': 'poland-practice-map price snapshot' };

let prev = {};
try { prev = JSON.parse(fs.readFileSync(process.env.PREV || 'prev.json', 'utf8')); } catch {}

const list = await (await fetch('https://csfloat.com/api/v1/listings/price-list', { headers: UA })).json();
const want = new Set(NAMES.all), min = {};
for (const p of list) if (want.has(p.market_hash_name)) min[p.market_hash_name] = p.min_price;

// Refresh the stalest gold items first; the rest keep their previous sales.
const sales = prev.sales || {};
const queue = NAMES.gold.slice().sort((a, b) => (sales[a]?.t || 0) - (sales[b]?.t || 0)).slice(0, PER_RUN);
let ok = 0, fail = 0;
async function refresh(name) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(`https://csfloat.com/api/v1/history/${encodeURIComponent(name)}/sales`, { headers: UA }).catch(() => null);
    if (r?.status === 429) { await sleep(5000 * (attempt + 1)); continue; }
    if (!r?.ok) break;
    const j = await r.json();
    sales[name] = { t: Math.floor(Date.now() / 1000), s: j.slice(0, 30).map(x => [+x.item.float_value.toFixed(5), x.price, x.item.paint_index || 0]) };
    ok++; return;
  }
  fail++;
}
await Promise.all(Array.from({ length: 3 }, async () => { while (queue.length) { await refresh(queue.shift()); await sleep(150); } }));

fs.mkdirSync('out', { recursive: true });
fs.writeFileSync('out/prices.json', JSON.stringify({ updated: new Date().toISOString(), min, sales }));
console.log(`price list: ${Object.keys(min).length} names · sales refreshed ${ok}, failed ${fail} · ${Object.keys(sales).length} gold names stored`);
if (!Object.keys(min).length || (ok === 0 && fail > 0)) process.exit(1);
