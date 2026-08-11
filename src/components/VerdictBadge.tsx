import { StyleSheet, Text, View } from 'react-native';
import { VerdictLevel } from '../utils/verdict';

const STYLE: Record<VerdictLevel, { label: string; background: string; text: string }> = {
  go: { label: '条件クリア', background: '#DCFCE7', text: '#15803D' },
  weak: { label: 'サンプル不足', background: '#FEF3C7', text: '#B45309' },
  no: { label: '見送り', background: '#F1F5F9', text: '#94A3B8' },
};

/** ウォッチリストで「入っていい / 入るな」を一目で分かるようにする小さなラベル。 */
export function VerdictBadge({ level }: { level: VerdictLevel }) {
  const style = STYLE[level];
  return (
    <View style={[styles.badge, { backgroundColor: style.background }]}>
      <Text style={[styles.text, { color: style.text }]}>{style.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  text: {
    fontSize: 10,
    fontWeight: '700',
  },
});
