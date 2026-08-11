import { PricePoint } from '../types';
import { LivePrice, toGmoSymbol } from './gmo';

/**
 * GitHub Actions が定期取得してサイト内に置いたレートを読む。
 *
 * ブラウザからGMOへ直接アクセスするとCORSで遮断されるため、その場合の代替経路。
 * 同一オリジンの静的ファイルなのでCORSの制約を受けない。
 * ただし更新はワークフローの実行間隔(15分ごと、GitHubの都合で数分遅れる)に律速される。
 */

type PublishedTicker = {
  fetchedAt: string;
  status: number;
  data?: { symbol: string; ask: string; bid: string; timestamp: string; status: string }[];
};

type PublishedCandles = {
  fetchedAt: string;
  candles?: Record<string, { t: number; c: string }[]>;
};

/** 配信元のベースURLから静的データの位置を解決する。 */
function dataUrl(file: string): string {
  try {
    if (typeof document !== 'undefined' && document.baseURI) {
      return new URL(`data/${file}`, document.baseURI).toString();
    }
  } catch {
    // baseURI が使えない環境では相対パスにフォールバックする
  }
  return `data/${file}`;
}

async function getJson<T>(file: string): Promise<T> {
  const response = await fetch(dataUrl(file), { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`公開データを取得できません (HTTP ${response.status})`);
  }
  return response.json();
}

export type PublishedAge = { fetchedAt: string; minutesOld: number };

function ageOf(fetchedAt: string): PublishedAge {
  const ms = Date.now() - Date.parse(fetchedAt);
  return { fetchedAt, minutesOld: Math.max(0, Math.round(ms / 60000)) };
}

export async function fetchPublishedPrices(
  pairs: { id: string; base: string; quote: string }[]
): Promise<{ prices: Record<string, LivePrice>; age: PublishedAge }> {
  const json = await getJson<PublishedTicker>('ticker.json');
  const bySymbol = new Map((json.data ?? []).map((row) => [row.symbol, row]));

  const prices: Record<string, LivePrice> = {};
  pairs.forEach((pair) => {
    const row = bySymbol.get(toGmoSymbol(pair.base, pair.quote));
    if (!row) return;
    const bid = parseFloat(row.bid);
    const ask = parseFloat(row.ask);
    if (!Number.isFinite(bid) || !Number.isFinite(ask)) return;
    prices[pair.id] = {
      bid,
      ask,
      mid: (bid + ask) / 2,
      time: row.timestamp,
      tradeable: row.status === 'OPEN',
    };
  });

  return { prices, age: ageOf(json.fetchedAt) };
}

export async function fetchPublishedHistories(
  pairs: { id: string; base: string; quote: string }[]
): Promise<Record<string, PricePoint[]>> {
  const json = await getJson<PublishedCandles>('candles.json');

  const result: Record<string, PricePoint[]> = {};
  pairs.forEach((pair) => {
    const rows = json.candles?.[toGmoSymbol(pair.base, pair.quote)] ?? [];
    result[pair.id] = rows
      .map((row) => ({ date: new Date(row.t).toISOString(), rate: parseFloat(row.c) }))
      .filter((point) => Number.isFinite(point.rate));
  });
  return result;
}
