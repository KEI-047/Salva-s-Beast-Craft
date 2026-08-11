import { StyleSheet, Text, View } from 'react-native';
import { Verdict, VerdictLevel } from '../utils/verdict';

const THEME: Record<
  VerdictLevel,
  { mark: string; background: string; border: string; accent: string }
> = {
  go: { mark: '○', background: '#F0FDF4', border: '#86EFAC', accent: '#15803D' },
  weak: { mark: '△', background: '#FFFBEB', border: '#FCD34D', accent: '#B45309' },
  no: { mark: '×', background: '#FEF2F2', border: '#FCA5A5', accent: '#B91C1C' },
};

/**
 * 「結局いま入っていいのか」を最初に見せるカード。
 * 数値の解釈をユーザーに任せず、判定と、その根拠になった条件の合否を並べる。
 */
export function EntryVerdictCard({
  verdict,
  costKnown,
}: {
  verdict: Verdict;
  costKnown: boolean;
}) {
  const theme = THEME[verdict.level];

  return (
    <View style={[styles.card, { backgroundColor: theme.background, borderColor: theme.border }]}>
      <View style={styles.headline}>
        <Text style={[styles.mark, { color: theme.accent }]}>{theme.mark}</Text>
        <View style={styles.headlineText}>
          <Text style={[styles.title, { color: theme.accent }]}>{verdict.headline}</Text>
          <Text style={styles.reason}>{verdict.reason}</Text>
        </View>
      </View>

      {verdict.checks.length > 0 && (
        <View style={styles.checkList}>
          {verdict.checks.map((check) => (
            <View key={check.label} style={styles.checkRow}>
              <Text style={[styles.checkMark, { color: check.passed ? '#15803D' : '#B91C1C' }]}>
                {check.passed ? '○' : '×'}
              </Text>
              <Text style={styles.checkLabel}>{check.label}</Text>
              <Text
                style={[styles.checkActual, { color: check.passed ? '#15803D' : '#B91C1C' }]}
              >
                {check.actual}
              </Text>
              <Text style={styles.checkRequired}>/ {check.required}</Text>
            </View>
          ))}
        </View>
      )}

      {verdict.alternative && <Text style={styles.alternative}>{verdict.alternative}</Text>}

      <Text style={styles.note}>
        3条件をすべて満たした時だけ「条件クリア」になります。勝率は方向しか数えないため、
        勝率が足りていても値幅で負けることがあります。そのため
        {costKnown
          ? '期待値はスプレッドを差し引いて判定しています。'
          : '期待値も併せて判定しています(現在値が取れていないため、スプレッドは差し引いていません)。'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  headline: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  mark: {
    fontSize: 34,
    fontWeight: '800',
    lineHeight: 38,
  },
  headlineText: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: 19,
    fontWeight: '800',
  },
  reason: {
    fontSize: 12,
    color: '#334155',
    lineHeight: 18,
  },
  checkList: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 6,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  checkMark: {
    fontSize: 13,
    fontWeight: '800',
    width: 14,
  },
  checkLabel: {
    flex: 1,
    fontSize: 11,
    color: '#475569',
  },
  checkActual: {
    fontSize: 12,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  checkRequired: {
    fontSize: 10,
    color: '#94A3B8',
  },
  alternative: {
    fontSize: 12,
    color: '#1D4ED8',
    lineHeight: 18,
    fontWeight: '600',
  },
  note: {
    fontSize: 10,
    color: '#94A3B8',
    lineHeight: 15,
  },
});
