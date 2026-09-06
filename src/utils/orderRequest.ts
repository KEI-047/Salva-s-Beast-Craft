import { CurrencyPair } from '../types';
import { LOT_STEP } from './positionSizing';

/**
 * OANDA(v20)へ送る成行注文の中身を組み立てる。
 *
 * ここは**送信しない**。組み立てと検証だけを行う純粋関数に閉じてある。
 * 発注は一度送れば取り消せないので、「何を送るか」を目で確認できる形に
 * 切り出しておき、送信側(oandaTrade)はここが通した内容しか送れないようにする。
 *
 * 重要な取り決め:
 * - 数量の符号で売買を表す。買い = +units、売り = -units。
 *   ここを間違えると**逆のポジションを持つ**。単体テストで固定する。
 * - 価格は文字列で送る。丸め桁を間違えると業者側で拒否される。
 * - TP / SL の無い注文は組み立てない。損切りの無い建玉を自動で持つことは
 *   この設計では許さない。
 */

/** 対円は小数3桁、それ以外は5桁(OANDAの一般的な建て値の刻み) */
export function priceDigits(quote: string): number {
  return quote === 'JPY' ? 3 : 5;
}

/** 業者へ送る価格文字列。丸め桁を必ず通す。 */
export function formatPrice(value: number, digits: number): string {
  return value.toFixed(digits);
}

/** USD, JPY → USD_JPY */
export function instrumentOf(pair: Pick<CurrencyPair, 'base' | 'quote'>): string {
  return `${pair.base}_${pair.quote}`;
}

/**
 * 自動発注で1回に出せる最大数量。
 * 本番口座に繋ぐため、既定は最小ロットに固定する。
 * 資金が増えて複利で数量が伸びても、この上限を超える注文は組み立てない。
 */
export const DEFAULT_MAX_UNITS = LOT_STEP;

export type OrderPlanInput = {
  pair: CurrencyPair;
  direction: 'BUY' | 'SELL';
  /** 正の数量(通貨単位)。符号はここで付ける */
  units: number;
  takeProfit: number;
  stopLoss: number;
  /** 判定に使った価格。妥当性の確認に使う(送信はしない) */
  referencePrice: number;
  /** 1回の上限数量 */
  maxUnits?: number;
};

/** OANDA v20 の POST /v3/accounts/{accountID}/orders に渡す本体 */
export type OandaOrderRequest = {
  order: {
    type: 'MARKET';
    instrument: string;
    units: string;
    timeInForce: 'FOK';
    positionFill: 'DEFAULT';
    takeProfitOnFill: { price: string; timeInForce: 'GTC' };
    stopLossOnFill: { price: string; timeInForce: 'GTC' };
  };
};

export type OrderPlan =
  | { ok: true; request: OandaOrderRequest; summary: string[]; warnings: string[] }
  | { ok: false; reason: string };

/**
 * 注文を組み立てる。ひとつでも条件を満たさなければ組み立てない。
 * 「たぶん大丈夫」で通すと、そのまま本番の建玉になる。
 */
export function buildMarketOrder({
  pair,
  direction,
  units,
  takeProfit,
  stopLoss,
  referencePrice,
  maxUnits = DEFAULT_MAX_UNITS,
}: OrderPlanInput): OrderPlan {
  if (!Number.isFinite(units) || units <= 0) {
    return { ok: false, reason: '数量が正しくありません。' };
  }
  if (!Number.isInteger(units)) {
    return { ok: false, reason: '数量は整数である必要があります。' };
  }
  if (units % LOT_STEP !== 0) {
    return {
      ok: false,
      reason: `数量が最小単位(${LOT_STEP.toLocaleString()}通貨)の倍数ではありません。`,
    };
  }
  if (units > maxUnits) {
    return {
      ok: false,
      reason:
        `数量(${units.toLocaleString()})が1回の上限(${maxUnits.toLocaleString()}通貨)を` +
        `超えています。上限は資金設定から変更できます。`,
    };
  }
  if (![referencePrice, takeProfit, stopLoss].every((v) => Number.isFinite(v) && v > 0)) {
    return { ok: false, reason: '価格・利確・損切りのいずれかが取得できていません。' };
  }

  // 利確と損切りが方向に対して正しい側にあるか。
  // 逆側に置くと、建てた瞬間に決済されるか、業者に拒否される。
  const buy = direction === 'BUY';
  if (buy && !(takeProfit > referencePrice && stopLoss < referencePrice)) {
    return { ok: false, reason: '買いなのに利確が下、または損切りが上にあります。' };
  }
  if (!buy && !(takeProfit < referencePrice && stopLoss > referencePrice)) {
    return { ok: false, reason: '売りなのに利確が上、または損切りが下にあります。' };
  }

  const digits = priceDigits(pair.quote);
  const tp = formatPrice(takeProfit, digits);
  const sl = formatPrice(stopLoss, digits);

  // 丸めた結果、利確・損切りが現在値と同じ値に潰れていないか。
  // 刻みの細かいペアで距離が極端に近いと起こりうる。
  const reference = formatPrice(referencePrice, digits);
  if (tp === reference || sl === reference) {
    return { ok: false, reason: '利確または損切りが現在値と同じ値に丸められました。' };
  }

  const warnings: string[] = [];
  const slPips = Math.abs(referencePrice - stopLoss) / (pair.quote === 'JPY' ? 0.01 : 0.0001);
  if (slPips < 3) {
    warnings.push(`損切りが${slPips.toFixed(1)}pipsと非常に近く、すぐ切られる可能性があります。`);
  }

  const instrument = instrumentOf(pair);
  // 買いは正、売りは負。この符号が売買の向きそのものになる。
  const signedUnits = buy ? units : -units;

  return {
    ok: true,
    request: {
      order: {
        type: 'MARKET',
        instrument,
        units: String(signedUnits),
        // FOK: 指定数量が全部約定しなければ何も約定させない。部分約定を避ける。
        timeInForce: 'FOK',
        positionFill: 'DEFAULT',
        takeProfitOnFill: { price: tp, timeInForce: 'GTC' },
        stopLossOnFill: { price: sl, timeInForce: 'GTC' },
      },
    },
    summary: [
      `銘柄: ${instrument}`,
      `売買: ${buy ? '買い' : '売り'}(units ${signedUnits})`,
      `数量: ${units.toLocaleString()}通貨`,
      `利確: ${tp}`,
      `損切: ${sl}`,
      `参照価格: ${reference}`,
    ],
    warnings,
  };
}
