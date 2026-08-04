import { StyleSheet, Text, View } from 'react-native';
import { SignalResult } from '../types';
import { SignalBadge } from './SignalBadge';

export function SignalCard({ signal }: { signal: SignalResult }) {
  const isUp = signal.changePercent >= 0;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View>
          <Text style={styles.rate}>{signal.latestRate.toFixed(4)}</Text>
          <Text style={[styles.change, { color: isUp ? '#15803D' : '#B91C1C' }]}>
            {isUp ? '+' : ''}
            {signal.changePercent.toFixed(2)}% (前の15分足比)
          </Text>
        </View>
        <SignalBadge action={signal.action} />
      </View>

      <View style={styles.statsRow}>
        <Stat label="RSI(14)" value={signal.rsi !== null ? signal.rsi.toFixed(1) : '-'} />
        <Stat
          label="SMA5/20"
          value={
            signal.smaShort !== null && signal.smaLong !== null
              ? `${signal.smaShort.toFixed(3)} / ${signal.smaLong.toFixed(3)}`
              : '-'
          }
        />
        <Stat
          label="MACD Hist"
          value={signal.macdHistogram !== null ? signal.macdHistogram.toFixed(4) : '-'}
        />
      </View>

      <View style={styles.reasons}>
        {signal.reasons.map((reason, index) => (
          <Text key={index} style={styles.reasonText}>
            ・{reason}
          </Text>
        ))}
      </View>

      <Text style={styles.disclaimer}>
        本アプリのシグナルはテクニカル指標に基づく参考情報であり、投資助言ではありません。売買判断はご自身の責任で行ってください。
      </Text>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  rate: {
    fontSize: 28,
    fontWeight: '700',
    color: '#0F172A',
  },
  change: {
    fontSize: 13,
    marginTop: 2,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  stat: {
    flex: 1,
  },
  statLabel: {
    fontSize: 11,
    color: '#64748B',
  },
  statValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
    marginTop: 2,
  },
  reasons: {
    gap: 4,
  },
  reasonText: {
    fontSize: 13,
    color: '#334155',
    lineHeight: 18,
  },
  disclaimer: {
    fontSize: 11,
    color: '#94A3B8',
    lineHeight: 15,
  },
});
