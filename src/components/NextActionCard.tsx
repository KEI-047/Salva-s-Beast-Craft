import { StyleSheet, Text, View } from 'react-native';
import { ActionKind, NextAction } from '../utils/nextAction';

/**
 * 画面で最も大きい要素(仕様1・3)。
 * 開いて3秒で「今なにをするか」が分かることだけを目的にしている。
 * 指標の数字はここに出さない。
 *
 * 色だけで判断させない(仕様30)ため、絵文字・日本語・英語ステータスを併記する。
 */

const THEME: Record<ActionKind, { bg: string; border: string; text: string; sub: string }> = {
  ENTRY_NOW: { bg: '#052E16', border: '#16A34A', text: '#FFFFFF', sub: '#86EFAC' },
  EXIT_NOW: { bg: '#450A0A', border: '#DC2626', text: '#FFFFFF', sub: '#FCA5A5' },
  HOLD: { bg: '#EFF6FF', border: '#93C5FD', text: '#1D4ED8', sub: '#3B82F6' },
  READY: { bg: '#FEFCE8', border: '#FDE047', text: '#A16207', sub: '#CA8A04' },
  WAIT: { bg: '#FEFCE8', border: '#FDE047', text: '#A16207', sub: '#CA8A04' },
  NO_TRADE: { bg: '#F8FAFC', border: '#CBD5E1', text: '#475569', sub: '#64748B' },
  DATA_ISSUE: { bg: '#FFFBEB', border: '#FCD34D', text: '#B45309', sub: '#D97706' },
};

/** ENTRY NOW / EXIT NOW は反転配色で、他の状態と見間違えないようにする。 */
const INVERTED: ActionKind[] = ['ENTRY_NOW', 'EXIT_NOW'];

export function NextActionCard({ action }: { action: NextAction }) {
  const theme = THEME[action.kind];
  const inverted = INVERTED.includes(action.kind);

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.bg, borderColor: theme.border },
        inverted && styles.cardLarge,
      ]}
    >
      <Text style={[styles.label, { color: theme.text }, inverted && styles.labelLarge]}>
        {action.emoji} {action.label}
      </Text>
      <Text style={[styles.sub, { color: theme.sub }]}>{action.sub}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    borderWidth: 2,
    paddingVertical: 22,
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 4,
  },
  cardLarge: {
    paddingVertical: 30,
  },
  label: {
    fontSize: 34,
    fontWeight: '900',
    textAlign: 'center',
  },
  labelLarge: {
    fontSize: 42,
  },
  sub: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
});
