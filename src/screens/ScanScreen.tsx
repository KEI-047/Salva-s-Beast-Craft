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
import { BUILD_ID } from '../constants/build';
import { CONTENT_MAX_WIDTH } from '../constants/layout';
import { CURRENCY_PAIRS } from '../constants/pairs';
import { RootStackParamList } from '../navigation/types';
import { PricePoint } from '../types';
import { runScan, ScanResult, ScanSummary, TRAIN_RATIO } from '../utils/scan';
import { runTradeScan, TradeScanResult, TradeScanSummary } from '../utils/tradeScan';
import { horizonLabel, HORIZON_OPTIONS, useTradeSettings } from '../utils/tradeSettings';

type Props = NativeStackScreenProps<RootStackParamList, 'Scan'>;

/**
 * 総当たりに使う期間。長いほどサンプルが増え、統計が効くようになる。
 *
 * 確定した日の足は日単位で保存しているため、2回目以降は増えた日ぶんしか
 * 取りに行かない。90日でも初回だけ待てば済む。
 */
const DAY_OPTIONS = [30, 90, 365];

export function ScanScreen({ navigation }: Props) {
  const settings = useTradeSettings();
  const [days, setDays] = useState(90);
  const [loading, setLoading] = useState(false);
  const [loadedPairs, setLoadedPairs] = useState(0);
  const [summary, setSummary] = useState<ScanSummary | null>(null);
  const [tradeSummary, setTradeSummary] = useState<TradeScanSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    navigation.setOptions({ title: '条件を満たす組み合わせを探す' });
  }, [navigation]);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSummary(null);
    setTradeSummary(null);
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
      // 同じ取得データで、実際の決済ルール(TP/SL)でも回す。追加のリクエストは発生しない。
      setTradeSummary(runTradeScan({ pairs: CURRENCY_PAIRS, histories }));
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
          期間が短いと、成績以前に「取引回数が足りず判定できない」で終わります。
          20〜30回では、成績が良くても偶然と区別できません。
          <Text style={styles.strong}>100回前後まで増やして初めて判定できます。</Text>
          {'\n'}
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
              {days}日ぶんを取りに行きます。初回は{days >= 365 ? '5分以上' : '数分'}
              かかることがありますが、確定した日は保存するので2回目以降は速くなります。
              途中で閉じないでください
            </Text>
          </View>
        )}
        {error && <Text style={styles.error}>{error}</Text>}
        <Text style={styles.build}>ビルド {BUILD_ID}</Text>
      </View>

      {tradeSummary && <TradeResults summary={tradeSummary} />}
      {summary && <Results summary={summary} />}
    </ScrollView>
  );
}

function pips(value: number): string {
  return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}pips`;
}

function pf(value: number | null): string {
  if (value === null) return '—';
  return value === Infinity ? '損失なし' : value.toFixed(2);
}

/**
 * 実際にTP/SLで決済した場合の結果。
 * 「次の足が動いたか」ではなく、損切り・利確・スプレッドを込みで回した数字なので、
 * 実運用に効くのはこちら。
 */
function TradeResults({ summary }: { summary: TradeScanSummary }) {
  const best = summary.confirmed[0] ?? null;

  return (
    <View style={[styles.card, best ? styles.goodCard : undefined]}>
      <Text style={styles.cardTitle}>実際にTP/SLで決済した場合(本命)</Text>
      <Text style={styles.note}>
        損切り(ATR×1・1.5・2.5)と利確(RR 1:1・1.5・2・3)も総当たりに含め、
        スプレッド往復ぶんを引いて回した結果です。
        約定は<Text style={styles.strong}>シグナルの次の足の始値</Text>にしており、
        同じ足で利確と損切りの両方に触れた場合は
        <Text style={styles.strong}>必ず損切り扱い</Text>にしています(甘く数えないため)。
      </Text>

      <View style={styles.statRow}>
        <Stat label="試した組み合わせ" value={`${summary.tested}通り`} />
        <Stat label="探索で黒字" value={`${summary.survivors.length}件`} />
        <Stat
          label="検証でも黒字"
          value={`${summary.confirmed.length}件`}
          highlight={summary.confirmed.length > 0}
        />
      </View>

      {summary.confirmed.length === 0 ? (
        <>
          <Text style={styles.emptyBody}>
            {summary.survivors.length === 0
              ? `${summary.tested}通りすべてで、探索区間の時点で損益がマイナスでした。この指標・この期間では、TP/SLで決済すると勝てません。`
              : `${summary.survivors.length}件が探索区間では黒字でしたが、伏せておいた検証区間では通りませんでした。`}
          </Text>

          {/* 0件には2つの意味がある。「優位性が無い」のか「判定できるだけの
              取引回数が無かった」のか。取るべき行動が正反対なので必ず区別する。 */}
          {summary.underpowered > 0 && (
            <View style={styles.underCard}>
              <Text style={styles.underTitle}>
                期間が足りていない可能性があります
              </Text>
              <Text style={styles.underBody}>
                検証区間で落ちた{summary.survivors.length}件のうち
                <Text style={styles.strong}>{summary.underpowered}件</Text>
                は、成績ではなく<Text style={styles.strong}>取引回数が{summary.minTrades}回に届かなかった</Text>
                ことが理由です(検証区間は{summary.testBars}本)。
                優位性が無いと決まったわけではありません。
                <Text style={styles.strong}>期間を延ばして、もう一度実行してください。</Text>
              </Text>
            </View>
          )}

          {summary.survivors.length > 0 && (
            <>
              <Text style={styles.cardTitle}>
                惜しかったもの(なぜ落ちたか)
              </Text>
              {summary.survivors.slice(0, 3).map((result) => (
                <View
                  key={`${result.pairId}|${result.mode}|${result.minScore}|${result.direction}`}
                  style={styles.nearRow}
                >
                  <Text style={styles.rowTitle}>
                    {result.pairLabel} /{' '}
                    {result.mode === 'trend' ? '順張り' : result.mode === 'reversion' ? '逆張り' : '自動'} /
                    厳選度 {result.minScore} / {result.direction === 'BUY' ? '買い' : '売り'} /
                    損切ATR×{result.slAtr} RR1:{result.rr}
                  </Text>
                  <Text style={styles.rowLine}>
                    検証: {result.test.samples}回 / 1回あたり {pips(result.test.expectancyPips)} ／
                    探索: {result.train.samples}回 / {pips(result.train.expectancyPips)}
                  </Text>
                  <Text style={styles.rowSub}>{result.failReason ?? ''}</Text>
                </View>
              ))}
            </>
          )}

          <Text style={styles.emptyBody}>
            これは不具合ではなく結果です。
            <Text style={styles.strong}>この状態で自動売買をONにしても、損失が自動化されるだけです。</Text>
          </Text>
        </>
      ) : (
        <>
          {summary.confirmed.map((result) => (
            <TradeRow key={`${result.pairId}|${result.mode}|${result.minScore}|${result.direction}`} result={result} />
          ))}
          <Text style={styles.note}>
            {summary.tested}通りを試しているため、検証区間の判定には多重比較の補正
            (z = {summary.confirmZ.toFixed(2)})をかけています。
            勝率の損益分岐は RR 1:2 なので {(summary.breakEven * 100).toFixed(1)}% です。
            {summary.ambiguousTotal > 0
              ? ` 同じ足で利確と損切りの両方に触れた ${summary.ambiguousTotal} 件は、すべて損切りとして数えています。`
              : ''}
          </Text>
        </>
      )}
    </View>
  );
}

function TradeRow({ result }: { result: TradeScanResult }) {
  const { test } = result;
  return (
    <View style={styles.row}>
      <Text style={styles.rowTitle}>
        {result.pairLabel} / {result.mode === 'trend' ? '順張り' : result.mode === 'reversion' ? '逆張り' : '自動'} /
        厳選度 {result.minScore} / {result.direction === 'BUY' ? '買い' : '売り'} /
        損切ATR×{result.slAtr} RR1:{result.rr}
      </Text>
      <Text style={styles.rowLine}>
        検証区間: {test.samples}回 / 勝率 {((test.winRate ?? 0) * 100).toFixed(0)}% / 1回あたり{' '}
        {pips(test.expectancyPips)} / 合計 {pips(test.totalPips)}
      </Text>
      <Text style={styles.rowLine}>
        PF {pf(test.profitFactor)} / 最大ドローダウン {test.maxDrawdownPips.toFixed(1)}pips / 最大
        {test.maxConsecutiveLosses}連敗
      </Text>
      <Text style={styles.rowSub}>
        探索区間: {result.train.samples}回 / 1回あたり {pips(result.train.expectancyPips)}
      </Text>
    </View>
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
  build: { fontSize: 10, color: '#CBD5E1', textAlign: 'right' },
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
  goodCard: { borderWidth: 2, borderColor: '#16A34A' },
  row: { backgroundColor: '#F0FDF4', borderRadius: 10, padding: 10, gap: 3 },
  nearRow: { backgroundColor: '#F8FAFC', borderRadius: 10, padding: 10, gap: 3 },
  underCard: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 10,
    padding: 12,
    gap: 4,
  },
  underTitle: { fontSize: 13, fontWeight: '800', color: '#1D4ED8' },
  underBody: { fontSize: 12, color: '#1E40AF', lineHeight: 18 },
  rowTitle: { fontSize: 12, fontWeight: '800', color: '#0F172A' },
  rowLine: { fontSize: 11, color: '#334155', lineHeight: 16 },
  rowSub: { fontSize: 10, color: '#64748B' },
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
