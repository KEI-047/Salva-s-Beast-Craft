import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { fetchHistory } from '../api/forex';
import { ForecastCard } from '../components/ForecastCard';
import { LivePriceBar } from '../components/LivePriceBar';
import { NextBarCountdown } from '../components/NextBarCountdown';
import { PriceChart } from '../components/PriceChart';
import { SignalCard } from '../components/SignalCard';
import { StrategySelector } from '../components/StrategySelector';
import { CONTENT_MAX_WIDTH } from '../constants/layout';
import { findPair } from '../constants/pairs';
import { RootStackParamList } from '../navigation/types';
import { PricePoint, SignalResult } from '../types';
import { buildSignal } from '../utils/signal';
import { backtestSignals, forecastNextBar } from '../utils/statistics';
import { useStrategyMode } from '../utils/strategyStore';
import { useBarClose } from '../utils/useBarClose';
import { useLivePrices } from '../utils/useLivePrices';

type Props = NativeStackScreenProps<RootStackParamList, 'Detail'>;

const PERIOD_OPTIONS = [
  { label: '1日', days: 1 },
  { label: '3日', days: 3 },
  { label: '5日', days: 5 },
];

export function DetailScreen({ route, navigation }: Props) {
  const pair = findPair(route.params.pairId);
  const strategyMode = useStrategyMode();
  const [days, setDays] = useState(3);
  const [history, setHistory] = useState<PricePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pair) return;
    navigation.setOptions({ title: `${pair.label} ${pair.nameJa}` });
  }, [pair, navigation]);

  useEffect(() => {
    if (!pair) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchHistory(pair.base, pair.quote, days)
      .then((data) => {
        if (!cancelled) setHistory(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '取得エラー');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [pair, days]);

  // 15分足の確定直後に、この通貨ペアだけ取り直す(1リクエスト = 1クレジット)。
  const refreshOnBarClose = useCallback(() => {
    if (!pair) return;
    fetchHistory(pair.base, pair.quote, days, true)
      .then(setHistory)
      .catch(() => {
        // 自動更新の失敗は表示中のデータを維持したまま黙って見送る
      });
  }, [pair, days]);

  useBarClose(refreshOnBarClose, Boolean(pair));

  // 現在値を数秒おきに取得する。チャートには形成中の足として重ねる。
  const livePairs = useMemo(
    () => (pair ? [{ id: pair.id, base: pair.base, quote: pair.quote }] : []),
    [pair]
  );
  const { prices, live } = useLivePrices(livePairs);
  const livePrice = pair ? prices[pair.id] ?? null : null;

  // 確定足に現在値を1本足して表示する(シグナル計算には使わない)。
  const chartData = useMemo(() => {
    if (!livePrice || history.length === 0) return history;
    return [...history, { date: livePrice.time, rate: livePrice.mid }];
  }, [history, livePrice]);

  const signal: SignalResult | null = useMemo(() => {
    if (history.length === 0) return null;
    try {
      return buildSignal(history, strategyMode);
    } catch {
      return null;
    }
  }, [history, strategyMode]);

  const stats = useMemo(() => {
    if (history.length === 0) return null;
    return {
      forecast: forecastNextBar(history),
      backtest: backtestSignals(history, strategyMode),
    };
  }, [history, strategyMode]);

  if (!pair) {
    return (
      <View style={styles.center}>
        <Text>通貨ペアが見つかりません。</Text>
      </View>
    );
  }

  const chartWidth = Math.min(Dimensions.get('window').width, CONTENT_MAX_WIDTH) - 32;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <NextBarCountdown />

      <StrategySelector regime={signal?.regime} efficiencyRatio={signal?.efficiencyRatio} />

      <View style={styles.periodRow}>
        {PERIOD_OPTIONS.map((option) => (
          <Pressable
            key={option.days}
            style={[styles.periodButton, days === option.days && styles.periodButtonActive]}
            onPress={() => setDays(option.days)}
          >
            <Text style={[styles.periodText, days === option.days && styles.periodTextActive]}>
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading && history.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#2563EB" />
        </View>
      ) : error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : (
        <>
          <LivePriceBar price={livePrice} live={live} />
          <View style={styles.chartCard}>
            <PriceChart data={chartData} width={chartWidth} height={180} />
          </View>
          {signal && <SignalCard signal={signal} />}
          {stats && <ForecastCard forecast={stats.forecast} backtest={stats.backtest} />}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  content: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    padding: 16,
    gap: 16,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  errorText: {
    color: '#B91C1C',
    textAlign: 'center',
    marginTop: 24,
  },
  periodRow: {
    flexDirection: 'row',
    gap: 8,
  },
  periodButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
  },
  periodButtonActive: {
    backgroundColor: '#2563EB',
  },
  periodText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  periodTextActive: {
    color: '#FFFFFF',
  },
  chartCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
  },
});
