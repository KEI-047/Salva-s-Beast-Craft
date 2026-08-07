import { PricePoint } from '../types';

/**
 * 自前のOANDAプロキシ(oanda-proxy/)経由でローソク足を取得する。
 * ブラウザはトークンを一切持たず、プロキシのURLだけを知っている。
 */
export const OANDA_PROXY_URL = process.env.EXPO_PUBLIC_OANDA_PROXY_URL;

/** OANDAプロキシを使う設定になっているか */
export function isOandaEnabled(): boolean {
  return Boolean(OANDA_PROXY_URL);
}

type ProxyCandles = {
  status: 'ok' | 'error';
  message?: string;
  candles?: { time: string; close: string }[];
};

/** USD, JPY -> USD_JPY (OANDAの表記) */
export function toOandaInstrument(base: string, quote: string): string {
  return `${base}_${quote}`;
}

function toPricePoints(entry: ProxyCandles | undefined): PricePoint[] {
  if (!entry || entry.status !== 'ok' || !entry.candles) return [];
  // プロキシ側で未確定の足を除外し、時系列順で返している。
  return entry.candles
    .map((candle) => ({ date: candle.time, rate: parseFloat(candle.close) }))
    .filter((point) => Number.isFinite(point.rate));
}

/**
 * 複数ペアをまとめて取得する。
 * OANDAのレート制限は120リクエスト/秒と緩いため、分割や待機は不要。
 */
export async function fetchOandaCandles(
  pairs: { id: string; base: string; quote: string }[],
  count: number
): Promise<Record<string, PricePoint[]>> {
  if (!OANDA_PROXY_URL) {
    throw new Error('OANDAプロキシのURLが未設定です。');
  }
  if (pairs.length === 0) return {};

  const instruments = pairs.map((pair) => toOandaInstrument(pair.base, pair.quote));
  const url =
    `${OANDA_PROXY_URL.replace(/\/$/, '')}/candles` +
    `?instruments=${encodeURIComponent(instruments.join(','))}` +
    `&granularity=M15&count=${count}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`為替レートの取得に失敗しました (HTTP ${response.status})`);
  }
  const json: Record<string, ProxyCandles> = await response.json();

  const result: Record<string, PricePoint[]> = {};
  pairs.forEach((pair) => {
    result[pair.id] = toPricePoints(json[toOandaInstrument(pair.base, pair.quote)]);
  });
  return result;
}
