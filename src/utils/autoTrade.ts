import { AccountSettings } from '../state/accountStore';
import { AutoTradeSettings, MIN_ORDER_INTERVAL_MS } from '../state/autoTradeStore';
import { PositionState } from '../state/positionStore';
import { DailySummary } from '../state/tradeHistoryStore';
import { CurrencyPair } from '../types';
import { DataHealth } from './dataHealth';
import { NextAction, stopReasons } from './nextAction';
import { buildMarketOrder, OrderPlan } from './orderRequest';
import { LOT_STEP, SizingResult } from './positionSizing';

/**
 * 自動発注してよいかの門番。
 *
 * 手動なら「押さない」で済むが、自動では**止める条件を漏らした瞬間に建つ**。
 * そのため、判定は decideNextAction の結論をそのまま信じるのではなく、
 * ここでもう一度すべての停止条件を独立に確認する(二重の歯止め)。
 *
 * 通す条件は全部そろって初めて成立:
 *   1. スイッチが入っている
 *   2. データが健全(休場・配信停止・異常値でない)
 *   3. ポジションを持っていない(同時保有は1つまで)
 *   4. 口座側の停止条件に触れていない(連敗・日次損失・取引数)
 *   5. 本日の自動発注回数が上限未満
 *   6. 直前の発注から一定時間空いている
 *   7. NEXT ACTION が ENTRY_NOW
 *   8. 数量・TP・SLが算出できている
 *   9. 注文が組み立て・検証を通る
 */

export type AutoDecision =
  | { fire: false; reason: string }
  | {
      fire: true;
      plan: Extract<OrderPlan, { ok: true }>;
      dryRun: boolean;
      /** 数量を上限まで絞ったなど、そのまま出していない場合の断り書き */
      note: string | null;
    };

export type AutoTradeInput = {
  settings: AutoTradeSettings;
  action: NextAction;
  health: DataHealth;
  account: AccountSettings;
  daily: DailySummary;
  position: PositionState;
  pair: CurrencyPair;
  sizing: SizingResult | null;
  price: number | null;
  /** 本日すでに自動発注した回数 */
  ordersToday: number;
  now?: number;
};

export function decideAutoTrade({
  settings,
  action,
  health,
  account,
  daily,
  position,
  pair,
  sizing,
  price,
  ordersToday,
  now = Date.now(),
}: AutoTradeInput): AutoDecision {
  if (!settings.armed) {
    return { fire: false, reason: '自動売買は停止中です。' };
  }
  if (health.closed) {
    return { fire: false, reason: '市場が休場中です。' };
  }
  if (!health.ok) {
    return { fire: false, reason: health.reason ?? 'データを確認できません。' };
  }
  if (position.state === 'IN_POSITION') {
    return { fire: false, reason: 'すでにポジションを保有しています。' };
  }

  // decideNextAction と同じ条件をここでも独立に見る。
  // 片方の実装が壊れても、もう片方で止まるようにしておく。
  const stops = stopReasons(account, daily);
  if (stops.length > 0) {
    return { fire: false, reason: stops.join(' / ') };
  }
  if (ordersToday >= settings.maxOrdersPerDay) {
    return {
      fire: false,
      reason: `本日の自動発注が上限(${settings.maxOrdersPerDay}回)に達しました。`,
    };
  }

  const last = settings.lastOrderAt ? Date.parse(settings.lastOrderAt) : NaN;
  if (Number.isFinite(last) && now - last < MIN_ORDER_INTERVAL_MS) {
    const wait = Math.ceil((MIN_ORDER_INTERVAL_MS - (now - last)) / 1000);
    return { fire: false, reason: `直前の発注から${wait}秒待ちます。` };
  }

  if (action.kind !== 'ENTRY_NOW') {
    return { fire: false, reason: 'エントリー条件がそろっていません。' };
  }
  if (action.direction === 'HOLD') {
    return { fire: false, reason: '方向が決まっていません。' };
  }
  if (!sizing?.ok || price === null) {
    return { fire: false, reason: sizing?.reason ?? '数量を算出できません。' };
  }

  // 資金が増えれば推奨数量も増える(複利)。ただし1回の上限は超えない。
  // ここは「拒否」ではなく「上限まで絞る」。絞るのは常にリスクを下げる方向で、
  // 上限を理由に一度も発注できないほうが設定の意図から外れる。
  const cap = Math.floor(settings.maxUnits / LOT_STEP) * LOT_STEP;
  if (cap < LOT_STEP) {
    return {
      fire: false,
      reason: `1回の上限が最小単位(${LOT_STEP.toLocaleString()}通貨)を下回っています。`,
    };
  }
  const units = Math.min(sizing.units, cap);
  const note =
    units < sizing.units
      ? `推奨数量 ${sizing.units.toLocaleString()}通貨 を上限の ${units.toLocaleString()}通貨 に絞りました。` +
        `想定損失は ${Math.round((sizing.maxLossYen * units) / sizing.units).toLocaleString()}円 になります。`
      : null;

  const plan = buildMarketOrder({
    pair,
    direction: action.direction,
    units,
    takeProfit: sizing.tp,
    stopLoss: sizing.sl,
    referencePrice: price,
    maxUnits: cap,
  });
  if (!plan.ok) {
    return { fire: false, reason: plan.reason };
  }

  return { fire: true, plan, dryRun: settings.dryRun, note };
}
