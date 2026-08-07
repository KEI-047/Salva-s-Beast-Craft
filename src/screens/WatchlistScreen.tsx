import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, SafeAreaView, SectionList, StyleSheet, Text, View } from 'react-native';
import {
  canAffordAutoRefresh,
  creditUsage,
  DAILY_CREDIT_LIMIT,
  fetchHistories,
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
import { useStrategyMode } from '../utils/strategyStore';
import { useBarClose } from '../utils/useBarClose';

const HISTORY_DAY_RANGE = 3;

const SECTIONS: { key: CurrencyPair['group']; title: string }[] = [
  { key: 'jpy', title: '対円通貨ペア' },
  { key: 'cross', title: 'クロス通貨ペア' },
];

type Props = NativeStackScreenProps<RootStackParamList, 'Watchlist'>;

export function WatchlistScreen({ navigation }: Props) {
  const strategyMode = useStrategyMode();
  // 判定方針が変わってもデータは再取得せず、保持した価格履歴から再計算する。
  const historiesRef = useRef<Record<string, PricePoint[]>>({});
  // applyHistories を再生成させないため、最新のモードは ref 経由で参照する。
  const strategyModeRef = useRef(strategyMode);
  strategyModeRef.current = strategyMode;
  const [signals, setSignals] = useState<Record<string, SignalResult>>({});
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
      const nextErrors: Record<string, string> = {};
      Object.entries(histories).forEach(([pairId, history]) => {
        resolvedIdsRef.current.add(pairId);
        historiesRef.current[pairId] = history;
        try {
          nextSignals[pairId] = buildSignal(history, strategyModeRef.current);
        } catch (err) {
          nextErrors[pairId] = err instanceof Error ? err.message : '取得エラー';
        }
      });
      setSignals((prev) => ({ ...prev, ...nextSignals }));
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

  // 判定方針の切り替えでは API を叩かず、取得済みの価格履歴から再計算する。
  useEffect(() => {
    const entries = Object.entries(historiesRef.current);
    if (entries.length === 0) return;
    const recomputed: Record<string, SignalResult> = {};
    entries.forEach(([pairId, history]) => {
      try {
        recomputed[pairId] = buildSignal(history, strategyMode);
      } catch {
        // 再計算できないペアは既存の表示を維持する
      }
    });
    setSignals((prev) => ({ ...prev, ...recomputed }));
  }, [strategyMode]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAll(true);
    setRefreshing(false);
  }, [loadAll]);

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
        <Text style={styles.note}>通貨ペアは松井証券FXの取扱ラインナップを参考にしています</Text>
        {loading && loadedCount < CURRENCY_PAIRS.length && (
          <Text style={styles.loadingNote}>
            読み込み中… {loadedCount} / {CURRENCY_PAIRS.length} ペア
            {'\n'}
            {rateLimited
              ? 'API上限に達したため待機中です。自動で再試行します'
              : '無料APIの制限により少しずつ取得しています'}
          </Text>
        )}
        <Text style={styles.creditNote}>
          {autoRefreshPaused
            ? `本日のAPI残量が少ないため自動更新を停止中です(残り${creditUsage().remaining})。翌日に回復します。今すぐ更新したい場合は下に引いてください`
            : `15分足の確定ごとに自動更新します(本日のAPI残り ${creditUsage().remaining} / ${DAILY_CREDIT_LIMIT})`}
        </Text>
        <View style={styles.countdownWrap}>
          <NextBarCountdown compact />
        </View>
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
  creditNote: {
    fontSize: 11,
    color: '#94A3B8',
    lineHeight: 15,
    marginTop: 4,
  },
  countdownWrap: {
    marginTop: 10,
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
