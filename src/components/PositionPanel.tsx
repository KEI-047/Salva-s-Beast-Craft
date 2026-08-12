import { StyleSheet, Text, View } from 'react-native';
import { OpenPosition, positionPnl } from '../state/positionStore';
import { MarketContext, reversalRisk, trendStrength } from '../utils/marketContext';

/**
 * 保有中の状態(仕様9)。
 * ポジションを持った瞬間、ホームはこの画面に切り替わる。
 * ユーザーは HOLD の間、基本的に何もしない。
 */

function formatRate(value: number): string {
  return value >= 20 ? value.toFixed(3) : value.toFixed(5);
}

/** 含み益が伸びたら損失を限定するためにSLを建値方向へ引き上げる。 */
export function protectiveStop(position: OpenPosition, price: number): number | null {
  const risk = Math.abs(position.entryPrice - position.sl);
  if (risk <= 0) return null;
  const gain =
    position.direction === 'BUY' ? price - position.entryPrice : position.entryPrice - price;
  // リスクぶん以上に伸びたら建値へ、2倍伸びたら利益を半分確保する位置へ
  if (gain < risk) return null;
  const lock = gain >= risk * 2 ? gain / 2 : 0;
  return position.direction === 'BUY'
    ? position.entryPrice + lock
    : position.entryPrice - lock;
}

export function PositionPanel({
  position,
  price,
  context,
}: {
  position: OpenPosition;
  price: number | null;
  context: MarketContext | null;
}) {
  const pnl = price !== null ? positionPnl(position, price) : null;
  // 表示は円単位に丸めるので、符号と色も丸めた値で決める。
  // そうしないと -0.0001円が「−0円」と赤で出る。
  const roundedYen = Math.round(pnl?.pnlYen ?? 0);
  const profitable = roundedYen >= 0;
  const guard = price !== null ? protectiveStop(position, price) : null;

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <Text style={styles.title}>
          {position.pairLabel} {position.direction === 'BUY' ? '買い' : '売り'}保有中
        </Text>
        <Text style={styles.pnlLabel}>現在損益</Text>
        <Text style={[styles.pnl, { color: profitable ? '#15803D' : '#B91C1C' }]}>
          {pnl === null
            ? '—'
            : `${profitable ? '+' : '−'}${Math.abs(roundedYen).toLocaleString()}円`}
        </Text>
        <Text style={[styles.pips, { color: profitable ? '#15803D' : '#B91C1C' }]}>
          {pnl === null
            ? ''
            : `${pnl.pnlPips.toFixed(1) === '-0.0' || pnl.pnlPips >= 0 ? '+' : '−'}${Math.abs(pnl.pnlPips).toFixed(1)} pips`}
        </Text>
      </View>

      <View style={styles.card}>
        <Row label="ENTRY" value={formatRate(position.entryPrice)} />
        <Row label="現在" value={price === null ? '—' : formatRate(price)} strong />
        <Row label="TP" value={formatRate(position.tp)} color="#15803D" />
        <Row label="SL" value={formatRate(position.sl)} color="#B91C1C" />
        {guard !== null && (
          <Row label="推奨保護SL" value={formatRate(guard)} color="#2563EB" />
        )}
        <Row label="数量" value={`${position.units.toLocaleString()}通貨`} />
      </View>

      {context && (
        <View style={styles.card}>
          <Meter label="トレンド" value={trendStrength(context)} color="#2563EB"
            words={['弱い', 'ふつう', '強い']} />
          <Meter label="反転リスク" value={reversalRisk(context)} color="#B45309"
            words={['低い', 'ふつう', '高い']} />
        </View>
      )}
    </View>
  );
}

function Row({
  label,
  value,
  strong = false,
  color = '#0F172A',
}: {
  label: string;
  value: string;
  strong?: boolean;
  color?: string;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, strong && styles.rowValueStrong, { color }]}>{value}</Text>
    </View>
  );
}

/** バーだけでなく言葉でも出す(色や長さだけに判断を委ねない)。 */
function Meter({
  label,
  value,
  color,
  words,
}: {
  label: string;
  value: number;
  color: string;
  words: [string, string, string] | string[];
}) {
  const filled = Math.round(value * 10);
  const word = value < 0.34 ? words[0] : value < 0.67 ? words[1] : words[2];
  return (
    <View style={styles.meterRow}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.meterWord, { color }]}>{word}</Text>
      <View style={styles.meterTrack}>
        <View style={[styles.meterFill, { width: `${filled * 10}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  title: { fontSize: 13, fontWeight: '800', color: '#0F172A' },
  pnlLabel: { fontSize: 11, color: '#64748B' },
  pnl: { fontSize: 30, fontWeight: '900', fontVariant: ['tabular-nums'] },
  pips: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowLabel: { fontSize: 12, color: '#64748B' },
  rowValue: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  rowValueStrong: { fontSize: 17, fontWeight: '900' },
  meterRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  meterWord: { fontSize: 12, fontWeight: '800', width: 56 },
  meterTrack: {
    flex: 1,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#E2E8F0',
    overflow: 'hidden',
  },
  meterFill: { height: '100%', borderRadius: 5 },
});
