/**
 * GMOコインのPublic APIからレートを取得し、静的JSONとして書き出す。
 *
 * ブラウザからGMOへ直接アクセスするとCORSで遮断されるため、
 * GitHub Actions(サーバ側・CORSの制約なし)で定期実行し、結果をgh-pagesに置く。
 * アプリは同一オリジンのJSONとして読むので、中継サーバが無くても動作する。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = 'https://forex-api.coin.z.com/public/v1';
const OUT_DIR = process.argv[2] || 'public-data';

const SYMBOLS = [
  'USD_JPY', 'EUR_JPY', 'GBP_JPY', 'AUD_JPY', 'NZD_JPY',
  'CAD_JPY', 'CHF_JPY', 'EUR_USD', 'GBP_USD', 'AUD_USD',
];

/** 15分足は1日96本。指標計算には2日分あれば足りる。 */
const DAYS = 2;
const BARS_PER_DAY = 96;

function toDateParam(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

async function fetchCandles(symbol) {
  const wanted = DAYS * BARS_PER_DAY;
  const merged = [];
  const cursor = new Date();

  // 新しい日から遡り、必要な本数が揃った時点で打ち切る(休場日は空で返る)。
  for (let i = 0; i < DAYS + 4 && merged.length < wanted; i++) {
    const date = toDateParam(cursor);
    cursor.setDate(cursor.getDate() - 1);
    try {
      const json = await getJson(
        `${BASE}/klines?symbol=${symbol}&priceType=BID&interval=15min&date=${date}`
      );
      if (json.status === 0 && Array.isArray(json.data)) {
        merged.push(...json.data.map((row) => ({ t: Number(row.openTime), c: row.close })));
      }
    } catch (err) {
      console.warn(`  ${symbol} ${date}: ${err.message}`);
    }
  }

  const seen = new Set();
  return merged
    .filter((row) => (seen.has(row.t) ? false : (seen.add(row.t), true)))
    .sort((a, b) => a.t - b.t)
    .slice(-wanted);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const ticker = await getJson(`${BASE}/ticker`);
  await writeFile(
    path.join(OUT_DIR, 'ticker.json'),
    JSON.stringify({ fetchedAt: new Date().toISOString(), ...ticker })
  );
  console.log(`ticker: ${ticker.data?.length ?? 0} 銘柄`);

  const candles = {};
  for (const symbol of SYMBOLS) {
    candles[symbol] = await fetchCandles(symbol);
    console.log(`${symbol}: ${candles[symbol].length} 本`);
  }

  await writeFile(
    path.join(OUT_DIR, 'candles.json'),
    JSON.stringify({ fetchedAt: new Date().toISOString(), interval: '15min', candles })
  );

  const empty = Object.entries(candles).filter(([, rows]) => rows.length === 0);
  if (empty.length === SYMBOLS.length) {
    throw new Error('全銘柄でローソク足を取得できませんでした');
  }
  if (empty.length > 0) {
    console.warn(`データなし: ${empty.map(([s]) => s).join(', ')}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
