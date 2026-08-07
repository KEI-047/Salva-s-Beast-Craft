import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MarketRegime, StrategyMode } from '../types';
import { setStrategyMode, useStrategyMode } from '../utils/strategyStore';

const OPTIONS: { mode: StrategyMode; label: string; hint: string }[] = [
  { mode: 'auto', label: '自動', hint: '相場つきを判定して順張り/逆張りを自動で切り替えます' },
  { mode: 'trend', label: '順張り', hint: '強いトレンドに乗ります。RSIの高さを勢いとみなします' },
  { mode: 'reversion', label: '逆張り', hint: '揉み合い向け。買われ過ぎ/売られ過ぎの反転を狙います' },
];

const REGIME_LABEL: Record<MarketRegime, string> = {
  trend: 'トレンド相場',
  range: '揉み合い相場',
};

export function StrategySelector({
  regime,
  efficiencyRatio,
}: {
  regime?: MarketRegime | null;
  efficiencyRatio?: number | null;
}) {
  const mode = useStrategyMode();
  const active = OPTIONS.find((option) => option.mode === mode) ?? OPTIONS[0];

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {OPTIONS.map((option) => {
          const selected = option.mode === mode;
          return (
            <Pressable
              key={option.mode}
              style={[styles.button, selected && styles.buttonActive]}
              onPress={() => setStrategyMode(option.mode)}
            >
              <Text style={[styles.buttonText, selected && styles.buttonTextActive]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.hint}>{active.hint}</Text>
      {mode === 'auto' && regime && (
        <Text style={styles.regime}>
          現在は{REGIME_LABEL[regime]}と判定 → {regime === 'trend' ? '順張り' : '逆張り'}で判定中
          {efficiencyRatio !== null && efficiencyRatio !== undefined
            ? ` (効率比 ${efficiencyRatio.toFixed(2)})`
            : ''}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    backgroundColor: '#E2E8F0',
    borderRadius: 10,
    padding: 3,
    gap: 3,
  },
  button: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  buttonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  buttonTextActive: {
    color: '#0F172A',
    fontWeight: '800',
  },
  hint: {
    fontSize: 11,
    color: '#94A3B8',
    lineHeight: 15,
  },
  regime: {
    fontSize: 11,
    color: '#2563EB',
    fontWeight: '600',
  },
});
