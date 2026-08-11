import { PricePoint, SignalAction, StrategyMode } from '../types';
import { actionFromScore, computeIndicators, scoreAt } from './signal';

export const BAR_MINUTES = 15;

/**
 * 統計の集計に使う既定の日数。
 * 一覧と詳細で同じ期間を見ないと勝率・期待値が食い違うため、両画面で共有する。
 */
export const DEFAULT_STATS_DAYS = 3;

/* --------------------------- 次の足の確定時刻 --------------------------- */

/** 直近の 00/15/30/45 分の区切りから、次の確定時刻を求める。 */
export function nextBarCloseAt(now: Date = new Date()): Date {
  const next = new Date(now);
  next.setSeconds(0, 0);
  next.setMinutes(Math.floor(now.getMinutes() / BAR_MINUTES) * BAR_MINUTES + BAR_MINUTES);
  return next;
}

export function formatCountdown(msRemaining: number): string {
  const total = Math.max(0, Math.floor(msRemaining / 1000));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export function formatClock(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/* ------------------------------ 過去検証 ------------------------------ */

export type ActionStats = {
  samples: number;
  wins: number;
  winRate: number | null; // 0-1、サンプル0なら null
  avgMovePercent: number; // 次の足の平均変動率(シグナル方向を正とする)
};

export type Backtest = {
  buy: ActionStats;
  sell: ActionStats;
  /** 現在のシグナルに対応する成績(HOLDの場合は null) */
  current: ActionStats | null;
  currentAction: SignalAction;
};

function emptyStats(): ActionStats {
  return { samples: 0, wins: 0, winRate: null, avgMovePercent: 0 };
}

function finalize(stats: ActionStats, moveSum: number): ActionStats {
  if (stats.samples === 0) return stats;
  return {
    ...stats,
    winRate: stats.wins / stats.samples,
    avgMovePercent: moveSum / stats.samples,
  };
}

/**
 * 過去の各足で同じルールのシグナルを算出し、「次の足」が
 * シグナルの方向に動いたかを集計する。表示中のシグナルの信頼度の目安になる。
 */
export function backtestSignals(
  history: PricePoint[],
  mode: StrategyMode = 'reversion'
): Backtest {
  const rates = history.map((point) => point.rate);
  const indicators = computeIndicators(rates);

  const buy = emptyStats();
  const sell = emptyStats();
  let buyMoveSum = 0;
  let sellMoveSum = 0;

  // 最後の足は「次の足」が存在しないため検証対象から外す。
  for (let i = 0; i < rates.length - 1; i++) {
    const action = actionFromScore(scoreAt(indicators, i, mode).score);
    if (action === 'HOLD') continue;

    const changePercent = ((rates[i + 1] - rates[i]) / rates[i]) * 100;
    // シグナル方向を正とした変動率に揃える。
    const directional = action === 'BUY' ? changePercent : -changePercent;

    if (action === 'BUY') {
      buy.samples++;
      buyMoveSum += directional;
      if (directional > 0) buy.wins++;
    } else {
      sell.samples++;
      sellMoveSum += directional;
      if (directional > 0) sell.wins++;
    }
  }

  const buyStats = finalize(buy, buyMoveSum);
  const sellStats = finalize(sell, sellMoveSum);

  const currentAction = actionFromScore(scoreAt(indicators, rates.length - 1, mode).score);
  const current =
    currentAction === 'BUY' ? buyStats : currentAction === 'SELL' ? sellStats : null;

  return { buy: buyStats, sell: sellStats, current, currentAction };
}

/* ------------------------------ 予想レンジ ------------------------------ */

export type Forecast = {
  /** 約68%(1σ)に収まる想定レンジ */
  low68: number;
  high68: number;
  /** 約95%(2σ)に収まる想定レンジ */
  low95: number;
  high95: number;
  /** 15分あたりの変動率の標準偏差(%) */
  volatilityPercent: number;
  latestRate: number;
};

/**
 * 直近の15分足リターンの標準偏差から、次の足で到達しうる価格帯を推定する。
 * ランダムウォークを仮定した目安であり、方向性の予測ではない。
 */
export function forecastNextBar(history: PricePoint[]): Forecast | null {
  const rates = history.map((point) => point.rate);
  if (rates.length < 20) return null;

  const returns: number[] = [];
  for (let i = 1; i < rates.length; i++) {
    if (rates[i - 1] > 0) returns.push(Math.log(rates[i] / rates[i - 1]));
  }
  if (returns.length < 10) return null;

  const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance =
    returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length - 1);
  const sd = Math.sqrt(variance);
  if (!Number.isFinite(sd) || sd === 0) return null;

  const latestRate = rates[rates.length - 1];
  return {
    low68: latestRate * Math.exp(-sd),
    high68: latestRate * Math.exp(sd),
    low95: latestRate * Math.exp(-2 * sd),
    high95: latestRate * Math.exp(2 * sd),
    volatilityPercent: (Math.exp(sd) - 1) * 100,
    latestRate,
  };
}
