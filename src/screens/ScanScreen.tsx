import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { fetchHistories } from '../api/forex';
import { CONTENT_MAX_WIDTH } from '../constants/layout';
import { CURRENCY_PAIRS } from '../constants/pairs';
import { RootStackParamList } from '../navigation/types';
import { PricePoint } from '../types';
import { runScan, ScanResult, ScanSummary, TRAIN_RATIO } from '../utils/scan';
import { horizonLabel, HORIZON_OPTIONS, useTradeSettings } from '../utils/tradeSettings';

type Props = NativeStackScreenProps<RootStackParamList, 'Scan'>;

/** 総当たりに使う期間。長いほどサンプルが増え、統計が効くようになる。 */
const DAY_OPTIONS = [7, 14, 30];

export function ScanScreen({ navigation }: Props) {
  const settings = useTradeSettings();
  const [days, setDays] = useState(14);
  const [loading, setLoading] = useState(false);
  const [loadedPairs, setLoadedPairs] = useState(0);
  const [summary, setSummary] = useState<ScanSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    navigation.setOptions({ title: '条件を満たす組み合わせを探す' });
  }, [navigation]);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSummary(null);
    setLoadedPairs(0);
    try {
      const histories: Record<string, PricePoint[]> = {};
      await fetchHistories(CURRENCY_PAIRS, days, (chunk) => {
        Object.assign(histories, chunk);
        setLoadedPairs(Object.keys(histories).length);
      });
      // FXの保有時間もバイナリーの判定時刻も、どちらも総当たりの対象にする。
      setSummary(
        runScan({ pairs: CURRENCY_PAIRS, histories, settings, horizons: HORIZON_OPTIONS })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '取得エラー');
    } finally {
      setLoading(false);
    }
  }, [days, settings]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.lead}>
          通貨ペア × 判定方針 × {settings.tradeType === 'binary' ? '判定時刻' : '保有時間'} ×
          厳選度 × 売買方向のすべての組み合わせを機械的に試し、条件を満たすものがあるかを探します。
        </Text>
        <Text style={styles.note}>
          期間の前{Math.round(TRAIN_RATIO * 100)}%だけで探索し、
          <Text style={styles.strong}>残りは伏せたまま</Text>
          にします。探索で見つかった組み合わせを、その伏せた期間で検証します。
          過去に合わせただけの組み合わせは、ここで落ちます。
        </Text>

        <View style={styles.periodRow}>
          <Text style={styles.periodLabel}>期間</Text>
          {DAY_OPTIONS.map((option) => (
            <Pressable
              key={option}
              style={[styles.chip, days === option && styles.chipActive]}
              onPress={() => setDays(option)}
              disabled={loading}
            >
              <Text style={[styles.chipText, days === option && styles.chipTextActive]}>
                {option}日
              </Text>
            </Pressable>
          ))}
        </View>

        <Pressable
          style={[styles.runButton, loading && styles.runButtonDisabled]}
          onPress={run}
          disabled={loading}
        >
          <Text style={styles.runButtonText}>
            {loading ? '探索中…' : '探索を実行'}
          </Text>
        </Pressable>
        {loading && (
          <View style={styles.progress}>
            <ActivityIndicator color="#2563EB" />
            <Text style={styles.progressText}>
              レート取得中 {loadedPairs} / {CURRENCY_PAIRS.length} ペア
              {'\n'}
              {days}日ぶんを取りに行くため、30秒〜1分ほどかかります
            </Text>
          </View>
        )}
        {error && <Text style={styles.error}>{error}</Text>}
      </View>

      {summary && <Results summary={summary} />}
    </ScrollView>
  );
}

function Results({ summary }: { summary: ScanSummary }) {
  const breakEvenLabel = `${(summary.breakEven * 100).toFixed(1)}%`;

  return (
    <>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>結果</Text>
        <View style={styles.statRow}>
          <Stat label="試した組み合わせ" value={`${summary.tested}通り`} />
          <Stat label="探索で通過" value={`${summary.survivors.length}件`} />
          <Stat
            label="検証でも通過"
            value={`${summary.confirmed.length}件`}
            highlight={summary.confirmed.length > 0}
          />
        </View>
        <Text style={styles.note}>
          損益分岐勝率 {breakEvenLabel} / 探索 {summary.trainBars}本・検証 {summary.testBars}本。
          {summary.tested}通りを試すため、要求する信頼水準を
          {(summary.confidence * 100).toFixed(3)}%(z = {summary.z.toFixed(2)})まで引き上げています。
          検証区間でも同じ考え方で、生き残った{summary.survivors.length}件ぶんの補正(z ={' '}
          {summary.confirmZ.toFixed(2)})をかけて判定します。
          補正しないと、優位性が無くても偶然よく見えるだけの組み合わせを拾ってしまいます。
        </Text>
      </View>

      {summary.confirmed.length === 0 ? (
        <View style={[styles.card, styles.emptyCard]}>
          <Text style={styles.emptyTitle}>
            {summary.survivors.length === 0
              ? '条件を満たす組み合わせはありませんでした'
              : '探索では通りましたが、検証区間で再現しませんでした'}
          </Text>
          <Text style={styles.emptyBody}>
            {summary.survivors.length === 0
              ? `${summary.tested}通りすべてで、勝率が損益分岐(${breakEvenLabel})を統計的に上回りませんでした。これは不具合ではなく、この期間・この指標では優位性が見つからなかったという結果です。`
              : `${summary.survivors.length}件が探索区間では条件を満たしましたが、伏せておいた検証区間では再現しませんでした。過去データに合っていただけ(カーブフィッティング)である可能性が高く、実際に使うべきではありません。`}
            {'\n\n'}
            期間を変えて試すことはできますが、
            <Text style={styles.strong}>何度も試して通るまで探す行為そのものが多重比較</Text>
            になります。通らなかったという結果を受け入れるのが、最も損をしない選択です。
          </Text>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            検証区間でも条件を満たした組み合わせ({summary.confirmed.length}件)
          </Text>
          {summary.confirmed.map((result) => (
            <ResultRow key={rowKey(result)} result={result} />
          ))}
        </View>
      )}

      {summary.survivors.length > summary.confirmed.length && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            探索のみ通過(検証で落ちた {summary.survivors.length - summary.confirmed.length}件)
          </Text>
          <Text style={styles.note}>
            参考として出しています。
            <Text style={styles.strong}>これらは使わないでください。</Text>
            過去に合っていただけの可能性が高いものです。
          </Text>
          {summary.survivors
            .filter((result) => !result.confirmed)
            .slice(0, 10)
            .map((result) => (
              <ResultRow key={rowKey(result)} result={result} muted />
            ))}
        </View>
      )}
    </>
  );
}

function rowKey(result: ScanResult): string {
  return `${result.pairId}|${result.mode}|${result.horizonBars}|${result.minScore}|${result.direction}`;
}

function ResultRow({ result, muted = false }: { result: ScanResult; muted?: boolean }) {
  const pct = (value: number | null) =>
    value === null ? '—' : `${(value * 100).toFixed(1)}%`;
  return (
    <View style={[styles.resultRow, muted && styles.resultRowMuted]}>
      <Text style={[styles.resultTitle, muted && styles.mutedText]}>
        {result.pairLabel} / {result.directionLabel} / {result.modeLabel} /{' '}
        {horizonLabel(result.horizonBars)}後 / 厳選度{result.minScoreLabel}
      </Text>
      <View style={styles.resultStats}>
        <Text style={styles.resultStat}>
          探索 {pct(result.train.winRate)}({result.train.samples}件)
        </Text>
        <Text style={[styles.resultStat, !muted && styles.resultStatStrong]}>
          検証 {pct(result.test.winRate)}({result.test.samples}件)
        </Text>
      </View>
    </View>
  );
}

function Stat({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, highlight && styles.statValueStrong]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  content: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    padding: 16,
    gap: 14,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  cardTitle: { fontSize: 14, fontWeight: '800', color: '#0F172A' },
  lead: { fontSize: 13, color: '#334155', lineHeight: 19 },
  note: { fontSize: 11, color: '#64748B', lineHeight: 16 },
  strong: { fontWeight: '800', color: '#334155' },
  periodRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  periodLabel: { fontSize: 11, color: '#64748B', width: 32 },
  chip: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
  },
  chipActive: { backgroundColor: '#2563EB' },
  chipText: { fontSize: 12, fontWeight: '600', color: '#475569' },
  chipTextActive: { color: '#FFFFFF', fontWeight: '800' },
  runButton: {
    backgroundColor: '#2563EB',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  runButtonDisabled: { backgroundColor: '#94A3B8' },
  runButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  progressText: { flex: 1, fontSize: 11, color: '#2563EB', lineHeight: 16 },
  error: { fontSize: 12, color: '#B91C1C' },
  statRow: { flexDirection: 'row', gap: 8 },
  stat: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  statLabel: { fontSize: 10, color: '#64748B', textAlign: 'center' },
  statValue: { fontSize: 15, fontWeight: '800', color: '#0F172A', marginTop: 2 },
  statValueStrong: { color: '#15803D' },
  emptyCard: { backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0' },
  emptyTitle: { fontSize: 14, fontWeight: '800', color: '#334155' },
  emptyBody: { fontSize: 12, color: '#475569', lineHeight: 18 },
  resultRow: {
    backgroundColor: '#F0FDF4',
    borderRadius: 10,
    padding: 10,
    gap: 4,
  },
  resultRowMuted: { backgroundColor: '#F8FAFC' },
  resultTitle: { fontSize: 12, fontWeight: '700', color: '#0F172A' },
  mutedText: { color: '#64748B', fontWeight: '600' },
  resultStats: { flexDirection: 'row', gap: 12 },
  resultStat: { fontSize: 11, color: '#64748B' },
  resultStatStrong: { color: '#15803D', fontWeight: '700' },
});
