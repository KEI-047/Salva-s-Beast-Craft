import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CONTENT_MAX_WIDTH } from '../constants/layout';
import {
  CAPITAL_MILESTONES,
  milestoneProgress,
  resetCapital,
  setAccount,
  useAccount,
} from '../state/accountStore';
import { summarise, useTrades } from '../state/tradeHistoryStore';
import { stopReasons } from '../utils/nextAction';

/** 資金管理(仕様17・18・27)。確定的な予測は出さず、現在位置と設定だけ扱う。 */

const RISK_PRESETS = [
  { label: '慎重', percent: 1 },
  { label: '標準', percent: 2 },
  { label: '積極', percent: 3 },
];

const CAPITAL_PRESETS = [10000, 30000, 100000, 300000];

export function AccountScreen() {
  const account = useAccount();
  const trades = useTrades();
  const daily = useMemo(() => summarise(trades), [trades]);
  const progress = milestoneProgress(account);
  const stops = stopReasons(account, daily);

  const total = account.currentCapital - account.startingCapital;
  const totalPercent =
    account.startingCapital > 0 ? (total / account.startingCapital) * 100 : 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.label}>現在資金</Text>
        <Text style={styles.capital}>
          {Math.round(account.currentCapital).toLocaleString()}円
        </Text>
        <Text style={styles.sub}>
          開始 {account.startingCapital.toLocaleString()}円 / 累計{' '}
          <Text style={{ color: total >= 0 ? '#15803D' : '#B91C1C' }}>
            {total >= 0 ? '+' : '−'}
            {Math.abs(Math.round(total)).toLocaleString()}円 ({totalPercent >= 0 ? '+' : ''}
            {totalPercent.toFixed(2)}%)
          </Text>
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>次の目標</Text>
        <Text style={styles.goal}>{progress.to.toLocaleString()}円</Text>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${progress.ratio * 100}%` }]} />
        </View>
        <View style={styles.milestones}>
          {CAPITAL_MILESTONES.map((amount) => (
            <Text
              key={amount}
              style={[
                styles.milestone,
                account.currentCapital >= amount && styles.milestoneReached,
              ]}
            >
              {amount >= 10000 ? `${amount / 10000}万` : amount}
            </Text>
          ))}
        </View>
        <Text style={styles.note}>
          現在位置のみを示しています。「あと何日で到達」といった予測は出しません。
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>本日の状態</Text>
        <Row label="取引" value={`${daily.trades} / ${account.maxTradesPerDay}`} />
        <Row
          label="損益"
          value={`${daily.pnlYen >= 0 ? '+' : '−'}${Math.abs(Math.round(daily.pnlYen)).toLocaleString()}円`}
          color={daily.pnlYen >= 0 ? '#15803D' : '#B91C1C'}
        />
        <Row label="連敗" value={`${daily.consecutiveLosses} / ${account.maxConsecutiveLosses}`} />
        {stops.length > 0 && (
          <View style={styles.stopBox}>
            <Text style={styles.stopTitle}>⛔ 本日の新規トレードを停止しています</Text>
            {stops.map((reason, i) => (
              <Text key={i} style={styles.stopLine}>・{reason}</Text>
            ))}
          </View>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>リスク設定</Text>
        <Text style={styles.note}>1トレードで資金の何%まで失ってよいか。</Text>
        <View style={styles.chipRow}>
          {RISK_PRESETS.map((preset) => {
            const selected = account.riskPercent === preset.percent;
            return (
              <Pressable
                key={preset.percent}
                style={[styles.chip, selected && styles.chipActive]}
                onPress={() => setAccount({ riskPercent: preset.percent })}
              >
                <Text style={[styles.chipText, selected && styles.chipTextActive]}>
                  {preset.label} {preset.percent}%
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.cardTitle, { marginTop: 8 }]}>開始資金をやり直す</Text>
        <Text style={styles.note}>
          資金を設定し直します。履歴は消えませんが、現在資金は入力した額になります。
        </Text>
        <View style={styles.chipRow}>
          {CAPITAL_PRESETS.map((amount) => (
            <Pressable
              key={amount}
              style={styles.chip}
              onPress={() => resetCapital(amount)}
            >
              <Text style={styles.chipText}>
                {amount >= 10000 ? `${amount / 10000}万円` : `${amount}円`}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

function Row({ label, value, color = '#0F172A' }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, { color }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F1F5F9' },
  content: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    padding: 14,
    gap: 10,
  },
  card: { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 16, gap: 6 },
  cardTitle: { fontSize: 13, fontWeight: '800', color: '#0F172A' },
  label: { fontSize: 11, color: '#64748B' },
  capital: { fontSize: 34, fontWeight: '900', color: '#0F172A', fontVariant: ['tabular-nums'] },
  sub: { fontSize: 12, color: '#64748B' },
  goal: { fontSize: 22, fontWeight: '800', color: '#2563EB' },
  track: { height: 12, borderRadius: 6, backgroundColor: '#E2E8F0', overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: '#2563EB', borderRadius: 6 },
  milestones: { flexDirection: 'row', justifyContent: 'space-between' },
  milestone: { fontSize: 10, color: '#94A3B8' },
  milestoneReached: { color: '#15803D', fontWeight: '800' },
  note: { fontSize: 10, color: '#94A3B8', lineHeight: 15 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLabel: { fontSize: 12, color: '#64748B' },
  rowValue: { fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  stopBox: {
    backgroundColor: '#FEF2F2',
    borderRadius: 10,
    padding: 10,
    gap: 2,
    marginTop: 6,
  },
  stopTitle: { fontSize: 12, fontWeight: '800', color: '#B91C1C' },
  stopLine: { fontSize: 11, color: '#7F1D1D' },
  chipRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  chip: {
    flex: 1,
    minWidth: 80,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
  },
  chipActive: { backgroundColor: '#2563EB' },
  chipText: { fontSize: 12, fontWeight: '700', color: '#475569' },
  chipTextActive: { color: '#FFFFFF', fontWeight: '800' },
});
