import { PricePoint, SignalAction, StrategyMode } from '../types';
import { adx, atr, lastValid, swingLevels } from './indicators';
import { actionFromScore, computeIndicators, scoreAt } from './signal';
import { toCandles } from './timeframes';

/**
 * マルチタイムフレームの環境認識(仕様20)。
 *
 *   4時間 / 1時間 → 相場環境
 *   15分          → 方向
 *   5分           → セットアップ
 *   1分           → トリガー
 *
 * 上位足は「どちらに傾いているか」を見るだけで、エントリーの直接トリガーには
 * しない。日足・3日予測をトリガーに使わないのも同じ理由。
 */

/** ADXがこの値以上ならトレンドが出ているとみなす */
export const ADX_TREND_THRESHOLD = 25;

export type FrameRead = {
  label: string;
  direction: SignalAction;
  /** ADX(トレンドの強さ)。算出できなければ null */
  adx: number | null;
  bars: number;
};

export type BarsByFrame = {
  fourHour: PricePoint[];
  hourly: PricePoint[];
  fifteen: PricePoint[];
  five: PricePoint[];
  minute: PricePoint[];
};

/** 1つの足種の向きを読む。表示と判定で同じ scoreAt を共有する。 */
function readFrame(
  label: string,
  bars: PricePoint[],
  mode: StrategyMode,
  minScore: number
): FrameRead {
  if (bars.length < 30) {
    return { label, direction: 'HOLD', adx: null, bars: bars.length };
  }
  const rates = bars.map((bar) => bar.rate);
  const indicators = computeIndicators(rates);
  const score = scoreAt(indicators, rates.length - 1, mode).score;
  return {
    label,
    direction: actionFromScore(score, minScore),
    adx: lastValid(adx(toCandles(bars))),
    bars: bars.length,
    };
}

export type EntryCondition = {
  key: 'environment' | 'direction' | 'setup' | 'trigger' | 'edge';
  label: string;
  met: boolean;
  /** 満たしていない時に何を待っているか */
  detail: string;
};

export type MarketContext = {
  frames: { fourHour: FrameRead; hourly: FrameRead; fifteen: FrameRead; five: FrameRead; minute: FrameRead };
  /** 狙う方向。決まらなければ HOLD */
  bias: SignalAction;
  conditions: EntryCondition[];
  metCount: number;
  totalCount: number;
  /** 直近のATR(15分足・価格単位) */
  atr: number | null;
  support: number[];
  resistance: number[];
  /** 上位足どうしが逆を向いている(触るべきでない状態) */
  conflicted: boolean;
};

export type ContextInput = {
  bars: BarsByFrame;
  mode: StrategyMode;
  minScore: number;
  /** 既存の統計判定(勝率・期待値・サンプル数)が「見送り」でないか */
  edgeOk: boolean;
  edgeDetail: string;
};

export function buildMarketContext({
  bars,
  mode,
  minScore,
  edgeOk,
  edgeDetail,
}: ContextInput): MarketContext {
  const frames = {
    fourHour: readFrame('4時間', bars.fourHour, mode, minScore),
    hourly: readFrame('1時間', bars.hourly, mode, minScore),
    fifteen: readFrame('15分', bars.fifteen, mode, minScore),
    five: readFrame('5分', bars.five, mode, minScore),
    minute: readFrame('1分', bars.minute, mode, minScore),
  };

  // 上位足の向き。
  //
  // 「両方が向いていること」を条件にすると厳しすぎる。ほぼ直線的に伸びる相場では
  // MACDヒストグラムが0に収束して上位足が「方向なし」になり、実際にはきれいな
  // トレンドなのに何も出なくなる。向いている足だけを見て、それらが一致していれば
  // 環境は整っているとみなす。逆を向いている時だけ止める。
  const higher = [frames.fourHour.direction, frames.hourly.direction];
  const stated = higher.filter((direction) => direction !== 'HOLD');
  const agreed =
    stated.length > 0 && stated.every((direction) => direction === stated[0])
      ? stated[0]
      : ('HOLD' as SignalAction);
  const conflicted = stated.length === 2 && stated[0] !== stated[1];

  // 方向は15分足で決める。上位足と食い違うなら狙わない。
  const bias =
    agreed !== 'HOLD' && frames.fifteen.direction === agreed ? agreed : ('HOLD' as SignalAction);

  const trendStrong =
    (frames.hourly.adx ?? 0) >= ADX_TREND_THRESHOLD ||
    (frames.fourHour.adx ?? 0) >= ADX_TREND_THRESHOLD;

  const fifteenCandles = toCandles(bars.fifteen);
  const levels = swingLevels(fifteenCandles);

  const conditions: EntryCondition[] = [
    {
      key: 'environment',
      label: '市場環境',
      met: agreed !== 'HOLD' && trendStrong,
      detail:
        agreed === 'HOLD'
          ? conflicted
            ? '4時間足と1時間足が逆を向いています'
            : '上位足がどちらにも傾いていません'
          : trendStrong
            ? `上位足がそろっています(${agreed === 'BUY' ? '上昇' : '下降'})`
            : 'トレンドが弱く、揉み合いです',
    },
    {
      key: 'direction',
      label: '15分方向',
      met: bias !== 'HOLD',
      detail:
        frames.fifteen.direction === 'HOLD'
          ? '15分足の方向が定まっていません'
          : bias === 'HOLD'
            ? '15分足が上位足と逆を向いています'
            : `15分足が${bias === 'BUY' ? '上昇' : '下降'}を示しています`,
    },
    {
      key: 'setup',
      label: '5分セットアップ',
      // 押し目/戻りを待つので、5分足が一時的に逆を向いた後の同方向、
      // または既に同方向にそろっている状態を成立とみなす。
      met: bias !== 'HOLD' && frames.five.direction !== opposite(bias),
      detail:
        bias === 'HOLD'
          ? '方向が決まってから判定します'
          : frames.five.direction === opposite(bias)
            ? '5分足がまだ逆方向です'
            : '5分足が整いました',
    },
    {
      key: 'trigger',
      label: '1分トリガー',
      met: bias !== 'HOLD' && frames.minute.direction === bias,
      // 何を待っているのか分からないと、ユーザーは画面を開き直すしかない。
      // 1分足が「いまどちらを向いていて」「どうなれば成立するか」を書く。
      detail:
        bias === 'HOLD'
          ? '方向が決まってから判定します'
          : frames.minute.direction === bias
            ? '1分足が同方向へ動きました'
            : `1分足はいま${directionWord(frames.minute.direction)}。${
                bias === 'BUY' ? '上昇' : '下降'
              }に変われば成立`,
    },
    {
      key: 'edge',
      label: '統計・RR',
      met: edgeOk,
      detail: edgeDetail,
    },
  ];

  return {
    frames,
    bias,
    conditions,
    metCount: conditions.filter((condition) => condition.met).length,
    totalCount: conditions.length,
    atr: lastValid(atr(fifteenCandles)),
    support: levels.support,
    resistance: levels.resistance,
    conflicted,
  };
}

/** 表示用の向き。「方向なし」を空欄にすると何も分からないので必ず文字にする。 */
function directionWord(action: SignalAction): string {
  if (action === 'BUY') return '上昇';
  if (action === 'SELL') return '下降';
  return '方向なし';
}

function opposite(action: SignalAction): SignalAction {
  if (action === 'BUY') return 'SELL';
  if (action === 'SELL') return 'BUY';
  return 'HOLD';
}

/** 反転リスク(0〜1)。トレンドが弱いほど、方向性指数が拮抗するほど高い。 */
export function reversalRisk(context: MarketContext): number {
  const adxValue = context.frames.hourly.adx ?? context.frames.fifteen.adx ?? 0;
  const trendPart = Math.max(0, 1 - adxValue / 50);
  const conflictPart = context.conflicted ? 0.4 : 0;
  return Math.max(0, Math.min(1, trendPart * 0.7 + conflictPart));
}

/** トレンドの強さ(0〜1)。ADXを50で頭打ちにして正規化する。 */
export function trendStrength(context: MarketContext): number {
  const adxValue = context.frames.hourly.adx ?? context.frames.fifteen.adx ?? 0;
  return Math.max(0, Math.min(1, adxValue / 50));
}
