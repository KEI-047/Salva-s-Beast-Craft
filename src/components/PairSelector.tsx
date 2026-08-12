import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CURRENCY_PAIRS } from '../constants/pairs';
import { setSelectedPair, useSelectedPair } from '../state/pairStore';

/**
 * 通貨ペアの選択。
 *
 * ホーム最上部のペア名そのものを押せるようにする。ボタンを別に置くと
 * 「今どのペアを見ているか」と「変える操作」が離れて分かりにくい。
 */
export function PairSelector({ disabled = false }: { disabled?: boolean }) {
  const pair = useSelectedPair();
  const [open, setOpen] = useState(false);

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
            <ScrollView style={styles.list}>
              {groups.map((group) => (
                <View key={group.key} style={styles.group}>
                  <Text style={styles.groupTitle}>{group.title}</Text>
                  {CURRENCY_PAIRS.filter((item) => item.group === group.key).map((item) => {
                    const selected = item.id === pair.id;
                    return (
                      <Pressable
                        key={item.id}
                        style={[styles.row, selected && styles.rowSelected]}
                        onPress={() => {
                          setSelectedPair(item.id);
                          setOpen(false);
                        }}
                      >
                        <Text style={[styles.rowLabel, selected && styles.rowLabelSelected]}>
                          {item.label}
                        </Text>
                        <Text style={styles.rowName}>{item.nameJa}</Text>
                        {selected && <Text style={styles.check}>✓</Text>}
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
  },
  rowSelected: { backgroundColor: '#EFF6FF' },
  rowLabel: { fontSize: 15, fontWeight: '700', color: '#0F172A', width: 88 },
  rowLabelSelected: { color: '#1D4ED8', fontWeight: '900' },
  rowName: { flex: 1, fontSize: 12, color: '#64748B' },
  check: { fontSize: 14, fontWeight: '900', color: '#1D4ED8' },
  close: { paddingVertical: 12, alignItems: 'center', backgroundColor: '#E2E8F0', borderRadius: 12 },
  closeText: { fontSize: 14, fontWeight: '700', color: '#475569' },
});
