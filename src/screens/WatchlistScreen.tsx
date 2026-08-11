import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  SafeAreaView,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  canAffordAutoRefresh,
  creditUsage,
  DAILY_CREDIT_LIMIT,
  fetchHistories,
  hasDailyCreditLimit,
  LoadProgress,
} from '../api/forex';
import { NextBarCountdown } from '../components/NextBarCountdown';
import { PairListItem } from '../components/PairListItem';
import { StrategySelector } from '../components/StrategySelector';
import { CONTENT_MAX_WIDTH } from '../constants/layout';
import { CURRENCY_PAIRS } from '../constants/pairs';
import { RootStackParamList } from '../navigation/types';
import { CurrencyPair, PricePoint, SignalResult } from '../types';
import { buildSignal } from '../utils/signal';
import { Backtest, backtestSignals, DEFAULT_STATS_DAYS } from '../utils/statistics';
import { evaluateEntry, spreadPercent, Verdict } from '../utils/verdict';
import { activeHorizon, useTradeSettings } from '../utils/tradeSettings';
import { TradeTypeSelector } from '../components/TradeTypeSelector';
import { useStrategyMode } from '../utils/strategyStore';
import { useBarClose } from '../utils/useBarClose';
import { LIVE_POLL_MS, useLivePrices } from '../utils/useLivePrices';

// ウォッチリストでもエントリー判定を出すため、詳細画面の既定期間と同じ日数を取得する。
// ここが食い違うと、一覧と詳細で勝率・期待値が別の値になり判断がぶれる。
const HISTORY_DAY_RANGE = DEFAULT_STATS_DAYS;

const SECTIONS: { key: CurrencyPair['group']; title: string }[] = [
  { key: 'jpy', title: '対円通貨ペア' },
  { key: 'cross', title: 'クロス通貨ペア' },
];

type Props = NativeStackScreenProps<RootStackParamList, 'Watchlist'>;

export function WatchlistScreen({ navigation }: Props) {
  const strategyMode = useStrategyMode();
  const tradeSettings = useTradeSettings();
  const horizon = activeHorizon(tradeSettings);
  // 判定方針が変わってもデータは再取得せず、保持した価格履歴から再計算する。
  const historiesRef = useRef<Record<string, PricePoint[]>>({});
  // applyHistories を再生成させないため、最新のモードは ref 経由で参照する。
  const strategyModeRef = useRef(strategyMode);
  strategyModeRef.current = strategyMode;
  const horizonRef = useRef(horizon);
  horizonRef.current = horizon;
  const [signals, setSignals] = useState<Record<string, SignalResult>>({});
  const [backtests, setBacktests] = useState<Record<string, Backtest>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rateLimited, setRateLimited] = useState(false);
  // どのペアまで届いたかをレンダー間で保持する(エラー時に未取得分だけを塗るため)。
  const resolvedIdsRef = useRef<Set<string>>(new Set());

  const applyHistories = useCallback(
    (histories: Record<string, PricePoint[]>, progress: LoadProgress) => {
      setRateLimited(progress.rateLimited);
      const nextSignals: Record<string, SignalResult> = {};
      const nextBacktests: Record<string, Backtest> = {};
      const nextErrors: Record<string, string> = {};
      Object.entries(histories).forEach(([pairId, history]) => {
        resolvedIdsRef.current.add(pairId);
        historiesRef.current[pairId] = history;
        try {
          nextSignals[pairId] = buildSignal(history, strategyModeRef.current);
          nextBacktests[pairId] = backtestSignals(history, strategyModeRef.current, horizonRef.current);
        } catch (err) {
          nextErrors[pairId] = err instanceof Error ? err.message : '取得エラー';
        }
      });
      setSignals((prev) => ({ ...prev, ...nextSignals }));
      setBacktests((prev) => ({ ...prev, ...nextBacktests }));
      setErrors((prev) => {
        const next = { ...prev, ...nextErrors };
        Object.keys(nextSignals).forEach((pairId) => delete next[pairId]);
        return next;
      });
    },
    []
  );

  const loadAll = useCallback(async (force = false) => {
    setLoading(true);
    setRateLimited(false);
    resolvedIdsRef.current = new Set();
    try {
      await fetchHistories(CURRENCY_PAIRS, HISTORY_DAY_RANGE, applyHistories, force);
    } catch (err) {
      const message = err instanceof Error ? err.message : '取得エラー';
      // 未取得のペアにのみエラーを立て、すでに表示できているシグナルは残す。
      setErrors((prev) => {
        const next = { ...prev };
        CURRENCY_PAIRS.forEach((pair) => {
          if (!resolvedIdsRef.current.has(pair.id)) next[pair.id] = message;
        });
        return next;
      });
    } finally {
      setLoading(false);
      setRateLimited(false);
    }
  }, [applyHistories]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // 足の確定直後に全ペアを取り直す。ただし残クレジットに余裕がある時だけ。
  const [autoRefreshPaused, setAutoRefreshPaused] = useState(false);
  useBarClose(() => {
    if (!canAffordAutoRefresh(CURRENCY_PAIRS.length)) {
      setAutoRefreshPaused(true);
      return;
    }
    setAutoRefreshPaused(false);
    loadAll(true);
  });

  // 判定方針や判定時刻の切り替えでは API を叩かず、取得済みの価格履歴から再計算する。
  useEffect(() => {
    const entries = Object.entries(historiesRef.current);
    if (entries.length === 0) return;
    const recomputed: Record<string, SignalResult> = {};
    const recomputedBacktests: Record<string, Backtest> = {};
    entries.forEach(([pairId, history]) => {
      try {
        recomputed[pairId] = buildSignal(history, strategyMode);
        recomputedBacktests[pairId] = backtestSignals(history, strategyMode, horizon);
      } catch {
        // 再計算できないペアは既存の表示を維持する
      }
    });
    setSignals((prev) => ({ ...prev, ...recomputed }));
    setBacktests((prev) => ({ ...prev, ...recomputedBacktests }));
  }, [strategyMode, horizon]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAll(true);
    setRefreshing(false);
  }, [loadAll]);

  // 全ペアの現在値を数秒おきに更新する(OANDA構成時のみ動作)。
  const {
    prices: livePrices,
    live,
    error: liveError,
    staleMinutes,
  } = useLivePrices(CURRENCY_PAIRS);

  // エントリー判定はスプレッドを差し引いて行うため、現在値が動くたびに引き直す。
  // いずれも取得済みの履歴からの純粋な計算で、APIは叩かない。
  const verdicts = useMemo(() => {
    const result: Record<string, Verdict> = {};
    Object.entries(backtests).forEach(([pairId, backtest]) => {
      const price = livePrices[pairId];
      const cost = price ? spreadPercent(price.bid, price.ask) : null;
      result[pairId] = evaluateEntry(backtest, tradeSettings, cost);
    });
    return result;
  }, [backtests, livePrices, tradeSettings]);

  const clearedCount = Object.values(verdicts).filter(
    (verdict) => verdict.level === 'go'
  ).length;

  const loadedCount = Object.keys(signals).length + Object.keys(errors).length;

  const sections = SECTIONS.map((section) => ({
    title: section.title,
    data: CURRENCY_PAIRS.filter((pair) => pair.group === section.key),
  })).filter((section) => section.data.length > 0);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerBlock}>
        <Text style={styles.title}>Hayabusa FX</Text>
        <Text style={styles.subtitle}>15分足テクニカル指標に基づく為替売買シグナル</Text>
        <Text style={styles.note}>レートはGMOコイン「外国為替FX」の公開APIを利用しています</Text>
        {loading && loadedCount < CURRENCY_PAIRS.length && (
          <Text style={styles.loadingNote}>
            読み込み中… {loadedCount} / {CURRENCY_PAIRS.length} ペア
            {'\n'}
            {rateLimited
              ? 'API上限に達したため待機中です。自動で再試行します'
              : '無料APIの制限により少しずつ取得しています'}
          </Text>
        )}
        {liveError && <Text style={styles.connectionError}>{liveError}</Text>}
        {staleMinutes !== null && (
          <Text style={styles.staleNote}>
            ブラウザから直接接続できないため、定期取得した値を表示しています(
            {staleMinutes}分前の値)。リアルタイムにするには gmo-proxy の中継サーバが必要です。
          </Text>
        )}
        <Text style={styles.creditNote}>
          {live && staleMinutes === null
            ? `現在値をリアルタイム更新中(${LIVE_POLL_MS / 1000}秒ごと)。`
            : ''}
          {!hasDailyCreditLimit()
            ? '15分足の確定ごとに自動更新します'
            : autoRefreshPaused
              ? `本日のAPI残量が少ないため自動更新を停止中です(残り${creditUsage().remaining})。翌日に回復します。今すぐ更新したい場合は下に引いてください`
              : `15分足の確定ごとに自動更新します(本日のAPI残り ${creditUsage().remaining} / ${DAILY_CREDIT_LIMIT})`}
        </Text>
        <View style={styles.countdownWrap}>
          <NextBarCountdown compact />
        </View>
        <View
          style={[styles.clearedBanner, clearedCount > 0 && styles.clearedBannerActive]}
        >
          <Text
            style={[styles.clearedText, clearedCount > 0 && styles.clearedTextActive]}
          >
            {loadedCount < CURRENCY_PAIRS.length
              ? 'エントリー条件を判定中…'
              : clearedCount > 0
                ? `エントリー条件を満たすペア ${clearedCount}件`
                : 'エントリー条件を満たすペアはありません(見送り)'}
          </Text>
        </View>
        <View style={styles.strategyWrap}>
          <TradeTypeSelector compact />
        </View>
        <Pressable style={styles.scanButton} onPress={() => navigation.navigate('Scan')}>
          <Text style={styles.scanButtonText}>条件を満たす組み合わせを探す</Text>
          <Text style={styles.scanButtonHint}>
            全ペア × 方針 × 厳選度を総当たりし、伏せた期間で検証します
          </Text>
        </Pressable>
        <View style={styles.strategyWrap}>
          <StrategySelector />
        </View>
      </View>
      <SectionList
        style={styles.listWrapper}
        sections={sections}
        keyExtractor={(pair) => pair.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionHeader}>{section.title}</Text>
        )}
        renderItem={({ item }) => (
          <PairListItem
            pair={item}
            signal={signals[item.id] ?? null}
            verdict={verdicts[item.id] ?? null}
            livePrice={livePrices[item.id]?.mid ?? null}
            error={errors[item.id] ?? null}
            onPress={() => navigation.navigate('Detail', { pairId: item.id })}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        SectionSeparatorComponent={() => <View style={{ height: 4 }} />}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  headerBlock: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  listWrapper: {
    flex: 1,
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F172A',
  },
  subtitle: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2,
  },
  note: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 4,
  },
  loadingNote: {
    fontSize: 11,
    color: '#2563EB',
    lineHeight: 15,
    marginTop: 6,
  },
  staleNote: {
    fontSize: 11,
    color: '#B45309',
    lineHeight: 16,
    marginTop: 6,
  },
  connectionError: {
    fontSize: 11,
    color: '#B91C1C',
    lineHeight: 16,
    marginTop: 6,
  },
  creditNote: {
    fontSize: 11,
    color: '#94A3B8',
    lineHeight: 15,
    marginTop: 4,
  },
  countdownWrap: {
    marginTop: 10,
  },
  scanButton: {
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    backgroundColor: '#EFF6FF',
    paddingVertical: 9,
    paddingHorizontal: 12,
    gap: 2,
  },
  scanButtonText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1D4ED8',
  },
  scanButtonHint: {
    fontSize: 10,
    color: '#64748B',
  },
  clearedBanner: {
    marginTop: 8,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
  },
  clearedBannerActive: {
    backgroundColor: '#DCFCE7',
  },
  clearedText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
  },
  clearedTextActive: {
    color: '#15803D',
  },
  strategyWrap: {
    marginTop: 10,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
    paddingHorizontal: 4,
    paddingTop: 12,
    paddingBottom: 8,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
});
