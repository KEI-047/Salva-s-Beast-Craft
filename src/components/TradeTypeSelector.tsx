import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BinaryHorizon } from '../types';
import {
  horizonLabel,
  HORIZON_OPTIONS,
  setTradeSettings,
  useTradeSettings,
} from '../utils/tradeSettings';

/**
 * 保有時間の選択。
 *
 * v2 は FX 専用。バイナリーは判定時刻が固定で、リアルタイムに追随する設計と
 * 噛み合わないため画面から外した。
 *
 * 保有時間を15分に固定する理由は無い。スプレッドは保有時間によらず1往復ぶんしか
 * かからないので、長く持つほど同じコストに対して値幅が大きくなる。
 * どれが有効かは分析タブの総当たり探索で確かめられる。
 */
export function TradeTypeSelector({ compact = false }: { compact?: boolean }) {
  const settings = useTradeSettings();

  return (
    <View style={styles.wrap}>
      <View style={styles.settingRow}>
        <Text style={styles.settingLabel}>保有時間</Text>
        {HORIZON_OPTIONS.map((horizonBars: BinaryHorizon) => {
          const selected = horizonBars === settings.horizonBars;
          return (
            <Pressable
              key={horizonBars}
              style={[styles.chip, selected && styles.chipActive]}
              onPress={() => setTradeSettings({ horizonBars })}
            >
              <Text style={[styles.chipText, selected && styles.chipTextActive]}>
                {horizonLabel(horizonBars)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.summary}>
        FX / {horizonLabel(settings.horizonBars)}保有 → 必要勝率 40.0%
      </Text>

      {!compact && (
        <Text style={styles.hint}>
          値幅で損益が決まるため、必要勝率は保有時間によらず40%(リスクリワード
          1:1.5)です。統計の集計期間もこの設定に合わせて変わります。
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  settingLabel: { fontSize: 11, color: '#64748B', width: 60 },
  chip: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
  },
  chipActive: { backgroundColor: '#2563EB' },
  chipText: { fontSize: 12, fontWeight: '600', color: '#475569' },
  chipTextActive: { color: '#FFFFFF', fontWeight: '800' },
  summary: { fontSize: 11, color: '#2563EB', fontWeight: '700' },
  hint: { fontSize: 11, color: '#94A3B8', lineHeight: 15 },
});
