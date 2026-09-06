import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { LivePriceHeader } from '../components/LivePriceHeader';
import { OrderTicket } from '../components/OrderTicket';
import { PendingEntryCard } from '../components/PendingEntryCard';
import { PositionPanel } from '../components/PositionPanel';
import { TradeCompleteCard } from '../components/TradeCompleteCard';
import {
  EntryConfirmModal,
  ExitConfirmModal,
  ManualPositionModal,
} from '../components/TradeModals';
import { CONTENT_MAX_WIDTH } from '../constants/layout';
import { applyRealisedPnl, useAccount } from '../state/accountStore';
import {
  armLatch,
  ArmInput,
  clearLatch,
  latchClearReason,
  useEntryLatch,
} from '../state/entryLatchStore';
import { useSelectedPair } from '../state/pairStore';
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

/**
 * 1件ぶんの注文内容。
 * ENTRY NOW の注文票からも、指示が消えたあとの保持カードからも同じ形で扱う。
 */
type EntryDraft = Omit<ArmInput, 'pairId' | 'pairLabel'>;

export function HomeScreen() {
  const PAIR = useSelectedPair();
  const account = useAccount();
  const positionState = usePosition();
  const trades = useTrades();
  const daily = useMemo(() => summarise(trades), [trades]);

  const livePairs = useMemo(
    () => [{ id: PAIR.id, base: PAIR.base, quote: PAIR.quote }],
    [PAIR]
  );
  const { prices, live, staleMinutes, error: priceError } = useLivePrices(livePairs);
  const livePrice = prices[PAIR.id] ?? null;
  const price = livePrice?.mid ?? null;

  const { bars, context, loading } = useMarketData(PAIR);

  const [entryDraft, setEntryDraft] = useState<EntryDraft | null>(null);
  const [manualModal, setManualModal] = useState(false);
  const [exitModal, setExitModal] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
  const [completed, setCompleted] = useState<Trade | null>(null);
  const latch = useEntryLatch();

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

  /** いま出せる注文内容。条件が揃っていなければ null。 */
  const liveOrder = useMemo<EntryDraft | null>(() => {
    const bias = context?.bias;
    if (!context || bias === undefined || bias === 'HOLD') return null;
    if (!sizing?.ok || price === null) return null;
    const width = (context.atr ?? 0) * 0.25;
    return {
      direction: bias,
      price,
      sizing,
      entryLow: price - width,
      entryHigh: price + width,
      reasons: context.conditions.map((c) => `${c.label}: ${c.detail}`),
    };
  }, [context, sizing, price]);

  /**
   * ENTRY NOW が出たら、その注文内容を数分間そのまま保持する。
   * OANDAで注文して戻ってくる間に1分足が動いて「待つ」に戻っても、
   * 記録ボタンが消えないようにするため(消えると建玉を登録できない)。
   */
  useEffect(() => {
    if (action.kind !== 'ENTRY_NOW' || !liveOrder) return;
    armLatch({ pairId: PAIR.id, pairLabel: PAIR.label, ...liveOrder });
  }, [action.kind, liveOrder, PAIR]);

  /** そもそも入ってはいけなくなったら保持をやめる(方向反転・停止・データ異常)。 */
  useEffect(() => {
    if (!latch) return;
    const reason = latchClearReason(latch, {
      pairId: PAIR.id,
      kind: action.kind,
      bias: context?.bias ?? null,
    });
    if (reason) clearLatch();
  }, [latch, action.kind, context, PAIR.id]);

  const register = useCallback(
    (input: {
      direction: 'BUY' | 'SELL';
      entryPrice: number;
      units: number;
      tp: number;
      sl: number;
      reasons: string[];
    }) => {
      openPosition({
        pairId: PAIR.id,
        pairLabel: PAIR.label,
        direction: input.direction,
        entryPrice: input.entryPrice,
        units: input.units,
        tp: input.tp,
        sl: input.sl,
        entryReasons: input.reasons,
        openedAt: new Date().toISOString(),
      });
      // 記録できたので保持は役目を終える
      clearLatch();
      setEntryDraft(null);
      setManualModal(false);
    },
    [PAIR]
  );

  /** 手動登録の初期値。ATRが取れていれば推奨TP/SLを入れておく。 */
  const manualDefaults = useCallback(
    (direction: 'BUY' | 'SELL') => {
      const suggestion =
        price === null
          ? null
          : calculateSizing({ account, direction, entryPrice: price, atr: context?.atr ?? null });
      return {
        price,
        units: suggestion?.ok ? suggestion.units : 1000,
        tp: suggestion && suggestion.tp > 0 ? suggestion.tp : null,
        sl: suggestion && suggestion.sl > 0 ? suggestion.sl : null,
      };
    },
    [price, account, context]
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
  // 指示が消えたあとに残す保持カード。ENTRY NOW 中は本物の注文票が出ているので不要。
  const pendingLatch =
    !holding && latch && latch.pairId === PAIR.id && action.kind !== 'ENTRY_NOW'
      ? latch
      : null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* ① 通貨ペア ② 接続状況 ③ 現在価格 */}
      <LivePriceHeader
        price={livePrice}
        live={live}
        ageSeconds={health.ageSeconds}
        healthy={health.ok}
        closed={health.closed}
        lockPair={positionState.state === 'IN_POSITION'}
      />

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
        liveOrder && (
          <>
            <OrderTicket
              direction={liveOrder.direction}
              sizing={liveOrder.sizing}
              entryLow={liveOrder.entryLow}
              entryHigh={liveOrder.entryHigh}
              currentPrice={price}
            />
            <Pressable
              style={[styles.cta, styles.ctaPrimary]}
              onPress={() => setEntryDraft(liveOrder)}
            >
              <Text style={styles.ctaText}>エントリーした</Text>
            </Pressable>
          </>
        )
      )}

      {/* 指示が消えたあとの記録手段。ここが無いと、注文して戻ってきた時に
          「様子見」になっていて建玉を登録できない(仕様8のポジション管理へ進めない)。 */}
      {pendingLatch && (
        <PendingEntryCard
          latch={pendingLatch}
          currentPrice={price}
          onEntered={() =>
            // 約定価格の初期値は「今の値」のほうが実際に近い。指示時の値は残さない。
            setEntryDraft({ ...pendingLatch, price: price ?? pendingLatch.price })
          }
          onDismiss={clearLatch}
        />
      )}

      {/* 条件チェックリスト。ENTRY NOW 中は折りたたむ(もう読む必要がない)。
          休場中も出さない。「5/5 条件成立」と並ぶと、入れるのに入れないように見える。 */}
      {!holding && context && action.kind !== 'ENTRY_NOW' && action.kind !== 'CLOSED' && (
        <ConditionChecklist
          conditions={context.conditions}
          metCount={context.metCount}
          totalCount={context.totalCount}
        />
      )}

      {/* 停止中・データ異常は、なぜ止まっているかを畳まずに出す。
          ここを隠すとユーザーは「壊れている」としか分からない。 */}
      {(action.kind === 'DATA_ISSUE' ||
        action.kind === 'NO_TRADE' ||
        action.kind === 'CLOSED') && (
        <View style={[styles.alertCard, action.kind === 'CLOSED' && styles.infoCard]}>
          {action.reasons.map((reason, index) => (
            <Text
              key={index}
              style={[styles.alertLine, action.kind === 'CLOSED' && styles.infoLine]}
            >
              ・{reason}
            </Text>
          ))}
          {/* 取得そのものが失敗している時は、その文言をそのまま出す。
              「現在値をまだ取得できていません」だけだと、中継サーバが落ちているのか
              市場が閉まっているのかがユーザーに分からない。 */}
          {priceError && action.kind !== 'CLOSED' && (
            <Text style={styles.alertLine}>・{priceError}</Text>
          )}
        </View>
      )}

      {/* 保有しているのにアプリが知らない状態を作らないための逃げ道。
          指示が無い時でも登録できるようにしておく(決済ナビはここからしか始まらない)。 */}
      {!holding && !pendingLatch && (
        <Pressable style={styles.manualButton} onPress={() => setManualModal(true)}>
          <Text style={styles.manualButtonText}>
            すでに持っているポジションを登録する
          </Text>
        </Pressable>
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

      {entryDraft && (
        <EntryConfirmModal
          visible
          pairLabel={PAIR.label}
          direction={entryDraft.direction}
          suggestedPrice={entryDraft.price}
          suggestedUnits={entryDraft.sizing.units}
          slPips={entryDraft.sizing.slPips}
          tpPips={entryDraft.sizing.tpPips}
          onCancel={() => setEntryDraft(null)}
          onConfirm={(entryPrice, units, tp, sl) =>
            register({
              direction: entryDraft.direction,
              entryPrice,
              units,
              tp,
              sl,
              reasons: entryDraft.reasons,
            })
          }
        />
      )}
      {manualModal && (
        <ManualPositionModal
          visible
          pairLabel={PAIR.label}
          defaults={manualDefaults}
          onCancel={() => setManualModal(false)}
          onConfirm={(input) =>
            register({ ...input, reasons: ['手動で登録したポジションです'] })
          }
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
  manualButton: { paddingVertical: 8, alignItems: 'center' },
  manualButtonText: {
    fontSize: 11,
    color: '#64748B',
    textDecorationLine: 'underline',
  },
  alertCard: {
    backgroundColor: '#FFFBEB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FDE68A',
    padding: 12,
    gap: 3,
  },
  alertLine: { fontSize: 12, color: '#92400E', lineHeight: 18 },
  infoCard: { backgroundColor: '#F8FAFC', borderColor: '#CBD5E1' },
  infoLine: { color: '#475569' },
  whyCard: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 12, gap: 4 },
  whyLine: { fontSize: 12, color: '#334155', lineHeight: 18 },
  frameList: { marginTop: 6, gap: 2 },
  frameLine: { fontSize: 11, color: '#64748B' },
});
