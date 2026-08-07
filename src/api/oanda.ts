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

type ProxyCandle = { time: string; close: string };

type ProxyCandles = {
  status: 'ok' | 'error';
  message?: string;
  candles?: ProxyCandle[];
  /** 形成中(未確定)の足。includeForming=1 のときだけ入る */
  forming?: ProxyCandle | null;
};

export type LivePrice = {
  bid: number;
  ask: number;
  mid: number;
  time: string;
  tradeable: boolean;
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

function proxyBase(): string {
  if (!OANDA_PROXY_URL) {
    throw new Error('OANDAプロキシのURLが未設定です。');
  }
  return OANDA_PROXY_URL.replace(/\/$/, '');
}

/**
 * 現在値(bid/ask)を取得する。数秒おきに呼んでチャートと価格を動かす用途。
 * 発注はできない読み取り専用エンドポイント。
 */
export async function fetchOandaPrices(
  pairs: { id: string; base: string; quote: string }[]
): Promise<Record<string, LivePrice>> {
  if (pairs.length === 0) return {};

  const instruments = pairs.map((pair) => toOandaInstrument(pair.base, pair.quote));
  const url = `${proxyBase()}/pricing?instruments=${encodeURIComponent(instruments.join(','))}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`現在値の取得に失敗しました (HTTP ${response.status})`);
  }
  const json: Record<string, {
    bid: string; ask: string; mid: string; time: string; tradeable: boolean;
  }> = await response.json();

  const result: Record<string, LivePrice> = {};
  pairs.forEach((pair) => {
    const raw = json[toOandaInstrument(pair.base, pair.quote)];
    if (!raw) return;
    const bid = parseFloat(raw.bid);
    const ask = parseFloat(raw.ask);
    const mid = parseFloat(raw.mid);
    if (![bid, ask, mid].every(Number.isFinite)) return;
    result[pair.id] = { bid, ask, mid, time: raw.time, tradeable: raw.tradeable };
  });
  return result;
}

/** 確定足に加えて、形成中の足も取得する(チャート表示用)。 */
export async function fetchOandaCandlesWithForming(
  pair: { id: string; base: string; quote: string },
  count: number
): Promise<{ history: PricePoint[]; forming: PricePoint | null }> {
  const instrument = toOandaInstrument(pair.base, pair.quote);
  const url =
    `${proxyBase()}/candles?instruments=${encodeURIComponent(instrument)}` +
    `&granularity=M15&count=${count}&includeForming=1`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`為替レートの取得に失敗しました (HTTP ${response.status})`);
  }
  const json: Record<string, ProxyCandles> = await response.json();
  const entry = json[instrument];

  const forming = entry?.forming
    ? { date: entry.forming.time, rate: parseFloat(entry.forming.close) }
    : null;

  return {
    history: toPricePoints(entry),
    forming: forming && Number.isFinite(forming.rate) ? forming : null,
  };
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
