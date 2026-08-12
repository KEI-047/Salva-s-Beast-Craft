import { Pressable, StyleSheet, Text, View } from 'react-native';
import { DailySummary, Trade } from '../state/tradeHistoryStore';

/**
 * 決済直後の結果(仕様12)。
 * 実績の表示であって、将来の予測はしない。
 */
export function TradeCompleteCard({
  trade,
  capitalAfter,
  daily,
  onNext,
}: {
  trade: Trade;
  capitalAfter: number;
  daily: DailySummary;
  onNext: () => void;
}) {
  const win = trade.result === 'WIN';
  const color = win ? '#15803D' : trade.result === 'LOSS' ? '#B91C1C' : '#64748B';
  const capitalBefore = capitalAfter - trade.pnlYen;

  return (
    <View style={styles.wrap}>
      <View style={[styles.card, { borderColor: color }]}>
        <Text style={styles.heading}>TRADE COMPLETE</Text>
        <Text style={[styles.amount, { color }]}>
          {trade.pnlYen >= 0 ? '+' : '−'}
          {Math.abs(Math.round(trade.pnlYen)).toLocaleString()}円
        </Text>
        <Text style={[styles.result, { color }]}>
          {trade.result} / {trade.pnlPips >= 0 ? '+' : '−'}
          {Math.abs(trade.pnlPips).toFixed(1)}pips
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>資金</Text>
        <Text style={styles.capital}>
          {Math.round(capitalBefore).toLocaleString()}円 →{' '}
          <Text style={{ color }}>{Math.round(capitalAfter).toLocaleString()}円</Text>
        </Text>
        <Text style={styles.today}>
          本日 {daily.trades}戦 {daily.wins}勝 {daily.losses}敗
        </Text>
        <Text style={styles.note}>
          次回の推奨数量は、この資金をもとに再計算されます。
        </Text>
      </View>

      <Pressable style={styles.button} onPress={onNext}>
        <Text style={styles.buttonText}>次のチャンスを探す</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#E2E8F0',
    padding: 18,
    alignItems: 'center',
    gap: 4,
  },
  heading: { fontSize: 12, fontWeight: '800', color: '#64748B', letterSpacing: 1 },
  amount: { fontSize: 38, fontWeight: '900' },
  result: { fontSize: 14, fontWeight: '800' },
  label: { fontSize: 11, color: '#64748B' },
  capital: { fontSize: 18, fontWeight: '800', color: '#0F172A' },
  today: { fontSize: 13, color: '#334155', marginTop: 4 },
  note: { fontSize: 10, color: '#94A3B8', textAlign: 'center', marginTop: 4 },
  button: {
    backgroundColor: '#2563EB',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  buttonText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
});
