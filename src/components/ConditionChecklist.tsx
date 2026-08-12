import { StyleSheet, Text, View } from 'react-native';
import { EntryCondition } from '../utils/marketContext';

/**
 * エントリー準備の進み具合(仕様4)。
 *
 * 「3 / 5 条件成立」と件数で出す。パーセントにすると勝率と誤読されるため使わない。
 */
export function ConditionChecklist({
  conditions,
  metCount,
  totalCount,
}: {
  conditions: EntryCondition[];
  metCount: number;
  totalCount: number;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>エントリー準備</Text>
        <Text style={styles.count}>
          {metCount} / {totalCount} 条件成立
        </Text>
      </View>

      {conditions.map((condition) => (
        <View key={condition.key} style={styles.row}>
          <Text style={[styles.mark, { color: condition.met ? '#15803D' : '#94A3B8' }]}>
            {condition.met ? '✓' : '○'}
          </Text>
          <Text style={styles.label}>{condition.label}</Text>
          <Text
            style={[styles.status, { color: condition.met ? '#15803D' : '#64748B' }]}
            numberOfLines={2}
          >
            {condition.met ? '✓' : condition.detail || '待機中'}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  title: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  count: {
    fontSize: 13,
    fontWeight: '800',
    color: '#2563EB',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mark: {
    fontSize: 14,
    fontWeight: '800',
    width: 16,
  },
  label: {
    fontSize: 12,
    color: '#334155',
    width: 108,
  },
  status: {
    flex: 1,
    fontSize: 11,
    textAlign: 'right',
  },
});
