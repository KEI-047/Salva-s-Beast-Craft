import { PricePoint, StrategyMode } from '../types';
import { atr } from './indicators';
import { SL_ATR_MULTIPLIER, TP_RR } from './positionSizing';
import { actionFromScore, computeIndicators, scoreAt } from './signal';
import { pipSize, toCandles } from './timeframes';

/**
 * 実際の建玉ルール(TP/SL)で回した場合の成績。
 *
 * 既存の backtestSignals は「n本先の足がシグナル方向へ動いたか」しか見ていない。
 * これは実際の取引とは別物で、**勝率が高くても負ける**ことがある。
 * 損切りに一度掛かれば、その後どれだけ思った方向へ動いても損失は確定するし、
 * 利確に届いた取引はそこで止まるからだ。
 *
 * ここでは実際に使う決済ルールをそのまま回す:
 *   損切り = ATR × 1.5 / 利確 = 損切り幅 × 2(RR 1:2)
 *
 * 先読みを避けるための取り決め:
 * - シグナルは i 本目までの確定足だけで計算し、**約定は i+1 本目の始値**とする。
 *   同じ足の終値で入ると、その足の高値・安値を知った上で入ることになる。
 * - 1本の足の中で利確と損切りの両方に触れている場合、どちらが先かは
 *   OHLCからは分からない。**必ず損切りが先に来たものとして数える**。
 *   ここを楽観的に扱うと成績が実際より良く出る。
 * - スプレッドは往復ぶんを差し引く。
 */

/** 決済されないまま持ち続けないための上限(15分足の本数) */
export const MAX_HOLD_BARS = 96; // 15分足で1日

export type BacktestTrade = {
  entryIndex: number;
  exitIndex: number;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  exitPrice: number;
  /** 'TP' | 'SL' | 'TIMEOUT' */
  exitReason: 'TP' | 'SL' | 'TIMEOUT';
  /** スプレッド差引後の損益(pips) */
  pips: number;
  bars: number;
  /** 同じ足でTP/SL両方に触れ、損切り扱いにしたか */
  ambiguous: boolean;
};

export type TradeBacktestResult = {
  trades: BacktestTrade[];
  samples: number;
  wins: number;
  /** 0〜1。決済ベースの勝率 */
  winRate: number | null;
  /** 1取引あたりの平均損益(pips)。これが正でなければ回すだけ損 */
  expectancyPips: number;
  totalPips: number;
  /**
   * 総利益 ÷ 総損失。1.0 を超えなければ勝てない。
   * 負け取引が1件も無ければ Infinity(割る相手がいない = 最良)。
   * 取引が1件も無いときだけ null。null を 0 と読み替えると、
   * **全勝の組み合わせを最低評価として弾いてしまう**ので区別する。
   */
  profitFactor: number | null;
  /** 最大ドローダウン(pips)。資金がどこまで削られるか */
  maxDrawdownPips: number;
  /** 最大連敗数 */
  maxConsecutiveLosses: number;
  /** 判定不能な足(TP/SL同時ヒット)を損切り扱いした件数 */
  ambiguousCount: number;
};

/**
 * 足から一度だけ計算しておく系列。
 *
 * 指標もATRも「足」だけで決まり、判定方針・厳選度・売買方向・決済ルールには
 * 影響されない。総当たりでは同じ足を何千回も使い回すので、ここを毎回計算し直すと
 * 計算量が桁で変わる(2000通り超の探索が現実的な時間で終わらなくなる)。
 */
export type BarSeries = {
  opens: number[];
  highs: number[];
  lows: number[];
  closes: number[];
  indicators: ReturnType<typeof computeIndicators>;
  atrSeries: (number | null)[];
};

export function prepareSeries(bars: PricePoint[]): BarSeries {
  const candles = toCandles(bars);
  return {
    opens: bars.map((bar) => bar.open ?? bar.rate),
    highs: candles.map((candle) => candle.high),
    lows: candles.map((candle) => candle.low),
    closes: candles.map((candle) => candle.close),
    indicators: computeIndicators(bars.map((bar) => bar.rate)),
    atrSeries: atr(candles),
  };
}

export type TradeBacktestInput = {
  bars: PricePoint[];
  /** 事前に計算した系列。同じ足を繰り返し使う時に渡す */
  series?: BarSeries;
  mode: StrategyMode;
  minScore: number;
  /** 想定スプレッド(pips)。往復ぶんを引く */
  spreadPips?: number;
  slAtrMultiplier?: number;
  takeProfitRR?: number;
  maxHoldBars?: number;
  /** BUY / SELL のどちらだけを取るか。未指定なら両方 */
  onlyDirection?: 'BUY' | 'SELL';
};

const EMPTY: TradeBacktestResult = {
  trades: [],
  samples: 0,
  wins: 0,
  winRate: null,
  expectancyPips: 0,
  totalPips: 0,
  profitFactor: null,
  maxDrawdownPips: 0,
  maxConsecutiveLosses: 0,
  ambiguousCount: 0,
};

export function runTradeBacktest({
  bars,
  mode,
  minScore,
  spreadPips = 0.4,
  slAtrMultiplier = SL_ATR_MULTIPLIER,
  takeProfitRR = TP_RR,
  maxHoldBars = MAX_HOLD_BARS,
  onlyDirection,
  series,
}: TradeBacktestInput): TradeBacktestResult {
  if (bars.length < 60) return EMPTY;

  // 指標とATRは全区間まとめて1回だけ計算する。
  // 取引ごとに再計算すると本数×取引数になり、総当たり探索で現実的な速度にならない。
  const { opens, highs, lows, closes, indicators, atrSeries } =
    series ?? prepareSeries(bars);

  const trades: BacktestTrade[] = [];
  let index = 1;

  while (index < bars.length - 1) {
    const signalAtr = atrSeries[index];
    if (signalAtr === null || !Number.isFinite(signalAtr) || signalAtr <= 0) {
      index += 1;
      continue;
    }
    const score = scoreAt(indicators, index, mode).score;
    const action = actionFromScore(score, minScore);
    if (action === 'HOLD' || (onlyDirection && action !== onlyDirection)) {
      index += 1;
      continue;
    }

    // 先読み防止: 判定は index まで、約定は次の足の始値。
    const entryIndex = index + 1;
    const entryPrice = opens[entryIndex];
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
      index += 1;
      continue;
    }

    const buy = action === 'BUY';
    const slDistance = signalAtr * slAtrMultiplier;
    const tpDistance = slDistance * takeProfitRR;
    const stop = buy ? entryPrice - slDistance : entryPrice + slDistance;
    const target = buy ? entryPrice + tpDistance : entryPrice - tpDistance;

    let exitIndex = -1;
    let exitPrice = 0;
    let exitReason: BacktestTrade['exitReason'] = 'TIMEOUT';
    let ambiguous = false;

    const limit = Math.min(bars.length - 1, entryIndex + maxHoldBars);
    for (let j = entryIndex; j <= limit; j++) {
      const hitTp = buy ? highs[j] >= target : lows[j] <= target;
      const hitSl = buy ? lows[j] <= stop : highs[j] >= stop;

      if (hitTp && hitSl) {
        // 足の中の順序は分からない。悪いほう(損切り)で確定させる。
        ambiguous = true;
        exitIndex = j;
        exitPrice = stop;
        exitReason = 'SL';
        break;
      }
      if (hitSl) {
        exitIndex = j;
        exitPrice = stop;
        exitReason = 'SL';
        break;
      }
      if (hitTp) {
        exitIndex = j;
        exitPrice = target;
        exitReason = 'TP';
        break;
      }
    }

    if (exitIndex === -1) {
      exitIndex = limit;
      exitPrice = closes[limit];
      exitReason = 'TIMEOUT';
    }

    const diff = buy ? exitPrice - entryPrice : entryPrice - exitPrice;
    const pip = pipSize(entryPrice);
    // スプレッドは入りと出でそれぞれ掛かる
    const pips = diff / pip - spreadPips * 2;

    trades.push({
      entryIndex,
      exitIndex,
      direction: action,
      entryPrice,
      exitPrice,
      exitReason,
      pips,
      bars: exitIndex - entryIndex,
      ambiguous,
    });

    // 同時に複数持たない。決済した足の次から探し直す。
    index = exitIndex + 1;
  }

  return summarise(trades);
}

function summarise(trades: BacktestTrade[]): TradeBacktestResult {
  if (trades.length === 0) return EMPTY;

  let wins = 0;
  let totalPips = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let peak = 0;
  let equity = 0;
  let maxDrawdown = 0;
  let losses = 0;
  let maxLosses = 0;
  let ambiguousCount = 0;

  for (const trade of trades) {
    totalPips += trade.pips;
    equity += trade.pips;
    if (equity > peak) peak = equity;
    const drawdown = peak - equity;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;

    if (trade.pips > 0) {
      wins += 1;
      grossProfit += trade.pips;
      losses = 0;
    } else {
      grossLoss += -trade.pips;
      losses += 1;
      if (losses > maxLosses) maxLosses = losses;
    }
    if (trade.ambiguous) ambiguousCount += 1;
  }

  return {
    trades,
    samples: trades.length,
    wins,
    winRate: wins / trades.length,
    expectancyPips: totalPips / trades.length,
    totalPips,
    // 損失0は「算出不能」ではなく「最良」。null と混同しない。
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : Infinity,
    maxDrawdownPips: maxDrawdown,
    maxConsecutiveLosses: maxLosses,
    ambiguousCount,
  };
}
