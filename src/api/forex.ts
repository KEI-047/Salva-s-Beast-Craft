import { PricePoint, Timeframe } from '../types';
import {
  DEFAULT_INTERVAL,
  fetchGmoHistories,
  fetchGmoHistory,
  GmoUnreachableError,
} from './gmo';
import { fetchPublishedHistories } from './publishedData';
import { fetchOandaCandles, isOandaEnabled } from './oanda';

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

/**
 * データ取得元の優先順位:
 *   1. OANDA (EXPO_PUBLIC_OANDA_PROXY_URL が設定されている場合)
 *   2. Twelve Data (EXPO_PUBLIC_TWELVEDATA_API_KEY が設定され、かつ強制指定された場合)
 *   3. GMOコイン Public API (既定。認証不要のため設定は一切不要)
 */
const FORCE_TWELVEDATA = process.env.EXPO_PUBLIC_USE_TWELVEDATA === '1';

function useTwelveData(): boolean {
  return FORCE_TWELVEDATA && Boolean(API_KEY);
}

/** GMOのPublic APIを使う構成か(既定) */
export function isGmoEnabled(): boolean {
  return !isOandaEnabled() && !useTwelveData();
}

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
  // OANDA / GMO 構成では Twelve Data のキーを必要としない。
  if (isOandaEnabled() || isGmoEnabled()) return;
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

// 足種をキーに含めないと、同じ通貨ペアの1分足と15分足が同じ枠を奪い合う。
function cacheKeyFor(symbol: string, outputSize: number, interval: Timeframe): string {
  return `${symbol}:${interval}:${outputSize}`;
}

function readCache(
  symbol: string,
  outputSize: number,
  interval: Timeframe
): PricePoint[] | null {
  const key = cacheKeyFor(symbol, outputSize, interval);
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

function writeCache(
  symbol: string,
  outputSize: number,
  interval: Timeframe,
  data: PricePoint[]
) {
  const key = cacheKeyFor(symbol, outputSize, interval);
  const entry: CacheEntry = { fetchedAt: Date.now(), data };
  memoryCache.set(key, entry);
  try {
    persistentStore()?.setItem(STORAGE_PREFIX + key, JSON.stringify(entry));
  } catch {
    // 容量超過などでの失敗はメモリキャッシュだけで続行する
  }
}

/* --------------------------- 日次クレジット管理 --------------------------- */

/** 無料プランの1日あたりのクレジット上限 */
export const DAILY_CREDIT_LIMIT = 800;
/** 残りがこれを下回ったら自動更新を止め、手動操作ぶんを温存する */
export const CREDIT_RESERVE = 80;

const USAGE_KEY = STORAGE_PREFIX + 'daily-usage';

type Usage = { day: string; used: number };

// Twelve Data のクレジットは UTC 基準でリセットされる。
function currentDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function readUsage(): Usage {
  const today = currentDay();
  try {
    const raw = persistentStore()?.getItem(USAGE_KEY);
    if (raw) {
      const parsed: Usage = JSON.parse(raw);
      if (parsed.day === today) return parsed;
    }
  } catch {
    // 壊れていれば作り直す
  }
  return { day: today, used: 0 };
}

/** バッチリクエストは「シンボル数 = 消費クレジット数」なので、その数で加算する。 */
function recordUsage(credits: number) {
  const usage = readUsage();
  usage.used += credits;
  try {
    persistentStore()?.setItem(USAGE_KEY, JSON.stringify(usage));
  } catch {
    // 保存できなくても取得自体は継続する
  }
}

export function creditUsage(): { used: number; remaining: number; canAutoRefresh: boolean } {
  const used = readUsage().used;
  const remaining = Math.max(0, DAILY_CREDIT_LIMIT - used);
  return { used, remaining, canAutoRefresh: remaining > CREDIT_RESERVE };
}

/** 指定ペア数を自動更新してよいか(残クレジットに余裕があるか)を判定する。 */
export function canAffordAutoRefresh(pairCount: number): boolean {
  // GMO/OANDA構成には1日あたりの上限が無いため、常に自動更新してよい。
  if (isGmoEnabled() || isOandaEnabled()) return true;
  const { remaining } = creditUsage();
  return remaining - pairCount > CREDIT_RESERVE;
}

/** 日次クレジットの管理が必要な構成か(Twelve Dataのみ) */
export function hasDailyCreditLimit(): boolean {
  return !isGmoEnabled() && !isOandaEnabled();
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
  recordUsage(symbols.length);
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
    // 旧構成(Twelve Data)は15分足専用。足種を跨ぐことはない。
    writeCache(symbol, outputSize, DEFAULT_INTERVAL, points);
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
  onChunk?: (histories: Record<string, PricePoint[]>, progress: LoadProgress) => void,
  /** 足の確定直後など、キャッシュを無視して取り直したい場合に true */
  force = false,
  interval: Timeframe = DEFAULT_INTERVAL
): Promise<Record<string, PricePoint[]>> {
  assertApiKey();
  if (pairs.length === 0) return {};

  const outputSize = toOutputSize(dayRange);
  const result: Record<string, PricePoint[]> = {};

  // キャッシュ済みのものは即座に返し、APIコールの対象から外す。
  const pending: PairRef[] = [];
  pairs.forEach((pair) => {
    const cached = force
      ? null
      : readCache(toSymbol(pair.base, pair.quote), outputSize, interval);
    if (cached) {
      result[pair.id] = cached;
    } else {
      pending.push(pair);
    }
  });
  if (Object.keys(result).length > 0) {
    onChunk?.({ ...result }, { rateLimited: false });
  }

  if (isGmoEnabled()) {
    // GMOは認証不要・銘柄ごとの取得。分割や待機は不要。
    // ブラウザから直接届かない(CORS)場合は、GitHub Actions が公開した静的データに切り替える。
    const fetched = await fetchGmoHistories(pending, dayRange, interval).catch(async (err) => {
      if (err instanceof GmoUnreachableError) return fetchPublishedHistories(pending);
      throw err;
    });
    Object.entries(fetched).forEach(([pairId, points]) => {
      const pair = pending.find((p) => p.id === pairId);
      if (pair) writeCache(toSymbol(pair.base, pair.quote), outputSize, interval, points);
    });
    Object.assign(result, fetched);
    onChunk?.({ ...result }, { rateLimited: false });
    return result;
  }

  if (isOandaEnabled()) {
    // OANDAは 120リクエスト/秒 と制限が緩いため、分割せず一度に取得する。
    const fetched = await fetchOandaCandles(pending, outputSize);
    Object.entries(fetched).forEach(([pairId, points]) => {
      const pair = pending.find((p) => p.id === pairId);
      if (pair) writeCache(toSymbol(pair.base, pair.quote), outputSize, interval, points);
    });
    Object.assign(result, fetched);
    onChunk?.({ ...result }, { rateLimited: false });
    return result;
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
  dayRange: number,
  /** 足の確定直後など、キャッシュを無視して取り直したい場合に true */
  force = false,
  interval: Timeframe = DEFAULT_INTERVAL
): Promise<PricePoint[]> {
  assertApiKey();

  const outputSize = toOutputSize(dayRange);
  const symbol = toSymbol(base, quote);
  const cached = force ? null : readCache(symbol, outputSize, interval);
  if (cached) return cached;

  if (isGmoEnabled()) {
    const points = await fetchGmoHistory(base, quote, dayRange, interval).catch(async (err) => {
      if (err instanceof GmoUnreachableError) {
        const published = await fetchPublishedHistories([{ id: symbol, base, quote }]);
        return published[symbol] ?? [];
      }
      throw err;
    });
    writeCache(symbol, outputSize, interval, points);
    return points;
  }

  if (isOandaEnabled()) {
    const fetched = await fetchOandaCandles([{ id: symbol, base, quote }], outputSize);
    const points = fetched[symbol] ?? [];
    writeCache(symbol, outputSize, interval, points);
    return points;
  }

  const json = await requestSeries([symbol], outputSize);
  if (json.status !== 'ok') {
    throw new Error(json.message ?? `${base}/${quote} のデータがありません。`);
  }

  const points = toPricePoints(json);
  writeCache(symbol, outputSize, interval, points);
  return points;
}
