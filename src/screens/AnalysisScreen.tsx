import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StrategySelector } from '../components/StrategySelector';
import { TradeTypeSelector } from '../components/TradeTypeSelector';
import { CONTENT_MAX_WIDTH } from '../constants/layout';
import { AnalysisStackParamList } from '../navigation/types';
import { useSelectedPair } from '../state/pairStore';
import { PairSelector } from '../components/PairSelector';
import { ROLE_ORDER } from '../utils/timeframes';
import { useMarketData } from '../utils/useMarketData';

/**
 * 分析(仕様19・20)。
 *
 * ホームをシンプルに保つため、詳細な指標はすべてこの画面に集める。
 * 情報量が多くても構わない。既存のウォッチリスト・詳細・総当たり探索も
 * ここから開く(消さない)。
 */

type Props = NativeStackScreenProps<AnalysisStackParamList, 'AnalysisHome'>;

export function AnalysisScreen({ navigation }: Props) {
  const pair = useSelectedPair();
  const { context, bars } = useMarketData(pair);

  const frames = context
    ? {
        '4hour': context.frames.fourHour,
        '1hour': context.frames.hourly,
        '15min': context.frames.fifteen,
        '5min': context.frames.five,
        '1min': context.frames.minute,
      }
    : null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <View style={styles.pairRow}>
          <Text style={styles.cardTitle}>マルチタイムフレーム</Text>
          <PairSelector />
        </View>
        <Text style={styles.note}>
          上位足は相場環境の確認に使い、エントリーの直接のきっかけにはしません。
          下へ行くほど短く、最後の1分足がトリガーです。
        </Text>
        {ROLE_ORDER.map((entry) => {
          const frame = frames?.[entry.key as keyof typeof frames];
          const direction = frame?.direction ?? 'HOLD';
          const color =
            direction === 'BUY' ? '#15803D' : direction === 'SELL' ? '#B91C1C' : '#94A3B8';
          return (
            <View key={entry.key} style={styles.frameRow}>
              <Text style={styles.frameLabel}>{entry.label}</Text>
              <Text style={styles.frameRole}>{entry.role}</Text>
              <Text style={[styles.frameDirection, { color }]}>
                {direction === 'BUY' ? '上昇' : direction === 'SELL' ? '下降' : '方向なし'}
              </Text>
              <Text style={styles.frameAdx}>
                ADX {frame?.adx === null || frame?.adx === undefined ? '—' : frame.adx.toFixed(0)}
              </Text>
            </View>
          );
        })}
      </View>

      {context && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>値動きの大きさ・価格帯</Text>
          <Row
            label="ATR(15分)"
            value={context.atr === null ? '—' : context.atr.toFixed(4)}
          />
          <Row
            label="抵抗帯"
            value={
              context.resistance.length
                ? context.resistance.map((v) => v.toFixed(3)).join(' / ')
                : '—'
            }
          />
          <Row
            label="支持帯"
            value={
              context.support.length
                ? context.support.map((v) => v.toFixed(3)).join(' / ')
                : '—'
            }
          />
          <Row label="15分足の本数" value={`${bars['15min'].length}本`} />
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>判定方針</Text>
        <StrategySelector />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>保有時間</Text>
        <TradeTypeSelector />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>詳しく調べる</Text>
        <Link
          title="通貨ペア一覧"
          detail="10ペアのシグナルと判定を俯瞰する"
          onPress={() => navigation.navigate('Watchlist')}
        />
        <Link
          title="条件を満たす組み合わせを探す"
          detail="総当たりで探索し、伏せた期間で検証する"
          onPress={() => navigation.navigate('Scan')}
        />
      </View>
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function Link({
  title,
  detail,
  onPress,
}: {
  title: string;
  detail: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.link} onPress={onPress}>
      <Text style={styles.linkTitle}>{title}</Text>
      <Text style={styles.linkDetail}>{detail}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F1F5F9' },
  content: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    padding: 14,
    gap: 10,
  },
  card: { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 16, gap: 8 },
  cardTitle: { fontSize: 13, fontWeight: '800', color: '#0F172A' },
  pairRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  note: { fontSize: 10, color: '#94A3B8', lineHeight: 15 },
  frameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  frameLabel: { fontSize: 13, fontWeight: '800', color: '#0F172A', width: 52 },
  frameRole: { fontSize: 10, color: '#94A3B8', width: 76 },
  frameDirection: { flex: 1, fontSize: 12, fontWeight: '700' },
  frameAdx: { fontSize: 11, color: '#64748B', fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLabel: { fontSize: 12, color: '#64748B' },
  rowValue: { fontSize: 12, color: '#334155', fontVariant: ['tabular-nums'] },
  link: {
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    padding: 12,
    gap: 2,
  },
  linkTitle: { fontSize: 13, fontWeight: '800', color: '#1D4ED8' },
  linkDetail: { fontSize: 10, color: '#64748B' },
});
