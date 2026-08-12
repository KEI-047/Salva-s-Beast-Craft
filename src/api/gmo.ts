import { PricePoint, Timeframe } from '../types';

/**
 * GMOコイン「外国為替FX」の Public API。
 * 認証が不要なため、APIキーもトークンも持たずに動作する。
 *
 * ブラウザから直接呼べない(CORS未対応の)場合に備え、
 * EXPO_PUBLIC_GMO_PROXY_URL を設定すると中継サーバ経由に切り替わる。
 * この中継は秘密情報を一切持たないため、漏洩の概念がない。
 */
const DIRECT_BASE = 'https://forex-api.coin.z.com/public/v1';

export const GMO_PROXY_URL = process.env.EXPO_PUBLIC_GMO_PROXY_URL;

function base(): string {
  return GMO_PROXY_URL ? GMO_PROXY_URL.replace(/\/$/, '') : DIRECT_BASE;
}

/** GMOが取り扱う10通貨ペア(2026年時点)。 */
export const GMO_SYMBOLS = new Set([
  'USD_JPY', 'EUR_JPY', 'GBP_JPY', 'AUD_JPY', 'NZD_JPY',
  'CAD_JPY', 'CHF_JPY', 'EUR_USD', 'GBP_USD', 'AUD_USD',
]);

/** チャートとシグナルはBID(売値)で統一する。 */
const PRICE_TYPE = 'BID';

/** 既定の足種。v2ではマルチタイムフレームのため呼び出し側から指定できる。 */
export const DEFAULT_INTERVAL: Timeframe = '15min';

/** 足種ごとの1日あたりの本数(24時間 ÷ 足の長さ)。 */
const BARS_PER_DAY: Record<Timeframe, number> = {
  '1min': 1440,
  '5min': 288,
  '15min': 96,
  '30min': 48,
  '1hour': 24,
};

export type PairRef = { id: string; base: string; quote: string };

/**
 * ブラウザからGMOのAPIに到達できない場合のエラー。
 * CORS で遮断されると fetch は HTTP ステータスではなく TypeError で失敗するため、
 * それを手がかりに「中継サーバが必要な状態」だと判別する。
 */
export class GmoUnreachableError extends Error {
  constructor() {
    super(
      GMO_PROXY_URL
        ? '中継サーバに接続できません。EXPO_PUBLIC_GMO_PROXY_URL の値をご確認ください。'
        : 'ブラウザからGMOのAPIに直接接続できません(CORS制限)。gmo-proxy/ の中継サーバをデプロイし、EXPO_PUBLIC_GMO_PROXY_URL に設定してください。'
    );
    this.name = 'GmoUnreachableError';
  }
}

/** fetch のネットワーク失敗(CORSを含む)を専用エラーに変換する。 */
async function request(url: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    // CORS 遮断・名前解決失敗・オフラインはいずれもここに来る
    throw new GmoUnreachableError();
  }
  return response;
}

export function toGmoSymbol(base: string, quote: string): string {
  return `${base}_${quote}`;
}

type KlineRow = { openTime: string; open: string; high: string; low: string; close: string };
type KlineResponse = { status: number; data?: KlineRow[]; messages?: { message_string?: string }[] };

type TickerRow = {
  symbol: string;
  ask: string;
  bid: string;
  timestamp: string;
  status: string;
};
type TickerResponse = { status: number; data?: TickerRow[] };

export type LivePrice = {
  bid: number;
  ask: number;
  mid: number;
  time: string;
  tradeable: boolean;
};

/** YYYYMMDD 形式(GMOのklinesが要求する日付指定) */
function toDateParam(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * 直近から遡った日付を新しい順に返す。
 * 為替は土日に休場するため、要求日数より多めに候補を用意する。
 * 実際には必要な本数が揃った時点で取得を打ち切る。
 */
function recentDates(dayRange: number): string[] {
  const dates: string[] = [];
  const cursor = new Date();
  for (let i = 0; i < dayRange + 4; i++) {
    dates.push(toDateParam(cursor));
    cursor.setDate(cursor.getDate() - 1);
  }
  return dates; // 新しい順
}

/** 同時に投げるリクエスト数の上限(GMOのレート制限は非公開のため保守的に抑える) */
const MAX_CONCURRENCY = 4;

async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function fetchKlinesForDate(
  symbol: string,
  date: string,
  interval: Timeframe
): Promise<PricePoint[]> {
  const url =
    `${base()}/klines?symbol=${encodeURIComponent(symbol)}` +
    `&priceType=${PRICE_TYPE}&interval=${interval}&date=${date}`;

  const response = await request(url);
  if (!response.ok) {
    throw new Error(`為替レートの取得に失敗しました (HTTP ${response.status})`);
  }
  const json: KlineResponse = await response.json();
  // status 0 が正常。休場日などはデータ無しで返る。
  if (json.status !== 0 || !json.data) return [];

  // klines は open/high/low/close を全部返している。終値だけ拾って捨てていたため
  // ATR / ADX が計算できなかった。追加のリクエストなしで高値・安値が手に入る。
  return json.data
    .map((row) => {
      const close = parseFloat(row.close);
      return {
        date: new Date(Number(row.openTime)).toISOString(),
        rate: close,
        open: parseFloat(row.open),
        high: parseFloat(row.high),
        low: parseFloat(row.low),
        close,
      };
    })
    .filter(
      (point) =>
        Number.isFinite(point.rate) &&
        Number.isFinite(point.high) &&
        Number.isFinite(point.low) &&
        !Number.isNaN(Date.parse(point.date))
    );
}

/** 1通貨ペアの15分足を、指定日数ぶん取得して時系列に連結する。 */
export async function fetchGmoHistory(
  base_: string,
  quote: string,
  dayRange: number,
  interval: Timeframe = DEFAULT_INTERVAL
): Promise<PricePoint[]> {
  const symbol = toGmoSymbol(base_, quote);
  if (!GMO_SYMBOLS.has(symbol)) {
    throw new Error(`${base_}/${quote} はGMOコインの取扱対象外です。`);
  }

  const wanted = dayRange * BARS_PER_DAY[interval];
  const merged: PricePoint[] = [];

  // 新しい日から順に取得し、必要な本数が揃った時点で打ち切る。
  // 平日なら候補を全部舐めずに済むので、リクエスト数を抑えられる。
  for (const date of recentDates(dayRange)) {
    // 特定日の失敗(休場日など)は無視してよいが、到達不可は原因を伝える必要がある。
    const points = await fetchKlinesForDate(symbol, date, interval).catch((err) => {
      if (err instanceof GmoUnreachableError) throw err;
      return [] as PricePoint[];
    });
    merged.push(...points);
    if (merged.length >= wanted) break;
  }

  if (merged.length === 0) {
    throw new Error(`${base_}/${quote} のデータが取得できませんでした。`);
  }

  // 日付をまたいだ重複を除き、時系列順に整える。
  const seen = new Set<string>();
  const ordered = merged
    .filter((point) => {
      if (seen.has(point.date)) return false;
      seen.add(point.date);
      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  return ordered.slice(-wanted);
}

/** 複数ペアをまとめて取得する。GMOは銘柄ごとの取得なので並列に投げる。 */
export async function fetchGmoHistories(
  pairs: PairRef[],
  dayRange: number,
  interval: Timeframe = DEFAULT_INTERVAL
): Promise<Record<string, PricePoint[]>> {
  let unreachable: GmoUnreachableError | null = null;
  const entries = await mapWithLimit(pairs, MAX_CONCURRENCY, async (pair) => {
    try {
      return [
        pair.id,
        await fetchGmoHistory(pair.base, pair.quote, dayRange, interval),
      ] as const;
    } catch (err) {
      if (err instanceof GmoUnreachableError) unreachable = err;
      return [pair.id, [] as PricePoint[]] as const;
    }
  });
  // 全ペアが到達不可なら、原因が分かるエラーとして投げ直す。
  if (unreachable && entries.every(([, points]) => points.length === 0)) {
    throw unreachable;
  }
  return Object.fromEntries(entries);
}

/**
 * 現在値を取得する。tickerは全銘柄を1リクエストで返すため、
 * 何ペア監視していても呼び出しは1回で済む。
 */
export async function fetchGmoPrices(
  pairs: PairRef[]
): Promise<Record<string, LivePrice>> {
  if (pairs.length === 0) return {};

  const response = await request(`${base()}/ticker`);
  if (!response.ok) {
    throw new Error(`現在値の取得に失敗しました (HTTP ${response.status})`);
  }
  const json: TickerResponse = await response.json();
  if (json.status !== 0 || !json.data) return {};

  const bySymbol = new Map(json.data.map((row) => [row.symbol, row]));

  const result: Record<string, LivePrice> = {};
  pairs.forEach((pair) => {
    const row = bySymbol.get(toGmoSymbol(pair.base, pair.quote));
    if (!row) return;
    const bid = parseFloat(row.bid);
    const ask = parseFloat(row.ask);
    if (!Number.isFinite(bid) || !Number.isFinite(ask)) return;
    result[pair.id] = {
      bid,
      ask,
      mid: (bid + ask) / 2,
      time: row.timestamp,
      // 休場中は status が OPEN 以外になる
      tradeable: row.status === 'OPEN',
    };
  });
  return result;
}
