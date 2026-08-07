import { PricePoint } from '../types';

const API_BASE = 'https://api.twelvedata.com';
const INTERVAL = '15min';
const BARS_PER_DAY = 96; // 24h * 4 (15分足)
// 15分足なので、10分キャッシュしても表示の鮮度は十分保てる。
// ブラウザのlocalStorageにも保存するため、リロードしてもAPIを再度叩かない。
const CACHE_TTL_MS = 10 * 60 * 1000;
// 無料プランの上限は8クレジット/分。バッチリクエストは「シンボル数 = クレジット数」を
// 消費する。詳細画面ぶんの余裕を残すため、上限ちょうどではなく6ペアずつに分けて取得する。
const CHUNK_SIZE = 6;
const CHUNK_INTERVAL_MS = 65 * 1000;
const RATE_LIMIT_RETRIES = 3;

const API_KEY = process.env.EXPO_PUBLIC_TWELVEDATA_API_KEY;

type TwelveDataSeries = {
  status: 'ok' | 'error';
  message?: string;
  values?: { datetime: string; close: string }[];
};

export type PairRef = { id: string; base: string; quote: string };

export class RateLimitError extends Error {
  constructor() {
    super('APIの利用上限に達しました。1分ほど待ってから再読み込みしてください。');
    this.name = 'RateLimitError';
  }
}

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

/* ------------------------------- キャッシュ ------------------------------- */

type CacheEntry = { fetchedAt: number; data: PricePoint[] };

const memoryCache = new Map<string, CacheEntry>();
const STORAGE_PREFIX = 'hayabusa-fx:';

// Web版のみ localStorage を使う(ネイティブでは undefined なのでメモリのみで動作)。
function persistentStore(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // プライベートモード等でアクセスが拒否される場合
  }
}

function cacheKeyFor(symbol: string, outputSize: number): string {
  return `${symbol}:${outputSize}`;
}

function readCache(symbol: string, outputSize: number): PricePoint[] | null {
  const key = cacheKeyFor(symbol, outputSize);
  const fresh = (entry: CacheEntry) => Date.now() - entry.fetchedAt < CACHE_TTL_MS;

  const inMemory = memoryCache.get(key);
  if (inMemory && fresh(inMemory)) return inMemory.data;

  const store = persistentStore();
  if (!store) return null;
  try {
    const raw = store.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const entry: CacheEntry = JSON.parse(raw);
    if (!fresh(entry)) {
      store.removeItem(STORAGE_PREFIX + key);
      return null;
    }
    memoryCache.set(key, entry);
    return entry.data;
  } catch {
    return null; // 壊れたキャッシュは無視して再取得させる
  }
}

function writeCache(symbol: string, outputSize: number, data: PricePoint[]) {
  const key = cacheKeyFor(symbol, outputSize);
  const entry: CacheEntry = { fetchedAt: Date.now(), data };
  memoryCache.set(key, entry);
  try {
    persistentStore()?.setItem(STORAGE_PREFIX + key, JSON.stringify(entry));
  } catch {
    // 容量超過などでの失敗はメモリキャッシュだけで続行する
  }
}

/* -------------------------------- 取得処理 -------------------------------- */

function buildUrl(symbols: string[], outputSize: number): string {
  return (
    `${API_BASE}/time_series?symbol=${encodeURIComponent(symbols.join(','))}` +
    `&interval=${INTERVAL}&outputsize=${outputSize}&apikey=${API_KEY}`
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestSeries(symbols: string[], outputSize: number): Promise<any> {
  const response = await fetch(buildUrl(symbols, outputSize));
  if (response.status === 429) {
    throw new RateLimitError();
  }
  if (!response.ok) {
    throw new Error(`為替レートの取得に失敗しました (HTTP ${response.status})`);
  }
  const json = await response.json();
  // Twelve Dataはレート制限をHTTP 200 + body側のcodeで返すことがある。
  if (json?.code === 429) {
    throw new RateLimitError();
  }
  return json;
}

// 1チャンクをまとめて取得する。レート制限に当たった場合は待って自動で再試行する。
async function fetchChunk(
  pairs: PairRef[],
  outputSize: number,
  onRateLimited?: () => void
): Promise<Record<string, PricePoint[]>> {
  const symbols = pairs.map((pair) => toSymbol(pair.base, pair.quote));

  let json: any;
  for (let attempt = 0; ; attempt++) {
    try {
      json = await requestSeries(symbols, outputSize);
      break;
    } catch (err) {
      if (err instanceof RateLimitError && attempt < RATE_LIMIT_RETRIES) {
        onRateLimited?.();
        await delay(CHUNK_INTERVAL_MS);
        continue;
      }
      throw err;
    }
  }

  const result: Record<string, PricePoint[]> = {};
  pairs.forEach((pair) => {
    const symbol = toSymbol(pair.base, pair.quote);
    // 単一シンボルのみの場合はキー無しでフラットに返ってくるため両対応する。
    const series: TwelveDataSeries | undefined = pairs.length === 1 ? json : json[symbol];
    const points = toPricePoints(series);
    writeCache(symbol, outputSize, points);
    result[pair.id] = points;
  });
  return result;
}

export type LoadProgress = { rateLimited: boolean };

/**
 * 複数通貨ペアを取得する。無料プランのレート制限に合わせて少数ずつ順に取得し、
 * チャンクが届くたびに onChunk で通知するため、UIは段階的に表示を埋められる。
 */
export async function fetchHistories(
  pairs: PairRef[],
  dayRange: number,
  onChunk?: (histories: Record<string, PricePoint[]>, progress: LoadProgress) => void
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
    onChunk?.({ ...result }, { rateLimited: false });
  }

  for (let i = 0; i < pending.length; i += CHUNK_SIZE) {
    if (i > 0) {
      await delay(CHUNK_INTERVAL_MS);
    }
    const chunk = await fetchChunk(pending.slice(i, i + CHUNK_SIZE), outputSize, () =>
      onChunk?.({ ...result }, { rateLimited: true })
    );
    Object.assign(result, chunk);
    onChunk?.({ ...result }, { rateLimited: false });
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

  const json = await requestSeries([symbol], outputSize);
  if (json.status !== 'ok') {
    throw new Error(json.message ?? `${base}/${quote} のデータがありません。`);
  }

  const points = toPricePoints(json);
  writeCache(symbol, outputSize, points);
  return points;
}
