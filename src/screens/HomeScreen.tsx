import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ConditionChecklist } from '../components/ConditionChecklist';
import { NextActionCard } from '../components/NextActionCard';
import { OrderTicket } from '../components/OrderTicket';
import { PositionPanel } from '../components/PositionPanel';
import { TradeCompleteCard } from '../components/TradeCompleteCard';
import { EntryConfirmModal, ExitConfirmModal } from '../components/TradeModals';
import { CONTENT_MAX_WIDTH } from '../constants/layout';
import { CURRENCY_PAIRS } from '../constants/pairs';
import { applyRealisedPnl, useAccount } from '../state/accountStore';
import { closePosition, openPosition, usePosition } from '../state/positionStore';
import { addTrade, summarise, Trade, useTrades } from '../state/tradeHistoryStore';
import { evaluateDataHealth } from '../utils/dataHealth';
import { decideNextAction } from '../utils/nextAction';
import { calculateSizing } from '../utils/positionSizing';
import { pipSize } from '../utils/timeframes';
import { useLivePrices } from '../utils/useLivePrices';
import { useMarketData } from '../utils/useMarketData';

/**
 * ホーム(仕様3・15)。
 *
 * 上から: 通貨ペア → 接続状況 → 現在価格 → NEXT ACTION → 注文情報 → 理由。
 * テクニカル指標の数値はここに出さない(分析タブに置く)。
 */

const PAIR = CURRENCY_PAIRS[0]; // v2のホームは1ペアに集中する

function formatRate(value: number): string {
  return value >= 20 ? value.toFixed(3) : value.toFixed(5);
}

export function HomeScreen() {
  const account = useAccount();
  const positionState = usePosition();
  const trades = useTrades();
  const daily = useMemo(() => summarise(trades), [trades]);

  const livePairs = useMemo(
    () => [{ id: PAIR.id, base: PAIR.base, quote: PAIR.quote }],
    []
  );
  const { prices, live, staleMinutes } = useLivePrices(livePairs);
  const livePrice = prices[PAIR.id] ?? null;
  const price = livePrice?.mid ?? null;

  const { bars, context, loading } = useMarketData(PAIR);

  const [entryModal, setEntryModal] = useState(false);
  const [exitModal, setExitModal] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
  const [completed, setCompleted] = useState<Trade | null>(null);

  const health = useMemo(
    () =>
      evaluateDataHealth({
        lastPriceAt: livePrice?.time ?? null,
        price,
        bid: livePrice?.bid ?? null,
        ask: livePrice?.ask ?? null,
        bars: bars['15min'],
        usingFallback: staleMinutes !== null,
        tradeable: livePrice?.tradeable ?? true,
      }),
    [livePrice, price, bars, staleMinutes]
  );

  const sizing = useMemo(() => {
    if (!context || context.bias === 'HOLD' || price === null) return null;
    return calculateSizing({
      account,
      direction: context.bias,
      entryPrice: price,
      atr: context.atr,
    });
  }, [context, price, account]);

  const action = useMemo(
    () =>
      decideNextAction({
        health,
        account,
        daily,
        position: positionState,
        context,
        price,
        sizingOk: sizing?.ok ?? false,
        sizingReason: sizing?.reason ?? null,
      }),
    [health, account, daily, positionState, context, price, sizing]
  );

  const confirmEntry = useCallback(
    (entryPrice: number, units: number) => {
      if (!context || context.bias === 'HOLD' || !sizing) return;
      openPosition({
        pairId: PAIR.id,
        pairLabel: PAIR.label,
        direction: context.bias,
        entryPrice,
        units,
        tp: sizing.tp,
        sl: sizing.sl,
        entryReasons: context.conditions.map((c) => `${c.label}: ${c.detail}`),
        openedAt: new Date().toISOString(),
      });
      setEntryModal(false);
    },
    [context, sizing]
  );

  const confirmExit = useCallback(
    (exitPrice: number) => {
      if (positionState.state !== 'IN_POSITION') return;
      const position = positionState.position;
      const diff =
        position.direction === 'BUY'
          ? exitPrice - position.entryPrice
          : position.entryPrice - exitPrice;
      const pnlYen = diff * position.units;
      const trade: Trade = {
        id: `${Date.now()}`,
        pairId: position.pairId,
        pairLabel: position.pairLabel,
        direction: position.direction,
        entryPrice: position.entryPrice,
        exitPrice,
        units: position.units,
        tp: position.tp,
        sl: position.sl,
        entryReasons: position.entryReasons,
        exitReasons: action.reasons,
        openedAt: position.openedAt,
        closedAt: new Date().toISOString(),
        pnlYen,
        pnlPips: diff / pipSize(position.entryPrice),
        result: pnlYen > 0 ? 'WIN' : pnlYen < 0 ? 'LOSS' : 'EVEN',
      };
      addTrade(trade);
      applyRealisedPnl(pnlYen);
      closePosition();
      setExitModal(false);
      setCompleted(trade);
    },
    [positionState, action.reasons]
  );

  if (completed) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <TradeCompleteCard
          trade={completed}
          capitalAfter={account.currentCapital}
          daily={daily}
          onNext={() => setCompleted(null)}
        />
      </ScrollView>
    );
  }

  const holding = positionState.state === 'IN_POSITION';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* ① 通貨ペア ② 接続状況 */}
      <View style={styles.headerRow}>
        <Text style={styles.pair}>{PAIR.label}</Text>
        <View style={styles.statusRow}>
          <View
            style={[styles.dot, { backgroundColor: health.ok && live ? '#22C55E' : '#94A3B8' }]}
          />
          <Text style={styles.status}>GMO LIVE</Text>
        </View>
      </View>
      <Text style={styles.updated}>
        {health.ageSeconds === null
          ? '最終更新 —'
          : `最終更新 ${Math.max(0, Math.round(health.ageSeconds))}秒前`}
      </Text>

      {/* ③ 現在価格 */}
      <Text style={styles.price}>{price === null ? '—' : formatRate(price)}</Text>

      {/* ④ NEXT ACTION(最大) */}
      <NextActionCard action={action} />

      {loading && bars['15min'].length === 0 && (
        <View style={styles.loading}>
          <ActivityIndicator color="#2563EB" />
          <Text style={styles.loadingText}>各時間足を読み込んでいます…</Text>
        </View>
      )}

      {/* ⑤ 必要最低限の注文情報 */}
      {holding ? (
        <>
          <PositionPanel
            position={positionState.position}
            price={price}
            context={context}
          />
          <Pressable
            style={[styles.cta, action.kind === 'EXIT_NOW' ? styles.ctaDanger : styles.ctaMuted]}
            onPress={() => setExitModal(true)}
          >
            <Text style={styles.ctaText}>
              {action.kind === 'EXIT_NOW' ? '決済した' : '手動で決済した'}
            </Text>
          </Pressable>
        </>
      ) : (
        action.showOrder &&
        sizing?.ok &&
        context && (
          <>
            <OrderTicket
              direction={context.bias === 'SELL' ? 'SELL' : 'BUY'}
              sizing={sizing}
              entryLow={(price ?? 0) - (context.atr ?? 0) * 0.25}
              entryHigh={(price ?? 0) + (context.atr ?? 0) * 0.25}
              currentPrice={price}
            />
            <Pressable style={[styles.cta, styles.ctaPrimary]} onPress={() => setEntryModal(true)}>
              <Text style={styles.ctaText}>エントリーした</Text>
            </Pressable>
          </>
        )
      )}

      {/* 条件チェックリスト。ENTRY NOW 中は折りたたむ(もう読む必要がない) */}
      {!holding && context && action.kind !== 'ENTRY_NOW' && (
        <ConditionChecklist
          conditions={context.conditions}
          metCount={context.metCount}
          totalCount={context.totalCount}
        />
      )}

      {/* 停止中・データ異常は、なぜ止まっているかを畳まずに出す。
          ここを隠すとユーザーは「壊れている」としか分からない。 */}
      {(action.kind === 'DATA_ISSUE' || action.kind === 'NO_TRADE') && (
        <View style={styles.alertCard}>
          {action.reasons.map((reason, index) => (
            <Text key={index} style={styles.alertLine}>
              ・{reason}
            </Text>
          ))}
        </View>
      )}

      {/* ⑥ 理由 */}
      <Pressable style={styles.whyButton} onPress={() => setShowWhy((v) => !v)}>
        <Text style={styles.whyButtonText}>
          {showWhy ? '閉じる' : `なぜ${action.label}？`}
        </Text>
      </Pressable>
      {showWhy && (
        <View style={styles.whyCard}>
          {action.reasons.map((reason, index) => (
            <Text key={index} style={styles.whyLine}>
              ・{reason}
            </Text>
          ))}
          {context && (
            <View style={styles.frameList}>
              {[
                context.frames.fourHour,
                context.frames.hourly,
                context.frames.fifteen,
                context.frames.five,
                context.frames.minute,
              ].map((frame) => (
                <Text key={frame.label} style={styles.frameLine}>
                  {frame.label}:{' '}
                  {frame.direction === 'BUY'
                    ? '上昇'
                    : frame.direction === 'SELL'
                      ? '下降'
                      : '方向なし'}
                </Text>
              ))}
            </View>
          )}
        </View>
      )}

      {entryModal && sizing?.ok && context && price !== null && (
        <EntryConfirmModal
          visible
          pairLabel={PAIR.label}
          direction={context.bias === 'SELL' ? 'SELL' : 'BUY'}
          suggestedPrice={price}
          suggestedUnits={sizing.units}
          tp={sizing.tp}
          sl={sizing.sl}
          onCancel={() => setEntryModal(false)}
          onConfirm={confirmEntry}
        />
      )}
      {exitModal && holding && (
        <ExitConfirmModal
          visible
          position={positionState.position}
          suggestedPrice={price ?? positionState.position.entryPrice}
          onCancel={() => setExitModal(false)}
          onConfirm={confirmExit}
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F1F5F9' },
  content: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    padding: 14,
    paddingBottom: 28,
    gap: 10,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pair: { fontSize: 20, fontWeight: '900', color: '#0F172A' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  status: { fontSize: 11, fontWeight: '700', color: '#64748B' },
  updated: { fontSize: 10, color: '#94A3B8', marginTop: -6 },
  price: {
    fontSize: 44,
    fontWeight: '900',
    color: '#0F172A',
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center' },
  loadingText: { fontSize: 11, color: '#64748B' },
  cta: { borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  ctaPrimary: { backgroundColor: '#15803D' },
  ctaDanger: { backgroundColor: '#B91C1C' },
  ctaMuted: { backgroundColor: '#64748B' },
  ctaText: { fontSize: 16, fontWeight: '900', color: '#FFFFFF' },
  whyButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingVertical: 10,
    alignItems: 'center',
  },
  whyButtonText: { fontSize: 12, fontWeight: '700', color: '#475569' },
  alertCard: {
    backgroundColor: '#FFFBEB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FDE68A',
    padding: 12,
    gap: 3,
  },
  alertLine: { fontSize: 12, color: '#92400E', lineHeight: 18 },
  whyCard: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 12, gap: 4 },
  whyLine: { fontSize: 12, color: '#334155', lineHeight: 18 },
  frameList: { marginTop: 6, gap: 2 },
  frameLine: { fontSize: 11, color: '#64748B' },
});
