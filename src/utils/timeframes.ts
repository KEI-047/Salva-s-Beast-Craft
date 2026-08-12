import { PricePoint, Timeframe } from '../types';
import { Candle } from './indicators';

/**
 * マルチタイムフレームの定義。
 *
 * 仕様の役割分担:
 *   4時間 / 1時間 → 相場環境(どちらへ傾いているか)
 *   15分          → 方向
 *   5分           → セットアップ
 *   1分           → トリガー
 *
 * 上位足はあくまで環境認識で、エントリーの直接トリガーには使わない。
 */

/** 足の長さ(分) */
export const TIMEFRAME_MINUTES: Record<Timeframe, number> = {
  '1min': 1,
  '5min': 5,
  '15min': 15,
  '30min': 30,
  '1hour': 60,
};

export const TIMEFRAME_LABEL: Record<Timeframe, string> = {
  '1min': '1分',
  '5min': '5分',
  '15min': '15分',
  '30min': '30分',
  '1hour': '1時間',
};

/** 合成して作る足。GMOのAPIは1時間足までしか返さない。 */
export type CompositeTimeframe = '4hour' | '1day';

export const COMPOSITE_LABEL: Record<CompositeTimeframe, string> = {
  '4hour': '4時間',
  '1day': '1日',
};

/** 合成足を作るのに必要な1時間足の本数 */
const COMPOSITE_SOURCE: Record<CompositeTimeframe, number> = {
  '4hour': 4,
  '1day': 24,
};

/** アプリが役割として使う足の並び(上位足→下位足) */
export const ROLE_ORDER = [
  { key: '4hour' as const, label: '4時間', role: '相場環境' },
  { key: '1hour' as const, label: '1時間', role: '相場環境' },
  { key: '15min' as const, label: '15分', role: '方向' },
  { key: '5min' as const, label: '5分', role: 'セットアップ' },
  { key: '1min' as const, label: '1分', role: 'トリガー' },
];

/**
 * ローソク足を Candle 配列に変換する。
 * OHLC が無い古いキャッシュや静的フォールバックのデータでも壊れないよう、
 * 欠けている場合は終値で埋める(値幅0の足として扱う)。
 */
export function toCandles(points: PricePoint[]): Candle[] {
  return points.map((point) => ({
    high: point.high ?? point.rate,
    low: point.low ?? point.rate,
    close: point.close ?? point.rate,
  }));
}

/** OHLC を持っているデータか。ATR / ADX はこれが true でないと意味を持たない。 */
export function hasOhlc(points: PricePoint[]): boolean {
  return points.length > 0 && points.every((point) => point.high !== undefined);
}

/**
 * 短い足を束ねて長い足を作る。
 *
 * GMOのAPIは1時間足までしか返さないので4時間足・日足は合成が要る。
 * 一覧のように多数のペアを見る画面では、15分足だけ取って1時間足・4時間足を
 * 合成することでリクエスト数を大きく減らせる。
 *
 * 境界は「先頭から n 本ずつ」ではなく時刻で切る。そうしないと取得開始時刻によって
 * 足の区切りがずれて、同じ相場でも実行するたびに違う結果になってしまう。
 */
export function composeBars(points: PricePoint[], targetMinutes: number): PricePoint[] {
  if (points.length === 0 || targetMinutes <= 0) return [];
  const spanMs = targetMinutes * 60_000;

  const buckets = new Map<number, PricePoint[]>();
  points.forEach((point) => {
    const time = Date.parse(point.date);
    if (Number.isNaN(time)) return;
    const bucket = Math.floor(time / spanMs) * spanMs;
    const list = buckets.get(bucket);
    if (list) list.push(point);
    else buckets.set(bucket, [point]);
  });

  return Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([bucket, group]) => {
      const highs = group.map((p) => p.high ?? p.rate);
      const lows = group.map((p) => p.low ?? p.rate);
      const close = group[group.length - 1].close ?? group[group.length - 1].rate;
      return {
        date: new Date(bucket).toISOString(),
        rate: close,
        open: group[0].open ?? group[0].rate,
        high: Math.max(...highs),
        low: Math.min(...lows),
        close,
      };
    });
}

export function composeFromHourly(
  hourly: PricePoint[],
  target: CompositeTimeframe
): PricePoint[] {
  return composeBars(hourly, COMPOSITE_SOURCE[target] * 60);
}

/** その足種の次の確定時刻(00:00 起点の区切り) */
export function nextCloseAt(timeframe: Timeframe, now: Date = new Date()): Date {
  const minutes = TIMEFRAME_MINUTES[timeframe];
  const next = new Date(now);
  next.setSeconds(0, 0);
  next.setMinutes(Math.floor(now.getMinutes() / minutes) * minutes + minutes);
  return next;
}

/** 1通貨あたりの最小変動幅。対円は0.01、それ以外は0.0001。 */
export function pipSize(rate: number): number {
  return rate >= 20 ? 0.01 : 0.0001;
}

export function toPips(priceDiff: number, rate: number): number {
  return priceDiff / pipSize(rate);
}
