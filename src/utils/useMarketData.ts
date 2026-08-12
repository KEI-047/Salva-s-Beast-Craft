import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchHistory } from '../api/forex';
import { CurrencyPair, PricePoint, Timeframe } from '../types';
import { buildMarketContext, MarketContext } from './marketContext';
import { backtestSignals } from './statistics';
import { useStrategyMode } from './strategyStore';
import { composeFromHourly, nextCloseAt, TIMEFRAME_MINUTES } from './timeframes';
import { evaluateEntry } from './verdict';
import { useTradeSettings } from './tradeSettings';

/**
 * ホーム画面で使うマルチタイムフレームのデータをまとめて取る。
 *
 * 足種ごとに必要な日数が違う(1分足は1日で1440本、1時間足は5日でも120本)。
 * 取り過ぎるとリクエストが増えるだけなので、判定に足りる最小限にしている。
 * 取得結果は forex.ts のキャッシュ(10分)に載るため、再描画では叩き直さない。
 */
const FRAME_PLAN: { timeframe: Timeframe; days: number }[] = [
  { timeframe: '1min', days: 1 },
  { timeframe: '5min', days: 1 },
  { timeframe: '15min', days: 3 },
  // 4時間足を合成するために1時間足を多めに取る
  { timeframe: '1hour', days: 10 },
];

/** 足が確定するたびに再取得する。時計から毎回待ち時間を計算し直す。 */
function useTimeframeTick(timeframe: Timeframe, onClose: () => void, enabled: boolean) {
  const callback = useRef(onClose);
  callback.current = onClose;

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    const schedule = () => {
      // 足の確定直後は値が揺れることがあるので数秒待つ
      const wait = nextCloseAt(timeframe).getTime() - Date.now() + 5000;
      timer = setTimeout(() => {
        if (cancelled) return;
        callback.current();
        schedule();
      }, Math.max(1000, wait));
    };
    schedule();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [timeframe, enabled]);
}

export type MarketData = {
  bars: Record<Timeframe, PricePoint[]>;
  fourHour: PricePoint[];
  context: MarketContext | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
};

export function useMarketData(pair: CurrencyPair | null): MarketData {
  const strategyMode = useStrategyMode();
  const { horizonBars } = useTradeSettings();
  const [bars, setBars] = useState<Record<Timeframe, PricePoint[]>>({
    '1min': [],
    '5min': [],
    '15min': [],
    '30min': [],
    '1hour': [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (force = false, only?: Timeframe) => {
      if (!pair) return;
      const plan = only ? FRAME_PLAN.filter((p) => p.timeframe === only) : FRAME_PLAN;
      if (!only) setLoading(true);
      try {
        const results = await Promise.all(
          plan.map(async (entry) => {
            const points = await fetchHistory(
              pair.base,
              pair.quote,
              entry.days,
              force,
              entry.timeframe
            );
            return [entry.timeframe, points] as const;
          })
        );
        setBars((prev) => {
          const next = { ...prev };
          results.forEach(([timeframe, points]) => {
            next[timeframe] = points;
          });
          return next;
        });
        setError(null);
      } catch (err) {
        // 自動更新の失敗では表示中のデータを維持する。初回だけエラーを出す。
        setError((prev) => (only ? prev : err instanceof Error ? err.message : '取得エラー'));
      } finally {
        if (!only) setLoading(false);
      }
    },
    [pair]
  );

  useEffect(() => {
    load();
  }, [load]);

  // 足種ごとに、その足が確定したタイミングで取り直す。
  useTimeframeTick('1min', () => load(true, '1min'), Boolean(pair));
  useTimeframeTick('5min', () => load(true, '5min'), Boolean(pair));
  useTimeframeTick('15min', () => load(true, '15min'), Boolean(pair));
  useTimeframeTick('1hour', () => load(true, '1hour'), Boolean(pair));

  const fourHour = useMemo(() => composeFromHourly(bars['1hour'], '4hour'), [bars]);

  const context = useMemo(() => {
    if (bars['15min'].length < 60) return null;

    // 既存の統計判定をそのまま5条件目に使う。作り直さない。
    const backtest = backtestSignals(bars['15min'], strategyMode, horizonBars);
    const verdict = evaluateEntry(
      backtest,
      { tradeType: 'fx', payout: 1.85, horizonBars },
      null
    );

    return buildMarketContext({
      bars: {
        fourHour,
        hourly: bars['1hour'],
        fifteen: bars['15min'],
        five: bars['5min'],
        minute: bars['1min'],
      },
      mode: strategyMode,
      minScore: 2,
      edgeOk: verdict.level !== 'no',
      edgeDetail:
        verdict.level === 'no'
          ? verdict.reason
          : '過去成績が損益分岐を上回っています',
    });
  }, [bars, fourHour, strategyMode, horizonBars]);

  return {
    bars,
    fourHour,
    context,
    loading,
    error,
    reload: () => load(true),
  };
}

export { TIMEFRAME_MINUTES };
