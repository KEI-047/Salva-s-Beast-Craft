import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatClock, formatCountdown, nextBarCloseAt } from '../utils/statistics';

// 残り1分を切ったら強調する(エントリー準備の合図)
const IMMINENT_MS = 60 * 1000;

export function NextBarCountdown({ compact = false }: { compact?: boolean }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const closeAt = nextBarCloseAt(new Date(now));
  const remaining = closeAt.getTime() - now;
  const imminent = remaining <= IMMINENT_MS;

  return (
    <View style={[styles.card, compact && styles.cardCompact, imminent && styles.cardImminent]}>
      <View style={styles.labelRow}>
        <Text style={[styles.label, imminent && styles.labelImminent]}>次のエントリー時刻</Text>
        <Text style={[styles.clock, imminent && styles.clockImminent]}>{formatClock(closeAt)}</Text>
      </View>
      <Text style={[styles.countdown, imminent && styles.countdownImminent]}>
        {formatCountdown(remaining)}
      </Text>
      <Text style={styles.hint}>
        {imminent ? 'まもなく15分足が確定します' : '15分足の確定(00/15/30/45分)まで'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#0F172A',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  cardCompact: {
    paddingVertical: 10,
  },
  cardImminent: {
    backgroundColor: '#1D4ED8',
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '600',
  },
  labelImminent: {
    color: '#DBEAFE',
  },
  clock: {
    fontSize: 13,
    color: '#E2E8F0',
    fontWeight: '700',
  },
  clockImminent: {
    color: '#FFFFFF',
  },
  countdown: {
    fontSize: 34,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 1,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  countdownImminent: {
    color: '#FFFFFF',
  },
  hint: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 2,
  },
});
