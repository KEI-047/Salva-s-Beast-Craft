import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BinaryHorizon, TradeType } from '../types';
import {
  breakEvenWinRate,
  horizonLabel,
  HORIZON_OPTIONS,
  PAYOUT_OPTIONS,
  payoutFromPrice,
  setTradeSettings,
  setTradeType,
  useTradeSettings,
} from '../utils/tradeSettings';

const TYPE_OPTIONS: { type: TradeType; label: string }[] = [
  { type: 'fx', label: 'FX' },
  { type: 'binary', label: 'バイナリー' },
];

/**
 * 取引の種類と、バイナリーの条件(ペイアウト倍率・判定時刻)を選ぶ。
 * compact ではウォッチリストのヘッダが伸びすぎないよう、設定の行を畳んで要約だけ出す。
 */
export function TradeTypeSelector({ compact = false }: { compact?: boolean }) {
  const settings = useTradeSettings();
  const binary = settings.tradeType === 'binary';
  const breakEven = (breakEvenWinRate(settings.payout) * 100).toFixed(1);

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {TYPE_OPTIONS.map((option) => {
          const selected = option.type === settings.tradeType;
          return (
            <Pressable
              key={option.type}
              style={[styles.button, selected && styles.buttonActive]}
              onPress={() => setTradeType(option.type)}
            >
              <Text style={[styles.buttonText, selected && styles.buttonTextActive]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {!binary ? (
        <Text style={styles.hint}>
          値幅で損益が決まる取引として判定します(損益分岐 40%・リスクリワード 1:1.5)
        </Text>
      ) : (
        <>
          {!compact && (
            <>
              <View style={styles.settingRow}>
                <Text style={styles.settingLabel}>ペイアウト</Text>
                {PAYOUT_OPTIONS.map((payout) => {
                  const selected = payout === settings.payout;
                  return (
                    <Pressable
                      key={payout}
                      style={[styles.chip, selected && styles.chipActive]}
                      onPress={() => setTradeSettings({ payout })}
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextActive]}>
                        {payout.toFixed(2)}倍
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.settingRow}>
                <Text style={styles.settingLabel}>判定時刻</Text>
                {HORIZON_OPTIONS.map((horizonBars: BinaryHorizon) => {
                  const selected = horizonBars === settings.horizonBars;
                  return (
                    <Pressable
                      key={horizonBars}
                      style={[styles.chip, selected && styles.chipActive]}
                      onPress={() => setTradeSettings({ horizonBars })}
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextActive]}>
                        {horizonLabel(horizonBars)}後
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}

          <Text style={styles.summary}>
            ペイアウト{settings.payout.toFixed(2)}倍 / {horizonLabel(settings.horizonBars)}後判定 → 必要勝率{' '}
            {breakEven}%
          </Text>
          {!compact && (
            <Text style={styles.hint}>
              国内型(外為オプション)は 1,000円 ÷ 購入価格 が倍率です。購入価格
              500円なら{payoutFromPrice(500).toFixed(2)}倍、600円なら
              {payoutFromPrice(600).toFixed(2)}倍。判定時刻が2時間のラウンド制なら「2時間後」を選んでください。
            </Text>
          )}
        </>
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
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  settingLabel: {
    fontSize: 11,
    color: '#64748B',
    width: 60,
  },
  chip: {
    flex: 1,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
  },
  chipActive: {
    backgroundColor: '#2563EB',
  },
  chipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  chipTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  summary: {
    fontSize: 11,
    color: '#2563EB',
    fontWeight: '700',
  },
  hint: {
    fontSize: 11,
    color: '#94A3B8',
    lineHeight: 15,
  },
});
