import { BinaryHorizon, CurrencyPair, PricePoint, StrategyMode, TradeSettings } from '../types';
import { correctedConfidence, zForConfidence } from './normal';
import { ActionStats, backtestSignals } from './statistics';
import { breakEvenWinRate } from './tradeSettings';
import { BREAK_EVEN_WIN_RATE, MIN_SAMPLES, winRateLowerBound } from './verdict';

/**
 * 「条件を満たす組み合わせが本当に無いのか」を総当たりで確かめる。
 *
 * 手作業で通貨ペア・方針・判定時刻・厳選度を切り替えて回るのは非現実的なので、
 * すべての組み合わせを機械的に試す。ただし総当たりには固有の罠が2つあるため、
 * それぞれに対策を入れている。
 *
 * 1. 多重比較: 何百通りも試せば、優位性が無くても偶然よく見えるものが必ず出る。
 *    → 試行回数に応じて信頼水準を Šidák 補正で引き上げる。
 * 2. カーブフィッティング: 過去データに最も合う組み合わせを選ぶ行為そのものが、
 *    その期間への過剰適合になる。
 *    → 期間を「探索」と「検証」に分け、探索で通ったものを未使用の検証区間で試す。
 *       検証区間の成績だけが、将来に対して意味のある数字になる。
 */

/** 探索に使う期間の割合。残りは検証用に伏せておく。 */
export const TRAIN_RATIO = 0.7;

/** 試す厳選度(スコアのしきい値)。上げるほど指標の一致度が高い場面だけになる。 */
export const MIN_SCORE_OPTIONS = [2, 2.5, 3];

export const MODE_OPTIONS: StrategyMode[] = ['auto', 'trend', 'reversion'];

const MODE_LABEL: Record<StrategyMode, string> = {
  auto: '自動',
  trend: '順張り',
  reversion: '逆張り',
};

const MIN_SCORE_LABEL: Record<string, string> = {
  '2': '標準',
  '2.5': '厳しめ',
  '3': '最も厳しい',
};

export type ScanCombo = {
  pairId: string;
  pairLabel: string;
  mode: StrategyMode;
  modeLabel: string;
  horizonBars: number;
  minScore: number;
  minScoreLabel: string;
  direction: 'BUY' | 'SELL';
  directionLabel: string;
};

export type ScanResult = ScanCombo & {
  /** 探索区間の成績 */
  train: ActionStats;
  /** 検証区間(探索に使っていない期間)の成績 */
  test: ActionStats;
  /** 検証区間の勝率が損益分岐をどれだけ上回ったか(%ポイント) */
  testEdgePoints: number;
  /** 検証区間でも条件を満たしたか */
  confirmed: boolean;
};

export type ScanSummary = {
  /** 試した組み合わせの総数 */
  tested: number;
  /** 探索区間で条件を満たした組み合わせ */
  survivors: ScanResult[];
  /** そのうち検証区間でも条件を満たしたもの */
  confirmed: ScanResult[];
  /** 多重比較補正後に要求した信頼水準(片側) */
  confidence: number;
  /** 補正後の z 値 */
  z: number;
  /** 損益分岐勝率 */
  breakEven: number;
  /** 実際に集計に使った足数 */
  trainBars: number;
  testBars: number;
};

function statsFor(backtest: ReturnType<typeof backtestSignals>, direction: 'BUY' | 'SELL') {
  return direction === 'BUY' ? backtest.buy : backtest.sell;
}

/**
 * 1組み合わせが条件を満たすか。判定の考え方は evaluateEntry と同じだが、
 * 総当たり用に信頼水準(z)を差し替えられるようにしてある。
 */
function passes(
  stats: ActionStats,
  settings: TradeSettings,
  breakEven: number,
  z: number
): boolean {
  if (stats.samples < MIN_SAMPLES) return false;
  const winRate = stats.winRate ?? 0;
  if (winRate < breakEven) return false;
  if (winRateLowerBound(stats.wins, stats.samples, z) < breakEven) return false;
  // FXは値幅で損益が決まるため、勝率だけでなく平均変動率もプラスである必要がある。
  if (settings.tradeType === 'fx' && stats.avgMovePercent <= 0) return false;
  return true;
}

export type ScanInput = {
  pairs: CurrencyPair[];
  histories: Record<string, PricePoint[]>;
  settings: TradeSettings;
  /** バイナリーでは判定時刻も総当たりの対象にする */
  horizons: BinaryHorizon[];
};

export function runScan({ pairs, histories, settings, horizons }: ScanInput): ScanSummary {
  const breakEven =
    settings.tradeType === 'binary'
      ? breakEvenWinRate(settings.payout)
      : BREAK_EVEN_WIN_RATE;

  const combos: ScanCombo[] = [];
  pairs.forEach((pair) => {
    if (!histories[pair.id] || histories[pair.id].length === 0) return;
    MODE_OPTIONS.forEach((mode) => {
      horizons.forEach((horizonBars) => {
        MIN_SCORE_OPTIONS.forEach((minScore) => {
          (['BUY', 'SELL'] as const).forEach((direction) => {
            combos.push({
              pairId: pair.id,
              pairLabel: pair.label,
              mode,
              modeLabel: MODE_LABEL[mode],
              horizonBars,
              minScore,
              minScoreLabel: MIN_SCORE_LABEL[String(minScore)] ?? String(minScore),
              direction,
              directionLabel: direction === 'BUY' ? '買い' : '売り',
            });
          });
        });
      });
    });
  });

  // 試行回数に応じて要求水準を引き上げる。ここを固定の1.96のままにすると、
  // 数百通り試した中の「たまたま良く見えたもの」を本物として拾ってしまう。
  const confidence = correctedConfidence(0.975, Math.max(1, combos.length));
  const z = zForConfidence(confidence);

  let trainBars = 0;
  let testBars = 0;
  const survivors: ScanResult[] = [];

  // 同じ (ペア, 方針, 判定時刻, 厳選度) で買い/売り両方を見るので、
  // バックテストはその単位で一度だけ回して使い回す。
  const cache = new Map<string, { train: ReturnType<typeof backtestSignals>; test: ReturnType<typeof backtestSignals> }>();

  combos.forEach((combo) => {
    const history = histories[combo.pairId];
    const splitAt = Math.floor(history.length * TRAIN_RATIO);
    const train = history.slice(0, splitAt);
    const test = history.slice(splitAt);
    trainBars = train.length;
    testBars = test.length;

    const key = `${combo.pairId}|${combo.mode}|${combo.horizonBars}|${combo.minScore}`;
    let entry = cache.get(key);
    if (!entry) {
      entry = {
        train: backtestSignals(train, combo.mode, combo.horizonBars, combo.minScore),
        test: backtestSignals(test, combo.mode, combo.horizonBars, combo.minScore),
      };
      cache.set(key, entry);
    }

    const trainStats = statsFor(entry.train, combo.direction);
    if (!passes(trainStats, settings, breakEven, z)) return;

    const testStats = statsFor(entry.test, combo.direction);
    // 検証区間はサンプルが少なくなるため、件数条件は緩めて勝率と期待値だけを見る。
    const testWinRate = testStats.winRate ?? 0;
    const confirmed =
      testStats.samples > 0 &&
      testWinRate >= breakEven &&
      (settings.tradeType === 'binary' || testStats.avgMovePercent > 0);

    survivors.push({
      ...combo,
      train: trainStats,
      test: testStats,
      testEdgePoints: (testWinRate - breakEven) * 100,
      confirmed,
    });
  });

  // 検証区間で強いものを上に。将来に対して意味があるのはこちらの数字。
  survivors.sort((a, b) => b.testEdgePoints - a.testEdgePoints);

  return {
    tested: combos.length,
    survivors,
    confirmed: survivors.filter((result) => result.confirmed),
    confidence,
    z,
    breakEven,
    trainBars,
    testBars,
  };
}
