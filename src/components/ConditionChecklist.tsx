import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { EntryCondition } from '../utils/marketContext';
import { nextCloseAt } from '../utils/timeframes';

/**
 * エントリー準備の進み具合(仕様4)。
 *
 * 「3 / 5 条件成立」と件数で出す。パーセントにすると勝率と誤読されるため使わない。
 *
 * 未成立の条件は**灰色で埋もれさせない**。一覧で「売り候補」を見て開いた人が
 * 知りたいのは「あと何が足りないのか」だけなので、そこを目立たせる。
 * 加えて、その条件が次に判定し直される時刻までの残り時間を出す。
 * これが無いと「いつ変わるのか分からないまま画面を見続ける」ことになる。
 */

/** 条件ごとに、判定し直される足 */
const RECHECK_FRAME: Record<EntryCondition['key'], '1min' | '5min' | '15min' | '1hour'> = {
  environment: '1hour',
  direction: '15min',
  setup: '5min',
  trigger: '1min',
  edge: '15min',
};

const FRAME_LABEL: Record<string, string> = {
  '1min': '1分足',
  '5min': '5分足',
  '15min': '15分足',
  '1hour': '1時間足',
};

function useCountdown(frame: '1min' | '5min' | '15min' | '1hour' | null): string | null {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!frame) return;
    const id = setInterval(() => tick((v) => v + 1), 1000);
    return () => clearInterval(id);
  }, [frame]);
  if (!frame) return null;
  const remaining = Math.max(0, nextCloseAt(frame).getTime() - Date.now());
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

export function ConditionChecklist({
  conditions,
  metCount,
  totalCount,
}: {
  conditions: EntryCondition[];
  metCount: number;
  totalCount: number;
}) {
  // 未成立のうち、いちばん早く判定し直されるものを「次の見どころ」として出す。
  const pending = conditions.filter((condition) => !condition.met);
  const next = pending[0] ?? null;
  const frame = next ? RECHECK_FRAME[next.key] : null;
  const countdown = useCountdown(frame);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>エントリー準備</Text>
        <Text style={styles.count}>
          {metCount} / {totalCount} 条件成立
        </Text>
      </View>

      {next && frame && (
        <View style={styles.nextCard}>
          <Text style={styles.nextTitle}>あと{pending.length}つ: {next.label}</Text>
          <Text style={styles.nextDetail}>{next.detail}</Text>
          <Text style={styles.nextTimer}>
            次の判定({FRAME_LABEL[frame]}の確定)まで {countdown}
          </Text>
        </View>
      )}

      {conditions.map((condition) => (
        <View
          key={condition.key}
          style={[styles.row, condition === next && styles.rowNext]}
        >
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
  nextCard: {
    backgroundColor: '#FEFCE8',
    borderWidth: 1,
    borderColor: '#FDE047',
    borderRadius: 10,
    padding: 10,
    gap: 2,
  },
  nextTitle: { fontSize: 13, fontWeight: '900', color: '#A16207' },
  nextDetail: { fontSize: 12, color: '#854D0E', lineHeight: 17 },
  nextTimer: {
    fontSize: 11,
    color: '#A16207',
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
  rowNext: {
    backgroundColor: '#FEFCE8',
    borderRadius: 6,
    paddingVertical: 2,
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
