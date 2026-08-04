import { StyleSheet, Text, View } from 'react-native';
import { SignalAction } from '../types';

const LABELS: Record<SignalAction, string> = {
  BUY: '買い',
  SELL: '売り',
  HOLD: '様子見',
};

const COLORS: Record<SignalAction, { background: string; text: string }> = {
  BUY: { background: '#DCFCE7', text: '#15803D' },
  SELL: { background: '#FEE2E2', text: '#B91C1C' },
  HOLD: { background: '#F1F5F9', text: '#475569' },
};

export function SignalBadge({ action }: { action: SignalAction }) {
  const colors = COLORS[action];
  return (
    <View style={[styles.badge, { backgroundColor: colors.background }]}>
      <Text style={[styles.text, { color: colors.text }]}>{LABELS[action]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
  },
  text: {
    fontSize: 13,
    fontWeight: '700',
  },
});
