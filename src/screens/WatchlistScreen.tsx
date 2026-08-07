import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, SafeAreaView, SectionList, StyleSheet, Text, View } from 'react-native';
import { fetchHistories } from '../api/forex';
import { PairListItem } from '../components/PairListItem';
import { CONTENT_MAX_WIDTH } from '../constants/layout';
import { CURRENCY_PAIRS } from '../constants/pairs';
import { RootStackParamList } from '../navigation/types';
import { CurrencyPair, PricePoint, SignalResult } from '../types';
import { buildSignal } from '../utils/signal';

const HISTORY_DAY_RANGE = 3;

const SECTIONS: { key: CurrencyPair['group']; title: string }[] = [
  { key: 'jpy', title: '対円通貨ペア' },
  { key: 'cross', title: 'クロス通貨ペア' },
];

type Props = NativeStackScreenProps<RootStackParamList, 'Watchlist'>;

export function WatchlistScreen({ navigation }: Props) {
  const [signals, setSignals] = useState<Record<string, SignalResult>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  // どのペアまで届いたかをレンダー間で保持する(エラー時に未取得分だけを塗るため)。
  const resolvedIdsRef = useRef<Set<string>>(new Set());

  const applyHistories = useCallback((histories: Record<string, PricePoint[]>) => {
    const nextSignals: Record<string, SignalResult> = {};
    const nextErrors: Record<string, string> = {};
    Object.entries(histories).forEach(([pairId, history]) => {
      resolvedIdsRef.current.add(pairId);
      try {
        nextSignals[pairId] = buildSignal(history);
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
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    resolvedIdsRef.current = new Set();
    try {
      await fetchHistories(CURRENCY_PAIRS, HISTORY_DAY_RANGE, applyHistories);
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
    }
  }, [applyHistories]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAll();
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
            {'\n'}無料APIの制限により8ペアずつ約1分間隔で取得しています
          </Text>
        )}
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
