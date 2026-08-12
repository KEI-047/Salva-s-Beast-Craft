import { StyleSheet, Text, View } from 'react-native';
import { SizingResult } from '../utils/positionSizing';

/**
 * OANDAへ入力する内容(仕様6)。
 * この画面だけ見れば、売買・数量・TP・SL・最大損失・利益目標が分かるようにする。
 */

function formatRate(value: number): string {
  return value >= 20 ? value.toFixed(3) : value.toFixed(5);
}

function yen(value: number): string {
  const rounded = Math.round(value);
  return `${rounded >= 0 ? '+' : '−'}${Math.abs(rounded).toLocaleString()}円`;
}

export function OrderTicket({
  direction,
  sizing,
  entryLow,
  entryHigh,
  currentPrice,
}: {
  direction: 'BUY' | 'SELL';
  sizing: SizingResult;
  entryLow: number;
  entryHigh: number;
  currentPrice: number | null;
}) {
  const buy = direction === 'BUY';

  return (
    <View style={styles.wrap}>
      <View style={styles.zoneCard}>
        <Text style={styles.zoneLabel}>推奨エントリーゾーン</Text>
        <Text style={styles.zoneValue}>
          {formatRate(entryLow)} 〜 {formatRate(entryHigh)}
        </Text>
        {currentPrice !== null && (
          <Text style={styles.zoneCurrent}>現在 {formatRate(currentPrice)}</Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>OANDA入力内容</Text>
        <Row label="売買" value={buy ? '買' : '売'} strong color={buy ? '#15803D' : '#B91C1C'} />
        <Row label="数量" value={`${sizing.units.toLocaleString()}通貨`} strong />
        <Row label="利確 TP" value={formatRate(sizing.tp)} />
        <Row label="損切 SL" value={formatRate(sizing.sl)} />
      </View>

      <View style={styles.card}>
        <Row label="最大損失" value={yen(-sizing.maxLossYen)} color="#B91C1C" strong />
        <Row label="利益目標" value={yen(sizing.targetProfitYen)} color="#15803D" strong />
        <Row label="RR" value={`1 : ${sizing.riskReward}`} />
        <Text style={styles.note}>
          SL {sizing.slPips.toFixed(1)}pips / TP {sizing.tpPips.toFixed(1)}pips。
          数量は資金とリスク率から算出し、1,000通貨単位に切り下げています。
        </Text>
      </View>
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
      <Text style={[styles.rowValue, strong && styles.rowValueStrong, { color }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  zoneCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    gap: 2,
  },
  zoneLabel: { fontSize: 11, color: '#64748B' },
  zoneValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
    fontVariant: ['tabular-nums'],
  },
  zoneCurrent: { fontSize: 12, color: '#64748B', fontVariant: ['tabular-nums'] },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  cardTitle: { fontSize: 13, fontWeight: '800', color: '#0F172A' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowLabel: { fontSize: 12, color: '#64748B' },
  rowValue: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  rowValueStrong: { fontSize: 18, fontWeight: '900' },
  note: { fontSize: 10, color: '#94A3B8', lineHeight: 15 },
});
