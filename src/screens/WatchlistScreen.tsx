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
import { setSelectedPair } from '../state/pairStore';
import { CurrencyPair, PricePoint, SignalResult } from '../types';
import { buildSignal } from '../utils/signal';
import { Backtest, backtestSignals } from '../utils/statistics';
import { evaluateEntry, spreadPercent } from '../utils/verdict';
import { evaluateDataHealth } from '../utils/dataHealth';
import {
  buildPairStatus,
  globalStop,
  PairStatus,
  stoppedStatus,
} from '../utils/watchlistStatus';
import { useAccount } from '../state/accountStore';
import { usePosition } from '../state/positionStore';
import { summarise, useTrades } from '../state/tradeHistoryStore';
import { activeHorizon, useTradeSettings } from '../utils/tradeSettings';
import { TradeTypeSelector } from '../components/TradeTypeSelector';
import { useStrategyMode } from '../utils/strategyStore';
import { useBarClose } from '../utils/useBarClose';
import { LIVE_POLL_MS, useLivePrices } from '../utils/useLivePrices';

// 一覧でも上位足の環境を見るため、15分足を多めに取って1時間足・4時間足を合成する。
// 足種ごとに取りに行くとリクエストが10ペア分で100近くになるため、この方法を採る。
// 5日 = 480本 → 1時間足120本・4時間足30本。指標の算出に足りる本数。
const HISTORY_DAY_RANGE = 5;

const SECTIONS: { key: CurrencyPair['group']; title: string }[] = [
  { key: 'jpy', title: '対円通貨ペア' },
  { key: 'cross', title: 'クロス通貨ペア' },
];

type Props = NativeStackScreenProps<RootStackParamList, 'Watchlist'>;

export function WatchlistScreen({ navigation }: Props) {
  const strategyMode = useStrategyMode();
  const account = useAccount();
  const positionState = usePosition();
  const trades = useTrades();
  const daily = useMemo(() => summarise(trades), [trades]);
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

  // 口座側の停止(連敗・日次損失・保有中)は通貨ペアによらず全体に効く。
  const stopReason = useMemo(
    () => globalStop(account, daily, positionState),
    [account, daily, positionState]
  );

  // 各行の判定。取得済みの履歴からの純粋な計算で、APIは叩かない。
  const statuses = useMemo(() => {
    const result: Record<string, PairStatus> = {};
    if (stopReason) {
      // 止まっている時に「買い候補」を並べると誤操作を招くので、全行を止める。
      CURRENCY_PAIRS.forEach((pair) => {
        result[pair.id] = stoppedStatus(stopReason);
      });
      return result;
    }
    Object.entries(backtests).forEach(([pairId, backtest]) => {
      const price = livePrices[pairId];
      const cost = price ? spreadPercent(price.bid, price.ask) : null;
      const verdict = evaluateEntry(backtest, tradeSettings, cost);
      const bars = historiesRef.current[pairId] ?? [];
      // ホームと同じ判定を使う。価格が「ある」だけでは足りず、鮮度まで見ないと
      // 配信が止まっていても候補を出してしまう。
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
  }, [backtests, livePrices, tradeSettings, strategyMode, stopReason, staleMinutes]);

  const candidates = Object.entries(statuses).filter(
    ([, status]) => status.level === 'candidate'
  );

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
        {stopReason ? (
          <View style={[styles.clearedBanner, styles.stopBanner]}>
            <Text style={[styles.clearedText, styles.stopText]}>⛔ 取引しない</Text>
            <Text style={styles.stopDetail}>{stopReason}</Text>
          </View>
        ) : (
          <View
            style={[styles.clearedBanner, candidates.length > 0 && styles.clearedBannerActive]}
          >
            <Text
              style={[styles.clearedText, candidates.length > 0 && styles.clearedTextActive]}
            >
              {loadedCount < CURRENCY_PAIRS.length
                ? '判定中…'
                : candidates.length > 0
                  ? `🟢 取引候補 ${candidates.length}件`
                  : '🟡 今は候補なし(全ペア様子見)'}
            </Text>
            <Text style={styles.stopDetail}>
              候補は「上位足の環境・15分の方向・過去成績」の3条件がそろったペアです。
              入る前にタップしてホームで1分足のトリガーを確認してください。
            </Text>
          </View>
        )}
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
            status={statuses[item.id] ?? null}
            livePrice={livePrices[item.id]?.mid ?? null}
            error={errors[item.id] ?? null}
            onPress={() => {
              // 一覧から選んだペアをホームにも反映する(片方だけ変わると話が食い違う)
              setSelectedPair(item.id);
              navigation.navigate('Detail', { pairId: item.id });
            }}
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
    fontSize: 13,
    fontWeight: '800',
    color: '#64748B',
  },
  stopBanner: { backgroundColor: '#FEF2F2' },
  stopText: { color: '#B91C1C' },
  stopDetail: {
    fontSize: 10,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 2,
    lineHeight: 14,
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
