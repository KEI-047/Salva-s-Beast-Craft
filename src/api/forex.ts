import { PricePoint } from '../types';

const API_BASE = 'https://api.twelvedata.com';
const INTERVAL = '15min';
const BARS_PER_DAY = 96; // 24h * 4 (15分足)
// 15分足なので、5分キャッシュしても表示の鮮度は十分保てる。
const CACHE_TTL_MS = 5 * 60 * 1000;
// 無料プランの上限は8クレジット/分。バッチリクエストは「シンボル数 = クレジット数」を
// 消費するため、8ペアずつに分割し、1分以上あけて順に取得する。
const CHUNK_SIZE = 8;
const CHUNK_INTERVAL_MS = 61 * 1000;

const API_KEY = process.env.EXPO_PUBLIC_TWELVEDATA_API_KEY;

type TwelveDataSeries = {
  status: 'ok' | 'error';
  message?: string;
  values?: { datetime: string; close: string }[];
};

export type PairRef = { id: string; base: string; quote: string };

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

function toFetchError(status: number): Error {
  if (status === 429) {
    return new Error('APIの利用上限に達しました。1分ほど待ってから再読み込みしてください。');
  }
  return new Error(`為替レートの取得に失敗しました (HTTP ${status})`);
}

type CacheEntry = { fetchedAt: number; data: PricePoint[] };
const historyCache = new Map<string, CacheEntry>();

function cacheKeyFor(symbol: string, outputSize: number): string {
  return `${symbol}:${outputSize}`;
}

function readCache(symbol: string, outputSize: number): PricePoint[] | null {
  const cached = historyCache.get(cacheKeyFor(symbol, outputSize));
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }
  return null;
}

function buildUrl(symbols: string[], outputSize: number): string {
  return (
    `${API_BASE}/time_series?symbol=${encodeURIComponent(symbols.join(','))}` +
    `&interval=${INTERVAL}&outputsize=${outputSize}&apikey=${API_KEY}`
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 1チャンク(最大8ペア)をまとめて取得する。
async function fetchChunk(
  pairs: PairRef[],
  outputSize: number
): Promise<Record<string, PricePoint[]>> {
  const symbols = pairs.map((pair) => toSymbol(pair.base, pair.quote));
  const response = await fetch(buildUrl(symbols, outputSize));
  if (!response.ok) {
    throw toFetchError(response.status);
  }
  const json = await response.json();

  const result: Record<string, PricePoint[]> = {};
  pairs.forEach((pair) => {
    const symbol = toSymbol(pair.base, pair.quote);
    // 単一シンボルのみの場合はキー無しでフラットに返ってくるため両対応する。
    const series: TwelveDataSeries | undefined = pairs.length === 1 ? json : json[symbol];
    const points = toPricePoints(series);
    historyCache.set(cacheKeyFor(symbol, outputSize), {
      fetchedAt: Date.now(),
      data: points,
    });
    result[pair.id] = points;
  });
  return result;
}

/**
 * 複数通貨ペアを取得する。無料プランのレート制限に合わせて8ペアずつ順に取得し、
 * チャンクが届くたびに onChunk で通知するため、UIは段階的に表示を埋められる。
 */
export async function fetchHistories(
  pairs: PairRef[],
  dayRange: number,
  onChunk?: (histories: Record<string, PricePoint[]>) => void
): Promise<Record<string, PricePoint[]>> {
  assertApiKey();
  if (pairs.length === 0) return {};

  const outputSize = toOutputSize(dayRange);
  const result: Record<string, PricePoint[]> = {};

  // キャッシュ済みのものは即座に返し、APIコールの対象から外す。
  const pending: PairRef[] = [];
  pairs.forEach((pair) => {
    const cached = readCache(toSymbol(pair.base, pair.quote), outputSize);
    if (cached) {
      result[pair.id] = cached;
    } else {
      pending.push(pair);
    }
  });
  if (Object.keys(result).length > 0) {
    onChunk?.({ ...result });
  }

  for (let i = 0; i < pending.length; i += CHUNK_SIZE) {
    if (i > 0) {
      await delay(CHUNK_INTERVAL_MS);
    }
    const chunk = await fetchChunk(pending.slice(i, i + CHUNK_SIZE), outputSize);
    Object.assign(result, chunk);
    onChunk?.({ ...result });
  }

  return result;
}

export async function fetchHistory(
  base: string,
  quote: string,
  dayRange: number
): Promise<PricePoint[]> {
  assertApiKey();

  const outputSize = toOutputSize(dayRange);
  const symbol = toSymbol(base, quote);
  const cached = readCache(symbol, outputSize);
  if (cached) return cached;

  const response = await fetch(buildUrl([symbol], outputSize));
  if (!response.ok) {
    throw toFetchError(response.status);
  }
  const json: TwelveDataSeries = await response.json();

  if (json.status !== 'ok') {
    throw new Error(json.message ?? `${base}/${quote} のデータがありません。`);
  }

  const points = toPricePoints(json);
  historyCache.set(cacheKeyFor(symbol, outputSize), { fetchedAt: Date.now(), data: points });
  return points;
}
