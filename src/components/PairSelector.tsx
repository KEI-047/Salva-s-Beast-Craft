import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CURRENCY_PAIRS } from '../constants/pairs';
import { setSelectedPair, useSelectedPair } from '../state/pairStore';
import { usePairStatuses } from '../utils/usePairStatuses';
import { WatchlistLevel } from '../utils/watchlistStatus';

/**
 * 通貨ペアの選択。
 *
 * ホーム最上部のペア名そのものを押せるようにする。ボタンを別に置くと
 * 「今どのペアを見ているか」と「変える操作」が離れて分かりにくい。
 *
 * 選ぶ時点で「そのペアは今入っていいのか」が分からないと、開いてみるまで判断できない。
 * 一覧と同じ判定(watchlistStatus)を各行に出す。判定は開いた時だけ取得する。
 */

const LEVEL_COLOR: Record<WatchlistLevel, string> = {
  candidate: '#15803D',
  watch: '#A16207',
  stopped: '#94A3B8',
};

export function PairSelector({ disabled = false }: { disabled?: boolean }) {
  const pair = useSelectedPair();
  const [open, setOpen] = useState(false);
  // 開いている間だけ判定する。常時だと全ペアぶんのレートを取りに行ってしまう。
  const { statuses, loading, loadedCount, stopReason, candidateCount } =
    usePairStatuses(open);

  const groups = [
    { key: 'jpy' as const, title: '対円' },
    { key: 'cross' as const, title: 'クロス' },
  ];

  return (
    <>
      <Pressable
        style={styles.trigger}
        onPress={() => !disabled && setOpen(true)}
        disabled={disabled}
      >
        <Text style={styles.label}>{pair.label}</Text>
        {!disabled && <Text style={styles.caret}>▼</Text>}
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
            <Text style={styles.title}>通貨ペアを選ぶ</Text>
            {stopReason ? (
              <View style={[styles.summary, styles.summaryStop]}>
                <Text style={styles.summaryStopText}>⛔ 取引しない</Text>
                <Text style={styles.summaryDetail}>{stopReason}</Text>
              </View>
            ) : (
              <View
                style={[styles.summary, candidateCount > 0 && styles.summaryActive]}
              >
                <Text
                  style={[
                    styles.summaryText,
                    candidateCount > 0 && styles.summaryTextActive,
                  ]}
                >
                  {loadedCount < CURRENCY_PAIRS.length
                    ? '判定中…'
                    : candidateCount > 0
                      ? `🟢 取引候補 ${candidateCount}件`
                      : '🟡 今は候補なし(全ペア様子見)'}
                </Text>
                {loading && loadedCount < CURRENCY_PAIRS.length && (
                  <ActivityIndicator size="small" color="#2563EB" />
                )}
              </View>
            )}
            <ScrollView style={styles.list}>
              {groups.map((group) => (
                <View key={group.key} style={styles.group}>
                  <Text style={styles.groupTitle}>{group.title}</Text>
                  {CURRENCY_PAIRS.filter((item) => item.group === group.key).map((item) => {
                    const selected = item.id === pair.id;
                    const status = statuses[item.id];
                    return (
                      <Pressable
                        key={item.id}
                        style={[
                          styles.row,
                          selected && styles.rowSelected,
                          status?.level === 'candidate' && styles.rowCandidate,
                        ]}
                        onPress={() => {
                          setSelectedPair(item.id);
                          setOpen(false);
                        }}
                      >
                        <View style={styles.rowTop}>
                          <Text style={[styles.rowLabel, selected && styles.rowLabelSelected]}>
                            {item.label}
                          </Text>
                          <Text style={styles.rowName}>{item.nameJa}</Text>
                          {selected && <Text style={styles.check}>✓</Text>}
                        </View>
                        <Text
                          style={[
                            styles.rowStatus,
                            { color: status ? LEVEL_COLOR[status.level] : '#CBD5E1' },
                          ]}
                          numberOfLines={1}
                        >
                          {status ? `${status.emoji} ${status.label}` : '判定中…'}
                          {status && status.level !== 'candidate' ? ` / ${status.detail}` : ''}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
            <Pressable style={styles.close} onPress={() => setOpen(false)}>
              <Text style={styles.closeText}>閉じる</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { fontSize: 20, fontWeight: '900', color: '#0F172A' },
  caret: { fontSize: 11, color: '#64748B' },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.55)',
    justifyContent: 'center',
    padding: 20,
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    gap: 10,
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    maxHeight: '80%',
  },
  title: { fontSize: 16, fontWeight: '800', color: '#0F172A' },
  list: { flexGrow: 0 },
  group: { gap: 4, marginBottom: 10 },
  groupTitle: { fontSize: 11, fontWeight: '700', color: '#94A3B8' },
  summary: {
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    gap: 2,
  },
  summaryActive: { backgroundColor: '#DCFCE7' },
  summaryStop: { backgroundColor: '#FEF2F2' },
  summaryText: { fontSize: 12, fontWeight: '800', color: '#64748B' },
  summaryTextActive: { color: '#15803D' },
  summaryStopText: { fontSize: 12, fontWeight: '800', color: '#B91C1C' },
  summaryDetail: { fontSize: 10, color: '#64748B', textAlign: 'center' },
  row: {
    gap: 3,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowStatus: { fontSize: 10 },
  rowSelected: { backgroundColor: '#EFF6FF' },
  rowCandidate: { backgroundColor: '#F0FDF4', borderColor: '#86EFAC' },
  rowLabel: { fontSize: 15, fontWeight: '700', color: '#0F172A', width: 88 },
  rowLabelSelected: { color: '#1D4ED8', fontWeight: '900' },
  rowName: { flex: 1, fontSize: 12, color: '#64748B' },
  check: { fontSize: 14, fontWeight: '900', color: '#1D4ED8' },
  close: { paddingVertical: 12, alignItems: 'center', backgroundColor: '#E2E8F0', borderRadius: 12 },
  closeText: { fontSize: 14, fontWeight: '700', color: '#475569' },
});
