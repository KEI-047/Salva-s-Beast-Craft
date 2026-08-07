import { PricePoint } from '../types';

const API_BASE = 'https://api.twelvedata.com';
const INTERVAL = '15min';
const BARS_PER_DAY = 96; // 24h * 4 (15分足)
const CACHE_TTL_MS = 60 * 1000;

const API_KEY = process.env.EXPO_PUBLIC_TWELVEDATA_API_KEY;

type TwelveDataSeries = {
  status: 'ok' | 'error';
  message?: string;
  values?: { datetime: string; close: string }[];
};

function toSymbol(base: string, quote: string): string {
  return `${base}/${quote}`;
}

function toOutputSize(dayRange: number): number {
  return Math.min(dayRange * BARS_PER_DAY, 5000);
}

function toPricePoints(series: TwelveDataSeries | undefined): PricePoint[] {
  if (!series || series.status !== 'ok' || !series.values) return [];
  // Twelve Dataは新しい順(降順)で返すため、時系列順に並べ替える。
  return [...series.values]
    .reverse()
    .map((value) => ({ date: value.datetime, rate: parseFloat(value.close) }))
    .filter((point) => Number.isFinite(point.rate));
}

function assertApiKey() {
  if (!API_KEY) {
    throw new Error(
      'Twelve Data APIキーが未設定です。EXPO_PUBLIC_TWELVEDATA_API_KEY を .env に設定してください。'
    );
  }
}

type BulkCacheEntry = { fetchedAt: number; data: Record<string, PricePoint[]> };
const bulkHistoryCache = new Map<string, BulkCacheEntry>();

// 複数通貨ペアを1回のリクエストでまとめて取得する(APIコール数節約のため)。
export async function fetchHistories(
  pairs: { id: string; base: string; quote: string }[],
  dayRange: number
): Promise<Record<string, PricePoint[]>> {
  assertApiKey();
  if (pairs.length === 0) return {};

  const outputSize = toOutputSize(dayRange);
  const symbols = pairs.map((pair) => toSymbol(pair.base, pair.quote));
  const cacheKey = `${symbols.join(',')}:${outputSize}`;
  const cached = bulkHistoryCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  const url =
    `${API_BASE}/time_series?symbol=${encodeURIComponent(symbols.join(','))}` +
    `&interval=${INTERVAL}&outputsize=${outputSize}&apikey=${API_KEY}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`為替レートの取得に失敗しました (HTTP ${response.status})`);
  }
  const json = await response.json();

  const result: Record<string, PricePoint[]> = {};
  pairs.forEach((pair) => {
    const symbol = toSymbol(pair.base, pair.quote);
    // 単一シンボルのみの場合はキー無しでフラットに返ってくるため両対応する。
    const series: TwelveDataSeries | undefined = pairs.length === 1 ? json : json[symbol];
    result[pair.id] = toPricePoints(series);
  });

  bulkHistoryCache.set(cacheKey, { fetchedAt: Date.now(), data: result });
  return result;
}

type CacheEntry = { fetchedAt: number; data: PricePoint[] };
const historyCache = new Map<string, CacheEntry>();

export async function fetchHistory(
  base: string,
  quote: string,
  dayRange: number
): Promise<PricePoint[]> {
  assertApiKey();

  const outputSize = toOutputSize(dayRange);
  const symbol = toSymbol(base, quote);
  const cacheKey = `${symbol}:${outputSize}`;
  const cached = historyCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  const url =
    `${API_BASE}/time_series?symbol=${encodeURIComponent(symbol)}` +
    `&interval=${INTERVAL}&outputsize=${outputSize}&apikey=${API_KEY}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`為替レートの取得に失敗しました (HTTP ${response.status})`);
  }
  const json: TwelveDataSeries = await response.json();

  if (json.status !== 'ok') {
    throw new Error(json.message ?? `${base}/${quote} のデータがありません。`);
  }

  const points = toPricePoints(json);
  historyCache.set(cacheKey, { fetchedAt: Date.now(), data: points });
  return points;
}
