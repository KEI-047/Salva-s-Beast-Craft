import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { OpenPosition } from '../state/positionStore';
import { targetsFor } from '../utils/positionSizing';
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
  slPips,
  tpPips,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  pairLabel: string;
  direction: 'BUY' | 'SELL';
  suggestedPrice: number;
  suggestedUnits: number;
  slPips: number;
  tpPips: number;
  onCancel: () => void;
  onConfirm: (entryPrice: number, units: number, tp: number, sl: number) => void;
}) {
  const [price, setPrice] = useState(formatRate(suggestedPrice));
  const [units, setUnits] = useState(String(suggestedUnits));

  const parsedPrice = parseNumber(price);
  const parsedUnits = parseNumber(units);
  const valid = parsedPrice !== null && parsedUnits !== null;
  // 入力した約定価格に追随させる。表示と保存で同じ値を使う。
  const targets = targetsFor(direction, parsedPrice ?? suggestedPrice, slPips, tpPips);

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
          <Text style={styles.note}>TP / SL は約定価格に合わせて計算し直します。</Text>

          <View style={styles.readonly}>
            <Text style={styles.readonlyRow}>TP {formatRate(targets.tp)}</Text>
            <Text style={styles.readonlyRow}>SL {formatRate(targets.sl)}</Text>
          </View>

          <View style={styles.buttons}>
            <Pressable style={[styles.button, styles.cancel]} onPress={onCancel}>
              <Text style={styles.cancelText}>やめる</Text>
            </Pressable>
            <Pressable
              style={[styles.button, styles.primary, !valid && styles.disabled]}
              disabled={!valid}
              onPress={() =>
                valid && onConfirm(parsedPrice, parsedUnits, targets.tp, targets.sl)
              }
            >
              <Text style={styles.primaryText}>ポジション監視開始</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/**
 * 手動でのポジション登録(仕様8の保険)。
 *
 * 指示が出ていない時に入ってしまった、指示の猶予が切れてから約定した、
 * 別の端末で持った——理由は何であれ、実際に建玉があるのにアプリが
 * 知らない状態が一番危ない。決済ナビが出ないまま放置されるからだ。
 * そのため「いつでも登録できる」道を必ず1本残す。
 */
export function ManualPositionModal({
  visible,
  pairLabel,
  defaults,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  pairLabel: string;
  /** 方向ごとの初期値。ATRが取れていれば推奨TP/SLが入る */
  defaults: (direction: 'BUY' | 'SELL') => {
    price: number | null;
    units: number;
    tp: number | null;
    sl: number | null;
  };
  onCancel: () => void;
  onConfirm: (input: {
    direction: 'BUY' | 'SELL';
    entryPrice: number;
    units: number;
    tp: number;
    sl: number;
  }) => void;
}) {
  const initial = defaults('BUY');
  const [direction, setDirection] = useState<'BUY' | 'SELL'>('BUY');
  const [price, setPrice] = useState(initial.price === null ? '' : formatRate(initial.price));
  const [units, setUnits] = useState(String(initial.units));
  const [tp, setTp] = useState(initial.tp === null ? '' : formatRate(initial.tp));
  const [sl, setSl] = useState(initial.sl === null ? '' : formatRate(initial.sl));

  // 方向を変えるとTP/SLは上下が入れ替わるので、推奨値を入れ直す。
  const switchTo = (next: 'BUY' | 'SELL') => {
    if (next === direction) return;
    setDirection(next);
    const values = defaults(next);
    if (values.price !== null) setPrice(formatRate(values.price));
    if (values.tp !== null) setTp(formatRate(values.tp));
    if (values.sl !== null) setSl(formatRate(values.sl));
  };

  const parsedPrice = parseNumber(price);
  const parsedUnits = parseNumber(units);
  const parsedTp = parseNumber(tp);
  const parsedSl = parseNumber(sl);
  // TP/SLが方向と逆だと、決済ナビが即座に「今すぐ決済」を出してしまう。
  const consistent =
    parsedPrice !== null &&
    parsedTp !== null &&
    parsedSl !== null &&
    (direction === 'BUY'
      ? parsedTp > parsedPrice && parsedSl < parsedPrice
      : parsedTp < parsedPrice && parsedSl > parsedPrice);
  const valid = parsedUnits !== null && consistent;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{pairLabel} を手動で登録</Text>
          <Text style={styles.note}>
            すでにOANDAで持っているポジションを登録します。ここでは注文しません。
          </Text>

          <View style={styles.toggle}>
            {(['BUY', 'SELL'] as const).map((value) => (
              <Pressable
                key={value}
                style={[
                  styles.toggleItem,
                  direction === value &&
                    (value === 'BUY' ? styles.toggleBuy : styles.toggleSell),
                ]}
                onPress={() => switchTo(value)}
              >
                <Text
                  style={[
                    styles.toggleText,
                    direction === value && styles.toggleTextActive,
                  ]}
                >
                  {value === 'BUY' ? '買い' : '売り'}
                </Text>
              </Pressable>
            ))}
          </View>

          <Field label="OANDA約定価格" value={price} onChange={setPrice} />
          <Field label="数量(通貨)" value={units} onChange={setUnits} />
          <Field label="利確 TP" value={tp} onChange={setTp} />
          <Field label="損切 SL" value={sl} onChange={setSl} />

          {!consistent && parsedPrice !== null && parsedTp !== null && parsedSl !== null && (
            <Text style={styles.warn}>
              {direction === 'BUY'
                ? 'TPは約定価格より上、SLは下に入れてください。'
                : 'TPは約定価格より下、SLは上に入れてください。'}
            </Text>
          )}

          <View style={styles.buttons}>
            <Pressable style={[styles.button, styles.cancel]} onPress={onCancel}>
              <Text style={styles.cancelText}>やめる</Text>
            </Pressable>
            <Pressable
              style={[styles.button, styles.primary, !valid && styles.disabled]}
              disabled={!valid}
              onPress={() =>
                valid &&
                onConfirm({
                  direction,
                  entryPrice: parsedPrice,
                  units: parsedUnits,
                  tp: parsedTp,
                  sl: parsedSl,
                })
              }
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
  toggle: { flexDirection: 'row', gap: 8 },
  toggleItem: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#E2E8F0',
  },
  toggleBuy: { backgroundColor: '#15803D' },
  toggleSell: { backgroundColor: '#B91C1C' },
  toggleText: { fontSize: 14, fontWeight: '800', color: '#475569' },
  toggleTextActive: { color: '#FFFFFF' },
  warn: { fontSize: 11, color: '#B45309', lineHeight: 16 },
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
