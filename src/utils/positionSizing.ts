import { AccountSettings } from '../state/accountStore';
import { pipSize } from './timeframes';

/**
 * 数量・TP・SL・最大損失の算出(仕様26)。
 *
 *   最大許容損失(円) = 現在資金 × リスク率
 *   1通貨あたりの損失 = SL距離 × 円換算レート
 *   推奨数量          = 最大許容損失 ÷ 1通貨あたりの損失
 *
 * 損切り幅は ATR に比例させる。固定pipsだと静かな相場では広すぎ、
 * 荒れた相場では狭すぎて、どちらもすぐ損切りに掛かる。
 */

/** OANDA証券(国内)の最小取引単位 */
export const LOT_STEP = 1000;

/** 損切り幅 = ATR × この倍率。1本ぶんの値動きでは浅すぎるため広げる。 */
export const SL_ATR_MULTIPLIER = 1.5;

/** 利確幅 = 損切り幅 × この倍率(リスクリワード 1:2) */
export const TP_RR = 2;

export type SizingInput = {
  account: AccountSettings;
  direction: 'BUY' | 'SELL';
  /** 想定エントリー価格 */
  entryPrice: number;
  /** 直近のATR(価格単位)。null なら算出できない */
  atr: number | null;
  /** 決済通貨→円のレート。対円ペアは1 */
  quoteToJpy?: number;
};

export type SizingResult = {
  ok: boolean;
  /** 建てられない場合の理由 */
  reason: string | null;
  units: number;
  tp: number;
  sl: number;
  slPips: number;
  tpPips: number;
  maxLossYen: number;
  targetProfitYen: number;
  riskReward: number;
};

const EMPTY: Omit<SizingResult, 'ok' | 'reason'> = {
  units: 0,
  tp: 0,
  sl: 0,
  slPips: 0,
  tpPips: 0,
  maxLossYen: 0,
  targetProfitYen: 0,
  riskReward: 0,
};

/**
 * 約定価格に対する TP / SL。
 *
 * TP/SL は「約定価格からの距離」で決まる。提示価格で算出した TP/SL を
 * そのまま使い回すと、実際の約定が離れていた場合に損切りが約定価格の
 * 反対側に来てしまい、登録した瞬間に「今すぐ決済」になる。
 */
export function targetsFor(
  direction: 'BUY' | 'SELL',
  entryPrice: number,
  slPips: number,
  tpPips: number
): { tp: number; sl: number } {
  const pip = pipSize(entryPrice);
  const slDistance = slPips * pip;
  const tpDistance = tpPips * pip;
  return direction === 'BUY'
    ? { tp: entryPrice + tpDistance, sl: entryPrice - slDistance }
    : { tp: entryPrice - tpDistance, sl: entryPrice + slDistance };
}

export function calculateSizing({
  account,
  direction,
  entryPrice,
  atr,
  quoteToJpy = 1,
}: SizingInput): SizingResult {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    return { ok: false, reason: '価格を取得できていません。', ...EMPTY };
  }
  if (atr === null || !Number.isFinite(atr) || atr <= 0) {
    return {
      ok: false,
      reason: '値動きの大きさ(ATR)を算出できていません。データが揃うまで待ちます。',
      ...EMPTY,
    };
  }

  const slDistance = atr * SL_ATR_MULTIPLIER;
  const tpDistance = slDistance * TP_RR;
  const pip = pipSize(entryPrice);

  const sl = direction === 'BUY' ? entryPrice - slDistance : entryPrice + slDistance;
  const tp = direction === 'BUY' ? entryPrice + tpDistance : entryPrice - tpDistance;

  const maxLossBudget = account.currentCapital * (account.riskPercent / 100);
  const lossPerUnit = slDistance * quoteToJpy;
  if (lossPerUnit <= 0) {
    return { ok: false, reason: '損切り幅を算出できません。', ...EMPTY };
  }

  const rawUnits = maxLossBudget / lossPerUnit;
  // 切り上げると設定したリスク率を超えてしまうため、必ず切り下げる。
  const units = Math.floor(rawUnits / LOT_STEP) * LOT_STEP;

  const common = {
    tp,
    sl,
    slPips: slDistance / pip,
    tpPips: tpDistance / pip,
    riskReward: TP_RR,
  };

  if (units < LOT_STEP) {
    return {
      ok: false,
      reason:
        `この資金と損切り幅では最小単位(${LOT_STEP.toLocaleString()}通貨)が` +
        `リスク許容度(${Math.round(maxLossBudget).toLocaleString()}円)を超えます。` +
        `資金を増やすか、リスク率を上げるまでエントリーしません。`,
      ...EMPTY,
      ...common,
      units: 0,
      maxLossYen: 0,
      targetProfitYen: 0,
    };
  }

  return {
    ok: true,
    reason: null,
    ...common,
    units,
    maxLossYen: units * lossPerUnit,
    targetProfitYen: units * tpDistance * quoteToJpy,
  };
}
