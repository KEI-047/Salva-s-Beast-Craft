import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchHistories } from '../api/forex';
import { CURRENCY_PAIRS } from '../constants/pairs';
import { useAccount } from '../state/accountStore';
import { usePosition } from '../state/positionStore';
import { summarise, useTrades } from '../state/tradeHistoryStore';
import { PricePoint } from '../types';
import { evaluateDataHealth } from './dataHealth';
import { backtestSignals } from './statistics';
import { useStrategyMode } from './strategyStore';
import { activeHorizon, useTradeSettings } from './tradeSettings';
import { useLivePrices } from './useLivePrices';
import { evaluateEntry, spreadPercent } from './verdict';
import { buildPairStatus, globalStop, PairStatus, stoppedStatus } from './watchlistStatus';

/**
 * 全通貨ペアの「入っていいか」をまとめて出す。
 *
 * 通貨ペアの選択画面と一覧の両方で同じ判定を出すために、取得と計算をここに集約する。
 * 判定そのものは watchlistStatus.buildPairStatus を共有しているので、
 * どの画面から見ても結論は一致する。
 *
 * 5日ぶんの15分足だけを取り、1時間足・4時間足はそこから合成する。
 * 取得は forex.ts のキャッシュ(10分)に載るため、一覧を見た直後に選択画面を開いても
 * API は叩き直さない。
 */
const DAY_RANGE = 5;

export type PairStatuses = {
  statuses: Record<string, PairStatus>;
  loading: boolean;
  loadedCount: number;
  /** 口座側の停止理由。null なら止まっていない */
  stopReason: string | null;
  candidateCount: number;
};

export function usePairStatuses(enabled = true): PairStatuses {
  const strategyMode = useStrategyMode();
  const tradeSettings = useTradeSettings();
  const horizon = activeHorizon(tradeSettings);
  const account = useAccount();
  const positionState = usePosition();
  const trades = useTrades();
  const daily = useMemo(() => summarise(trades), [trades]);

  const [histories, setHistories] = useState<Record<string, PricePoint[]>>({});
  const [loading, setLoading] = useState(false);
  // 開くたびに取り直さないよう、一度読み込んだかを覚えておく。
  const loadedRef = useRef(false);

  const { prices, staleMinutes } = useLivePrices(CURRENCY_PAIRS, enabled);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await fetchHistories(CURRENCY_PAIRS, DAY_RANGE, (chunk) => {
        // 届いたぶんから表示できるよう、チャンクごとに反映する。
        setHistories((prev) => ({ ...prev, ...chunk }));
      });
    } catch {
      // 取得できなかったペアは判定なしのままにする(下でデータ確認中になる)
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled || loadedRef.current) return;
    loadedRef.current = true;
    load();
  }, [enabled, load]);

  const stopReason = useMemo(
    () => globalStop(account, daily, positionState),
    [account, daily, positionState]
  );

  const statuses = useMemo(() => {
    const result: Record<string, PairStatus> = {};
    if (stopReason) {
      // 止まっている時に候補を並べると誤操作を招くので、全ペアを止める。
      CURRENCY_PAIRS.forEach((pair) => {
        result[pair.id] = stoppedStatus(stopReason);
      });
      return result;
    }
    Object.entries(histories).forEach(([pairId, bars]) => {
      const price = prices[pairId];
      const cost = price ? spreadPercent(price.bid, price.ask) : null;
      const verdict = evaluateEntry(
        backtestSignals(bars, strategyMode, horizon),
        tradeSettings,
        cost
      );
      const health = evaluateDataHealth({
        lastPriceAt: price?.time ?? null,
        price: price?.mid ?? null,
        bid: price?.bid ?? null,
        ask: price?.ask ?? null,
        bars,
        usingFallback: staleMinutes !== null,
        tradeable: price?.tradeable ?? true,
      });
      result[pairId] = buildPairStatus({
        fifteen: bars,
        mode: strategyMode,
        minScore: 2,
        edgeOk: verdict.level !== 'no',
        edgeDetail:
          verdict.level === 'no' ? verdict.reason : '過去成績が損益分岐を上回っています',
        dataIssue: health.reason,
      });
    });
    return result;
  }, [histories, prices, staleMinutes, strategyMode, horizon, tradeSettings, stopReason]);

  return {
    statuses,
    loading,
    loadedCount: Object.keys(histories).length,
    stopReason,
    candidateCount: Object.values(statuses).filter((s) => s.level === 'candidate').length,
  };
}
