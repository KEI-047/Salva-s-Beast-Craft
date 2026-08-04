import { PricePoint } from '../types';

const API_BASE = 'https://finnhub.io/api/v1';
const RESOLUTION_MINUTES = 15;
const CACHE_TTL_MS = 60 * 1000;

const API_KEY = process.env.EXPO_PUBLIC_FINNHUB_API_KEY;

type CacheEntry = { fetchedAt: number; data: PricePoint[] };
const historyCache = new Map<string, CacheEntry>();

type FinnhubCandleResponse = {
  s: 'ok' | 'no_data';
  t?: number[];
  c?: number[];
};

function toOandaSymbol(base: string, quote: string): string {
  return `OANDA:${base}_${quote}`;
}

// Finnhubの無料枠(15分足)は直近データのみ取得可能なため、
// dayRangeは「何日分さかのぼるか」の目安として使う。
export async function fetchHistory(
  base: string,
  quote: string,
  dayRange: number
): Promise<PricePoint[]> {
  if (!API_KEY) {
    throw new Error(
      'Finnhub APIキーが未設定です。EXPO_PUBLIC_FINNHUB_API_KEY を .env に設定してください。'
    );
  }

  const cacheKey = `${base}-${quote}-${dayRange}`;
  const cached = historyCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  const to = Math.floor(Date.now() / 1000);
  const from = to - dayRange * 24 * 60 * 60;
  const symbol = toOandaSymbol(base, quote);

  const url =
    `${API_BASE}/forex/candle?symbol=${encodeURIComponent(symbol)}` +
    `&resolution=${RESOLUTION_MINUTES}&from=${from}&to=${to}&token=${API_KEY}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`為替レートの取得に失敗しました (HTTP ${response.status})`);
  }
  const json: FinnhubCandleResponse = await response.json();

  if (json.s !== 'ok' || !json.t || !json.c) {
    throw new Error(`${base}/${quote} のデータがありません。`);
  }

  const points: PricePoint[] = json.t
    .map((timestamp, index) => ({
      date: new Date(timestamp * 1000).toISOString(),
      rate: json.c![index],
    }))
    .filter((point) => typeof point.rate === 'number');

  historyCache.set(cacheKey, { fetchedAt: Date.now(), data: points });
  return points;
}
