import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { OpenPosition } from '../state/positionStore';
import { pipSize } from '../utils/timeframes';

/**
 * 「エントリーした」「決済した」の確認(仕様7・11・31)。
 *
 * 履歴と資金に影響する操作なので確認を挟む。ただし段数は1つに留める。
 * 推奨値を初期値に入れておき、GMOとOANDAの価格差はユーザーが直せるようにする。
 */

function formatRate(value: number): string {
  return value >= 20 ? value.toFixed(3) : value.toFixed(5);
}

function parseNumber(text: string): number | null {
  const value = Number(text.replace(/[^\d.-]/g, ''));
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function EntryConfirmModal({
  visible,
  pairLabel,
  direction,
  suggestedPrice,
  suggestedUnits,
  tp,
  sl,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  pairLabel: string;
  direction: 'BUY' | 'SELL';
  suggestedPrice: number;
  suggestedUnits: number;
  tp: number;
  sl: number;
  onCancel: () => void;
  onConfirm: (entryPrice: number, units: number) => void;
}) {
  const [price, setPrice] = useState(formatRate(suggestedPrice));
  const [units, setUnits] = useState(String(suggestedUnits));

  const parsedPrice = parseNumber(price);
  const parsedUnits = parseNumber(units);
  const valid = parsedPrice !== null && parsedUnits !== null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>
            {pairLabel} {direction === 'BUY' ? '買い' : '売り'}
          </Text>
          <Text style={styles.note}>
            OANDAでの実際の約定価格を入力してください。表示価格と差が出ることがあります。
          </Text>

          <Field label="OANDA約定価格" value={price} onChange={setPrice} />
          <Field label="数量(通貨)" value={units} onChange={setUnits} />

          <View style={styles.readonly}>
            <Text style={styles.readonlyRow}>TP {formatRate(tp)}</Text>
            <Text style={styles.readonlyRow}>SL {formatRate(sl)}</Text>
          </View>

          <View style={styles.buttons}>
            <Pressable style={[styles.button, styles.cancel]} onPress={onCancel}>
              <Text style={styles.cancelText}>やめる</Text>
            </Pressable>
            <Pressable
              style={[styles.button, styles.primary, !valid && styles.disabled]}
              disabled={!valid}
              onPress={() => valid && onConfirm(parsedPrice, parsedUnits)}
            >
              <Text style={styles.primaryText}>ポジション監視開始</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function ExitConfirmModal({
  visible,
  position,
  suggestedPrice,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  position: OpenPosition;
  suggestedPrice: number;
  onCancel: () => void;
  onConfirm: (exitPrice: number) => void;
}) {
  const [price, setPrice] = useState(formatRate(suggestedPrice));
  const parsed = parseNumber(price);

  // 入力しながら確定損益が見えるようにする
  const preview =
    parsed === null
      ? null
      : (() => {
          const diff =
            position.direction === 'BUY'
              ? parsed - position.entryPrice
              : position.entryPrice - parsed;
          return {
            yen: diff * position.units,
            pips: diff / pipSize(position.entryPrice),
          };
        })();

  const held = Date.now() - Date.parse(position.openedAt);
  const minutes = Math.floor(held / 60000);
  const seconds = Math.floor((held % 60000) / 1000);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>決済の記録</Text>
          <Text style={styles.note}>OANDAでの実際の決済価格を入力してください。</Text>

          <Field label="決済価格" value={price} onChange={setPrice} />

          {preview && (
            <View style={styles.preview}>
              <Text
                style={[
                  styles.previewValue,
                  { color: preview.yen >= 0 ? '#15803D' : '#B91C1C' },
                ]}
              >
                {preview.yen >= 0 ? '+' : '−'}
                {Math.abs(Math.round(preview.yen)).toLocaleString()}円
              </Text>
              <Text style={styles.previewSub}>
                {preview.pips >= 0 ? '+' : '−'}
                {Math.abs(preview.pips).toFixed(1)}pips / 保有 {minutes}分{seconds}秒
              </Text>
            </View>
          )}

          <View style={styles.buttons}>
            <Pressable style={[styles.button, styles.cancel]} onPress={onCancel}>
              <Text style={styles.cancelText}>やめる</Text>
            </Pressable>
            <Pressable
              style={[styles.button, styles.primary, parsed === null && styles.disabled]}
              disabled={parsed === null}
              onPress={() => parsed !== null && onConfirm(parsed)}
            >
              <Text style={styles.primaryText}>トレードを保存</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (text: string) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        keyboardType="decimal-pad"
        selectTextOnFocus
      />
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.55)',
    justifyContent: 'center',
    padding: 20,
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 18,
    gap: 12,
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
  },
  title: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  note: { fontSize: 11, color: '#64748B', lineHeight: 16 },
  field: { gap: 4 },
  fieldLabel: { fontSize: 11, color: '#64748B' },
  input: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
  },
  readonly: { flexDirection: 'row', gap: 16 },
  readonlyRow: { fontSize: 12, color: '#475569' },
  preview: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    gap: 2,
  },
  previewValue: { fontSize: 24, fontWeight: '900' },
  previewSub: { fontSize: 11, color: '#64748B' },
  buttons: { flexDirection: 'row', gap: 10 },
  button: { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center' },
  cancel: { backgroundColor: '#E2E8F0' },
  cancelText: { fontSize: 14, fontWeight: '700', color: '#475569' },
  primary: { backgroundColor: '#2563EB' },
  primaryText: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
  disabled: { backgroundColor: '#94A3B8' },
});
