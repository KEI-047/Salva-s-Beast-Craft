import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { EntryLatch } from '../state/entryLatchStore';
import { OrderTicket } from './OrderTicket';

/**
 * 「さっき出た指示」を記録するためのカード(エントリーラッチの表示)。
 *
 * 指示が出た直後にOANDAで注文して戻ってくると、1分足が動いて画面は
 * 「待つ」に変わっていることがある。その時にこのカードが残っていないと、
 * 実際に持ったポジションを登録できず、決済ナビが出ないまま放置される。
 *
 * ここは「今すぐ入れ」という指示ではない。すでに入れたなら記録し、
 * 入れていないなら消す——そのための場所であることを文言で明示する。
 */

function two(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function PendingEntryCard({
  latch,
  currentPrice,
  onEntered,
  onDismiss,
}: {
  latch: EntryLatch;
  currentPrice: number | null;
  onEntered: () => void;
  onDismiss: () => void;
}) {
  // 残り時間だけは秒で動かす。ラッチ自体の消滅はストア側のタイマーが行う。
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remaining = Math.max(0, latch.expiresAt - now);
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  const buy = latch.direction === 'BUY';

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          さきほどの{buy ? '買い' : '売り'}指示
        </Text>
        <Text style={styles.headerTime}>
          残り {minutes}:{two(seconds)}
        </Text>
      </View>

      <Text style={styles.note}>
        そのあと条件が変わったため、指示は取り下げています。
        すでにOANDAで注文したぶんだけ記録してください。
        まだ注文していなければ「注文していない」を押してください。
      </Text>

      <OrderTicket
        direction={latch.direction}
        sizing={latch.sizing}
        entryLow={latch.entryLow}
        entryHigh={latch.entryHigh}
        currentPrice={currentPrice}
      />

      <View style={styles.buttons}>
        <Pressable style={[styles.button, styles.dismiss]} onPress={onDismiss}>
          <Text style={styles.dismissText}>注文していない</Text>
        </Pressable>
        <Pressable style={[styles.button, styles.primary]} onPress={onEntered}>
          <Text style={styles.primaryText}>エントリーした</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 10,
    borderWidth: 2,
    borderColor: '#FDBA74',
    backgroundColor: '#FFF7ED',
    borderRadius: 16,
    padding: 12,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerTitle: { fontSize: 14, fontWeight: '900', color: '#9A3412' },
  headerTime: { fontSize: 12, fontWeight: '700', color: '#C2410C', fontVariant: ['tabular-nums'] },
  note: { fontSize: 11, color: '#9A3412', lineHeight: 17 },
  buttons: { flexDirection: 'row', gap: 10 },
  button: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  dismiss: { backgroundColor: '#E2E8F0' },
  dismissText: { fontSize: 14, fontWeight: '700', color: '#475569' },
  primary: { backgroundColor: '#15803D' },
  primaryText: { fontSize: 15, fontWeight: '900', color: '#FFFFFF' },
});
