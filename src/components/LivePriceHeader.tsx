import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LivePrice } from '../api/oanda';
import { PairSelector } from './PairSelector';
import { LIVE_POLL_MS } from '../utils/useLivePrices';
import { pipSize } from '../utils/timeframes';

/**
 * ホームの上部(仕様3の ①通貨ペア ②接続状況 ③現在価格)。
 *
 * v2 の最初の版では価格を黒い数字で置いただけにしていたが、それだと
 * 更新されていても止まって見える。動いていることが分かるように、
 * 直前の値と比べた向き(▲▼と色)・BID/ASK・スプレッド・更新間隔まで出す。
 */

type Direction = 'up' | 'down' | 'flat';

function formatRate(value: number): string {
  return value >= 20 ? value.toFixed(3) : value.toFixed(5);
}

export function LivePriceHeader({
  price,
  live,
  ageSeconds,
  healthy,
  lockPair,
}: {
  price: LivePrice | null;
  live: boolean;
  ageSeconds: number | null;
  /** データが判定に使える状態か。false なら「接続待ち」表示にする */
  healthy: boolean;
  /** 保有中はペアを切り替えさせない */
  lockPair: boolean;
}) {
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

  const streaming = live && healthy;
  const color =
    direction === 'up' ? '#15803D' : direction === 'down' ? '#B91C1C' : '#0F172A';
  const arrow = direction === 'up' ? '▲' : direction === 'down' ? '▼' : '';
  const spreadPips =
    price === null ? null : (price.ask - price.bid) / pipSize(price.mid);

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <PairSelector disabled={lockPair} />
        <View style={styles.statusRow}>
          <View
            style={[styles.dot, { backgroundColor: streaming ? '#22C55E' : '#94A3B8' }]}
          />
          <Text style={[styles.status, streaming && styles.statusLive]}>
            {streaming ? `リアルタイム更新中(${LIVE_POLL_MS / 1000}秒ごと)` : '接続待ち'}
          </Text>
        </View>
      </View>

      <Text style={[styles.price, { color }]}>
        {price === null ? '—' : formatRate(price.mid)}
        <Text style={styles.arrow}>{arrow ? ` ${arrow}` : ''}</Text>
      </Text>

      <View style={styles.detailRow}>
        <Text style={styles.detail}>
          BID {price === null ? '—' : formatRate(price.bid)}
        </Text>
        <Text style={styles.detail}>
          ASK {price === null ? '—' : formatRate(price.ask)}
        </Text>
        <Text style={styles.detail}>
          スプレッド {spreadPips === null ? '—' : `${spreadPips.toFixed(1)}pips`}
        </Text>
      </View>

      <Text style={styles.updated}>
        {ageSeconds === null
          ? '最終更新 —'
          : `最終更新 ${Math.max(0, Math.round(ageSeconds))}秒前`}
        {price !== null && !price.tradeable ? ' / 市場クローズ' : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 2 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  status: { fontSize: 10, fontWeight: '700', color: '#94A3B8' },
  statusLive: { color: '#15803D' },
  price: {
    fontSize: 44,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
    marginTop: 4,
  },
  arrow: { fontSize: 22 },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 14,
  },
  detail: { fontSize: 11, color: '#64748B', fontVariant: ['tabular-nums'] },
  updated: { fontSize: 10, color: '#94A3B8', textAlign: 'center' },
});
