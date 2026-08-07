import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LivePrice } from '../api/oanda';

type Direction = 'up' | 'down' | 'flat';

function formatRate(value: number): string {
  return value >= 20 ? value.toFixed(3) : value.toFixed(5);
}

/** スプレッド(ask-bid)をpips換算する。対円は0.01、それ以外は0.0001が1pip。 */
function toPips(spread: number, mid: number): number {
  const pipSize = mid >= 20 ? 0.01 : 0.0001;
  return spread / pipSize;
}

export function LivePriceBar({ price, live }: { price: LivePrice | null; live: boolean }) {
  const [direction, setDirection] = useState<Direction>('flat');
  const previousMid = useRef<number | null>(null);

  useEffect(() => {
    if (!price) return;
    const previous = previousMid.current;
    if (previous !== null && previous !== price.mid) {
      setDirection(price.mid > previous ? 'up' : 'down');
    }
    previousMid.current = price.mid;
  }, [price]);

  if (!price) return null;

  const color = direction === 'up' ? '#15803D' : direction === 'down' ? '#B91C1C' : '#0F172A';
  const arrow = direction === 'up' ? '▲' : direction === 'down' ? '▼' : '';
  const spread = toPips(price.ask - price.bid, price.mid);

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: live ? '#22C55E' : '#94A3B8' }]} />
          <Text style={styles.label}>
            {live ? 'リアルタイム' : '接続待ち'}
            {!price.tradeable && live ? '(市場クローズ)' : ''}
          </Text>
        </View>
        <Text style={styles.spread}>スプレッド {spread.toFixed(1)}pips</Text>
      </View>

      <Text style={[styles.mid, { color }]}>
        {formatRate(price.mid)} <Text style={styles.arrow}>{arrow}</Text>
      </Text>

      <View style={styles.bidAskRow}>
        <View style={styles.bidAsk}>
          <Text style={styles.bidAskLabel}>BID(売値)</Text>
          <Text style={styles.bidAskValue}>{formatRate(price.bid)}</Text>
        </View>
        <View style={[styles.bidAsk, { alignItems: 'flex-end' }]}>
          <Text style={styles.bidAskLabel}>ASK(買値)</Text>
          <Text style={styles.bidAskValue}>{formatRate(price.ask)}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    gap: 6,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  spread: {
    fontSize: 11,
    color: '#94A3B8',
  },
  mid: {
    fontSize: 32,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  arrow: {
    fontSize: 18,
  },
  bidAskRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  bidAsk: {
    flex: 1,
  },
  bidAskLabel: {
    fontSize: 10,
    color: '#94A3B8',
  },
  bidAskValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#334155',
    fontVariant: ['tabular-nums'],
  },
});
