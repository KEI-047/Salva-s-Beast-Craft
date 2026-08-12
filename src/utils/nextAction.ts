import { AccountSettings } from '../state/accountStore';
import { hitTarget, OpenPosition, PositionState } from '../state/positionStore';
import { DailySummary } from '../state/tradeHistoryStore';
import { SignalAction } from '../types';
import { DataHealth } from './dataHealth';
import { MarketContext } from './marketContext';

/**
 * 「今なにをすればいいか」を1つに決める(仕様1・2)。
 *
 * 優先順位は絶対:
 *   データ異常 > 停止条件 > ポジション管理 > 新規エントリー
 *
 * 誤ったデータで指示を出すより止めるほうがいい(仕様25)し、
 * ポジションを持っている間は新規シグナルより決済管理が先(仕様8・10)。
 */

export type ActionKind =
  | 'DATA_ISSUE'
  | 'NO_TRADE'
  | 'WAIT'
  | 'READY'
  | 'ENTRY_NOW'
  | 'HOLD'
  | 'EXIT_NOW';

export type NextAction = {
  kind: ActionKind;
  /** かんたんモードでの表示(仕様2)。英語のステータス名を覚えなくていい */
  emoji: string;
  label: string;
  /** 一言の補足 */
  sub: string;
  /** BUY / SELL / HOLD。色だけでなく文字でも出すために持つ */
  direction: SignalAction;
  /** そう判定した理由 */
  reasons: string[];
  /** この状態で発注情報を出してよいか */
  showOrder: boolean;
};

export type DecisionInput = {
  health: DataHealth;
  account: AccountSettings;
  daily: DailySummary;
  position: PositionState;
  context: MarketContext | null;
  /** 現在価格 */
  price: number | null;
  /** 発注情報を作れたか(数量が最小単位に満たない等で作れないことがある) */
  sizingOk: boolean;
  sizingReason: string | null;
};

const DIRECTION_WORD: Record<SignalAction, string> = {
  BUY: '買い',
  SELL: '売り',
  HOLD: '様子見',
};

/** 本日の新規を止めるべきか(仕様27)。止める理由を全部返す。 */
export function stopReasons(
  account: AccountSettings,
  daily: DailySummary
): string[] {
  const reasons: string[] = [];
  if (daily.consecutiveLosses >= account.maxConsecutiveLosses) {
    reasons.push(`${daily.consecutiveLosses}連敗に達しました`);
  }
  if (daily.trades >= account.maxTradesPerDay) {
    reasons.push(`本日の取引数が上限(${account.maxTradesPerDay}回)に達しました`);
  }
  const lossLimit = account.currentCapital * (account.maxDailyLossPercent / 100);
  if (daily.pnlYen <= -lossLimit && lossLimit > 0) {
    reasons.push(
      `本日の損失が上限(${Math.round(lossLimit).toLocaleString()}円)に達しました`
    );
  }
  return reasons;
}

/** 保有中の決済判定。 */
function decideForPosition(
  position: OpenPosition,
  price: number | null,
  context: MarketContext | null
): NextAction {
  const reasons: string[] = [];

  if (price !== null) {
    const target = hitTarget(position, price);
    if (target === 'TP') reasons.push('利確目標に到達しました');
    if (target === 'SL') reasons.push('損切り価格に到達しました');
  }

  if (context) {
    const opposite = position.direction === 'BUY' ? 'SELL' : 'BUY';
    if (context.frames.minute.direction === opposite) {
      reasons.push('1分足が反転しました');
    }
    if (context.frames.fifteen.direction === opposite) {
      reasons.push('15分足の方向が変わりました');
    }
    if (price !== null) {
      const levels = position.direction === 'BUY' ? context.resistance : context.support;
      const near = levels.find(
        (level) => Math.abs(level - price) / price < 0.0005
      );
      if (near !== undefined) {
        reasons.push(
          `${position.direction === 'BUY' ? '抵抗帯' : '支持帯'}(${near.toFixed(3)})に接近しています`
        );
      }
    }
  }

  if (reasons.length > 0) {
    return {
      kind: 'EXIT_NOW',
      emoji: '🔴',
      label: '今すぐ決済',
      sub: 'OANDAで決済してください',
      direction: position.direction === 'BUY' ? 'SELL' : 'BUY',
      reasons,
      showOrder: false,
    };
  }

  return {
    kind: 'HOLD',
    emoji: '🔵',
    label: 'そのまま保有',
    sub: 'まだ決済しない',
    direction: position.direction,
    reasons: ['決済条件は成立していません'],
    showOrder: false,
  };
}

export function decideNextAction({
  health,
  account,
  daily,
  position,
  context,
  price,
  sizingOk,
  sizingReason,
}: DecisionInput): NextAction {
  // --- 1. データ異常が最優先。保有中でも「価格が信用できない」ことは伝える ---
  if (!health.ok && position.state === 'FLAT') {
    return {
      kind: 'DATA_ISSUE',
      emoji: '⚠',
      label: 'データ確認中',
      sub: '新規エントリー判定を停止しています',
      direction: 'HOLD',
      reasons: [health.reason ?? 'データを取得できていません', 'データ復旧後に自動再開します'],
      showOrder: false,
    };
  }

  // --- 2. 保有中はポジション管理を優先(仕様8) ---
  if (position.state === 'IN_POSITION') {
    return decideForPosition(position.position, price, context);
  }

  // --- 3. 停止条件(仕様27) ---
  const stops = stopReasons(account, daily);
  if (stops.length > 0) {
    return {
      kind: 'NO_TRADE',
      emoji: '⛔',
      label: '取引しない',
      sub: '本日の新規エントリーを停止しています',
      direction: 'HOLD',
      reasons: stops,
      showOrder: false,
    };
  }

  if (!context) {
    return {
      kind: 'WAIT',
      emoji: '🟡',
      label: '待つ',
      sub: 'まだ入らない',
      direction: 'HOLD',
      reasons: ['分析中です'],
      showOrder: false,
    };
  }

  // --- 4. 危険な相場は方向を出さない(仕様13) ---
  if (context.conflicted) {
    return {
      kind: 'NO_TRADE',
      emoji: '⛔',
      label: '取引しない',
      sub: '方向が一致していません',
      direction: 'HOLD',
      reasons: ['4時間足と1時間足が逆を向いています', 'どちらに動くか定まるまで待ちます'],
      showOrder: false,
    };
  }

  // --- 5. 新規エントリーの判定 ---
  const unmet = context.conditions.filter((condition) => !condition.met);
  const allMet = unmet.length === 0;

  if (allMet && !sizingOk) {
    // 条件は揃っているが建てられない。曖昧に「買い候補」を出すと誤操作を招く。
    return {
      kind: 'NO_TRADE',
      emoji: '⛔',
      label: '取引しない',
      sub: '発注できません',
      direction: 'HOLD',
      reasons: [sizingReason ?? '数量を算出できません'],
      showOrder: false,
    };
  }

  if (allMet && context.bias !== 'HOLD') {
    const buy = context.bias === 'BUY';
    return {
      kind: 'ENTRY_NOW',
      emoji: buy ? '🟢' : '🔴',
      label: buy ? '買う' : '売る',
      sub: 'ENTRY NOW',
      direction: context.bias,
      reasons: context.conditions.map((condition) => condition.detail),
      showOrder: true,
    };
  }

  // あと1条件(=トリガー待ち)なら READY。表示は「待つ」のまま(仕様5)。
  if (unmet.length === 1 && context.bias !== 'HOLD') {
    return {
      kind: 'READY',
      emoji: '🟡',
      label: '待つ',
      sub: `${DIRECTION_WORD[context.bias]}準備中`,
      direction: context.bias,
      reasons: [`あと1条件: ${unmet[0].detail}`, 'まだ注文しないでください'],
      showOrder: false,
    };
  }

  return {
    kind: 'WAIT',
    emoji: '🟡',
    label: '待つ',
    sub: 'まだ入らない',
    direction: 'HOLD',
    reasons: ['条件成立を待っています'],
    showOrder: false,
  };
}
