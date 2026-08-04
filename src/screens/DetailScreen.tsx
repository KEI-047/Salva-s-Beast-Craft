import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useState } from 'react';
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
import { PriceChart } from '../components/PriceChart';
import { SignalCard } from '../components/SignalCard';
import { CONTENT_MAX_WIDTH } from '../constants/layout';
import { findPair } from '../constants/pairs';
import { RootStackParamList } from '../navigation/types';
import { PricePoint, SignalResult } from '../types';
import { buildSignal } from '../utils/signal';

type Props = NativeStackScreenProps<RootStackParamList, 'Detail'>;

const PERIOD_OPTIONS = [
  { label: '1日', days: 1 },
  { label: '3日', days: 3 },
  { label: '5日', days: 5 },
];

export function DetailScreen({ route, navigation }: Props) {
  const pair = findPair(route.params.pairId);
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

  const signal: SignalResult | null = useMemo(() => {
    if (history.length === 0) return null;
    try {
      return buildSignal(history);
    } catch {
      return null;
    }
  }, [history]);

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
          <View style={styles.chartCard}>
            <PriceChart data={history} width={chartWidth} height={180} />
          </View>
          {signal && <SignalCard signal={signal} />}
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
