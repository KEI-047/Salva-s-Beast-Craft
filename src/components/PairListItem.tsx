import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { CurrencyPair, SignalResult } from '../types';
import { PairStatus, WatchlistLevel } from '../utils/watchlistStatus';

/**
 * 一覧の1行。
 *
 * 「取引していいか / 様子見か / 止まっているか」が一目で分かることだけを目的にする。
 * 以前は「シグナル」と「判定」の2つのバッジを出していたが、2つ並ぶと結局
 * 読み合わせが要る。1行につき結論は1つにした。
 */

const THEME: Record<WatchlistLevel, { bg: string; border: string; text: string }> = {
  candidate: { bg: '#F0FDF4', border: '#86EFAC', text: '#15803D' },
  watch: { bg: '#FFFFFF', border: '#E2E8F0', text: '#A16207' },
  stopped: { bg: '#F8FAFC', border: '#E2E8F0', text: '#64748B' },
};

type Props = {
  pair: CurrencyPair;
  signal: SignalResult | null;
  /** 一覧での判定。まだ算出できていなければ null */
  status?: PairStatus | null;
  livePrice?: number | null;
  error: string | null;
  onPress: () => void;
};

export function PairListItem({ pair, signal, status, livePrice, error, onPress }: Props) {
  const theme = THEME[status?.level ?? 'watch'];

  return (
    <Pressable
      style={[
        styles.row,
        { backgroundColor: theme.bg, borderColor: theme.border },
        status?.level === 'candidate' && styles.rowCandidate,
      ]}
      onPress={onPress}
    >
      <View style={styles.top}>
        <View style={styles.left}>
          <Text style={styles.label}>{pair.label}</Text>
          <Text style={styles.nameJa}>{pair.nameJa}</Text>
        </View>

        <View style={styles.right}>
          {signal ? (
            <Text style={[styles.rate, livePrice != null && styles.rateLive]}>
              {(livePrice ?? signal.latestRate).toFixed(4)}
            </Text>
          ) : !error ? (
            <ActivityIndicator size="small" color="#64748B" />
          ) : null}
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
        </View>
      </View>

      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : status ? (
        <View style={styles.statusRow}>
          <Text style={[styles.statusLabel, { color: theme.text }]}>
            {status.emoji} {status.label}
          </Text>
          <Text style={styles.statusDetail} numberOfLines={1}>
            {status.level === 'candidate'
              ? `${status.metCount} / ${status.totalCount} 条件成立`
              : status.detail}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 6,
  },
  rowCandidate: {
    borderWidth: 2,
  },
  top: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  left: {
    flex: 1,
    gap: 1,
    paddingRight: 8,
  },
  right: {
    alignItems: 'flex-end',
    gap: 1,
  },
  label: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  nameJa: {
    fontSize: 11,
    color: '#64748B',
  },
  change: {
    fontSize: 11,
  },
  error: {
    fontSize: 11,
    color: '#B91C1C',
  },
  rate: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  rateLive: {
    fontVariant: ['tabular-nums'],
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusLabel: {
    fontSize: 14,
    fontWeight: '800',
  },
  statusDetail: {
    flex: 1,
    fontSize: 11,
    color: '#64748B',
    textAlign: 'right',
  },
});
