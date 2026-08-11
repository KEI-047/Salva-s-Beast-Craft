import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { CurrencyPair, SignalResult } from '../types';
import { Verdict } from '../utils/verdict';
import { SignalBadge } from './SignalBadge';
import { VerdictBadge } from './VerdictBadge';

type Props = {
  pair: CurrencyPair;
  signal: SignalResult | null;
  /** エントリー3条件の判定結果。まだ算出できていなければ null。 */
  verdict?: Verdict | null;
  /** OANDA構成時の現在値。あれば足の確定値より優先して表示する。 */
  livePrice?: number | null;
  error: string | null;
  onPress: () => void;
};

export function PairListItem({ pair, signal, verdict, livePrice, error, onPress }: Props) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={styles.left}>
        <Text style={styles.label}>{pair.label}</Text>
        <Text style={styles.nameJa}>{pair.nameJa}</Text>
        {signal && (
          <Text
            style={[
              styles.change,
              { color: signal.changePercent >= 0 ? '#15803D' : '#B91C1C' },
            ]}
          >
            {signal.changePercent >= 0 ? '+' : ''}
            {signal.changePercent.toFixed(2)}%
          </Text>
        )}
        {error && <Text style={styles.error}>{error}</Text>}
      </View>

      <View style={styles.right}>
        {signal ? (
          <>
            <Text style={[styles.rate, livePrice != null && styles.rateLive]}>
              {(livePrice ?? signal.latestRate).toFixed(4)}
            </Text>
            <View style={styles.badgeRow}>
              {verdict && <VerdictBadge level={verdict.level} />}
              <SignalBadge action={signal.action} />
            </View>
          </>
        ) : !error ? (
          <ActivityIndicator size="small" color="#64748B" />
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  left: {
    flex: 1,
    gap: 2,
    paddingRight: 8,
  },
  right: {
    alignItems: 'flex-end',
    gap: 6,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  label: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  nameJa: {
    fontSize: 12,
    color: '#64748B',
  },
  change: {
    fontSize: 12,
  },
  error: {
    fontSize: 11,
    color: '#B91C1C',
  },
  rate: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0F172A',
  },
  rateLive: {
    fontVariant: ['tabular-nums'],
  },
});
