import { PricePoint } from '../types';
import { isWeekendClosed } from './marketHours';

/**
 * データが信用できる状態かの判定(仕様25)。
 *
 * 誤ったデータで売買指示を出すくらいなら、シグナルを止めるほうがいい。
 * ここが false を返す間、ENTRY NOW は絶対に出さない。
 */

/** 現在値がこの秒数更新されなければ「停止」とみなす */
export const STALE_SECONDS = 30;

/** 判定に最低限必要な足の本数(MACDが35本、ADXが28本必要) */
export const MIN_BARS = 60;

export type DataHealth = {
  ok: boolean;
  /** 止めている理由。ok のときは null */
  reason: string | null;
  /** 現在値が何秒前のものか。取得できていなければ null */
  ageSeconds: number | null;
  /**
   * 市場が閉まっているだけか。
   * 壊れているのと閉まっているのを画面で区別するために分けて持つ。
   * 休場中は価格が更新されないのが正常なので、「更新されていません」と出すのは誤解を招く。
   */
  closed: boolean;
};

export type HealthInput = {
  /** 現在値の最終更新時刻(ISO文字列)。取れていなければ null */
  lastPriceAt: string | null;
  /** 現在値 */
  price: number | null;
  bid?: number | null;
  ask?: number | null;
  /** 判定に使うローソク足 */
  bars: PricePoint[];
  /** 静的フォールバックを読んでいるか(定期取得の古い値) */
  usingFallback?: boolean;
  /** 市場が開いているか */
  tradeable?: boolean;
  /** スプレッドがこの倍率を超えたら異常とみなす基準(pips) */
  maxSpreadPips?: number;
  now?: Date;
};

/** 明らかにおかしい価格(0・負・NaN・極端な飛び値)を弾く */
function priceLooksBroken(price: number | null, bars: PricePoint[]): boolean {
  if (price === null || !Number.isFinite(price) || price <= 0) return true;
  if (bars.length === 0) return false;
  const reference = bars[bars.length - 1].rate;
  if (!Number.isFinite(reference) || reference <= 0) return true;
  // 直近の足から10%以上離れていれば、為替では異常値とみなす
  return Math.abs(price - reference) / reference > 0.1;
}

export function evaluateDataHealth({
  lastPriceAt,
  price,
  bid = null,
  ask = null,
  bars,
  usingFallback = false,
  tradeable = true,
  maxSpreadPips = 10,
  now = new Date(),
}: HealthInput): DataHealth {
  const parsed = lastPriceAt ? Date.parse(lastPriceAt) : NaN;
  const ageSeconds = Number.isNaN(parsed) ? null : (now.getTime() - parsed) / 1000;

  // 休場の判定は何よりも先。閉まっている間は価格が止まっているのが正常で、
  // 「更新されていません」「取得できていません」と出すと故障に見えてしまう。
  // 業者が返す status を優先し、取れていなければ時計で補う。
  if (!tradeable || isWeekendClosed(now)) {
    return {
      ok: false,
      reason: '市場が休場中です。',
      ageSeconds,
      closed: true,
    };
  }
  if (usingFallback) {
    return {
      ok: false,
      reason: '定期取得した過去の値を表示しています。新規エントリー判定は停止中です。',
      ageSeconds,
      closed: false,
    };
  }
  if (ageSeconds === null) {
    return {
      ok: false,
      reason: '現在値をまだ取得できていません。',
      ageSeconds: null,
      closed: false,
    };
  }
  if (ageSeconds > STALE_SECONDS) {
    return {
      ok: false,
      reason: `現在値が${Math.round(ageSeconds)}秒間更新されていません。`,
      ageSeconds,
      closed: false,
    };
  }
  if (priceLooksBroken(price, bars)) {
    return { ok: false, reason: '価格に異常値を検出しました。', ageSeconds, closed: false };
  }
  if (bars.length < MIN_BARS) {
    return {
      ok: false,
      reason: `判定に必要なローソク足が不足しています(${bars.length} / ${MIN_BARS}本)。`,
      ageSeconds,
      closed: false,
    };
  }
  if (bid !== null && ask !== null && price !== null) {
    const pip = price >= 20 ? 0.01 : 0.0001;
    const spreadPips = (ask - bid) / pip;
    if (spreadPips > maxSpreadPips) {
      return {
        ok: false,
        reason: `スプレッドが拡大しています(${spreadPips.toFixed(1)}pips)。`,
        ageSeconds,
        closed: false,
      };
    }
  }

  return { ok: true, reason: null, ageSeconds, closed: false };
}
