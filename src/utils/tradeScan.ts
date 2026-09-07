import { CurrencyPair, PricePoint, StrategyMode } from '../types';
import { correctedConfidence, zForConfidence } from './normal';
import { TP_RR } from './positionSizing';
import { MIN_SCORE_OPTIONS, MODE_OPTIONS, TRAIN_RATIO } from './scan';
import { prepareSeries, runTradeBacktest, TradeBacktestResult } from './tradeBacktest';
import { winRateLowerBound } from './verdict';

/**
 * 「実際にTP/SLで決済したら勝てる組み合わせがあるのか」を総当たりで確かめる。
 *
 * 既存の runScan は「次の足が予想方向へ動いたか」で判定している。これは
 * 実際の取引とは別物で、**その勝率が高くても損益はマイナスになりうる**。
 * こちらは損切り・利確・スプレッドを込みで回した結果だけを見る。
 *
 * 総当たりの罠への対策は runScan と同じ考え方:
 * - 期間を探索(70%)と検証(30%)に分け、探索で選んだものを未使用区間で試す
 * - 何百通りも試せば偶然良く見えるものが出るため、Šidák 補正で水準を上げる
 *
 * 勝率の損益分岐は RR から決まる。RR 1:2 なら 1/(1+2) = 33.3% を上回らなければ
 * 期待値はプラスにならない(実際にはスプレッドと期限切れ決済のぶん、もう少し要る)。
 */

/** この本数に満たない組み合わせは、成績が良く見えても採用しない */
export const MIN_TRADES = 20;

/**
 * 試す決済ルール。
 *
 * 入り口(指標・厳選度・方向)は180通り試してきたが、**出口は1通りしか試していなかった**。
 * 出口は入り口と同じくらい損益を左右する。損切りが浅すぎればノイズで切られ、
 * 深すぎれば1回の負けが大きい。利確が遠すぎれば届かず期限切れになる。
 *
 * ただし試す数を増やせば、そのぶん多重比較の補正が厳しくなる。
 * 「たくさん試したから通った」を防ぐための代償であり、ここは受け入れる。
 */
export const SL_ATR_OPTIONS = [1, 1.5, 2.5];
export const RR_OPTIONS = [1, 1.5, 2, 3];

export function breakEvenWinRateFor(rr = TP_RR): number {
  return 1 / (1 + rr);
}

export type TradeScanCombo = {
  pairId: string;
  pairLabel: string;
  mode: StrategyMode;
  minScore: number;
  direction: 'BUY' | 'SELL';
  /** 損切り幅 = ATR × この倍率 */
  slAtr: number;
  /** 利確幅 = 損切り幅 × この倍率 */
  rr: number;
};

export type TradeScanResult = TradeScanCombo & {
  train: TradeBacktestResult;
  test: TradeBacktestResult;
  /** 検証区間でも条件を満たしたか */
  confirmed: boolean;
  /**
   * 検証で落ちた理由。null なら通過。
   * 「0件」だけを出すと、優位性が無いのか、そもそも判定できるだけの
   * 取引回数が無かったのかが区別できない。判断が変わるので必ず持つ。
   */
  failReason: string | null;
};

export type TradeScanSummary = {
  tested: number;
  /** 探索区間でプラスだった組み合わせ */
  survivors: TradeScanResult[];
  /** 検証区間でも通ったもの。将来に対して意味があるのはこれだけ */
  confirmed: TradeScanResult[];
  breakEven: number;
  confirmZ: number;
  trainBars: number;
  testBars: number;
  /** 判定不能な足(同じ足でTP/SL両方に接触)を損切り扱いにした総数 */
  ambiguousTotal: number;
  /**
   * 検証区間で「回数不足」を理由に落ちた件数。
   * これが多いなら、成績が悪いのではなく**期間が短くて判定できていない**。
   * 期間を延ばすべき状況を、0件という結果と区別するために持つ。
   */
  underpowered: number;
  /** 採用に必要な最低取引回数 */
  minTrades: number;
};

export type TradeScanInput = {
  pairs: CurrencyPair[];
  histories: Record<string, PricePoint[]>;
  /** 想定スプレッド(pips)。往復ぶん引かれる */
  spreadPips?: number;
};

export function runTradeScan({
  pairs,
  histories,
  spreadPips = 0.4,
}: TradeScanInput): TradeScanSummary {
  const breakEven = breakEvenWinRateFor();
  const combos: TradeScanCombo[] = [];

  pairs.forEach((pair) => {
    const history = histories[pair.id];
    if (!history || history.length === 0) return;
    MODE_OPTIONS.forEach((mode) => {
      MIN_SCORE_OPTIONS.forEach((minScore) => {
        (['BUY', 'SELL'] as const).forEach((direction) => {
          SL_ATR_OPTIONS.forEach((slAtr) => {
            RR_OPTIONS.forEach((rr) => {
              combos.push({
                pairId: pair.id,
                pairLabel: pair.label,
                mode,
                minScore,
                direction,
                slAtr,
                rr,
              });
            });
          });
        });
      });
    });
  });

  let trainBars = 0;
  let testBars = 0;
  let ambiguousTotal = 0;
  const survivors: TradeScanResult[] = [];

  // 指標とATRは足だけで決まる。ペア×区間ごとに1回計算して全組み合わせで使い回す。
  // これをやらないと、2000通り超の探索でブラウザが固まる。
  const prepared = new Map<
    string,
    { trainBars: PricePoint[]; testBars: PricePoint[]; train: ReturnType<typeof prepareSeries>; test: ReturnType<typeof prepareSeries> }
  >();
  pairs.forEach((pair) => {
    const history = histories[pair.id];
    if (!history || history.length === 0) return;
    const splitAt = Math.floor(history.length * TRAIN_RATIO);
    const trainBarsList = history.slice(0, splitAt);
    const testBarsList = history.slice(splitAt);
    trainBars = trainBarsList.length;
    testBars = testBarsList.length;
    prepared.set(pair.id, {
      trainBars: trainBarsList,
      testBars: testBarsList,
      train: prepareSeries(trainBarsList),
      test: prepareSeries(testBarsList),
    });
  });

  combos.forEach((combo) => {
    const entry = prepared.get(combo.pairId);
    if (!entry) return;

    const options = {
      mode: combo.mode,
      minScore: combo.minScore,
      spreadPips,
      onlyDirection: combo.direction,
      slAtrMultiplier: combo.slAtr,
      takeProfitRR: combo.rr,
    };
    const train = runTradeBacktest({
      bars: entry.trainBars,
      series: entry.train,
      ...options,
    });
    ambiguousTotal += train.ambiguousCount;

    // 探索区間でプラスでなければ、検証にかける価値がない。
    if (train.samples < MIN_TRADES || train.expectancyPips <= 0) return;

    const test = runTradeBacktest({
      bars: entry.testBars,
      series: entry.test,
      ...options,
    });
    ambiguousTotal += test.ambiguousCount;
    survivors.push({ ...combo, train, test, confirmed: false, failReason: null });
  });

  // 検証区間の判定。ここも「見えた」だけでは通さない。
  //
  // 補正は「検証にかけた件数」ではなく **試した組み合わせの総数** で行う。
  // 生き残りの数で補正すると、コストを引き上げて生き残りが減ったときに要求水準まで
  // 下がってしまい、「スプレッドを広げたほうが通りやすい」という逆転が起きる
  // (テストで実際に起きた)。総数で補正すれば水準は動かず、コストは常に不利に働く。
  const confirmZ = zForConfidence(
    correctedConfidence(0.975, Math.max(1, combos.length))
  );

  let underpowered = 0;
  survivors.forEach((result) => {
    const { test } = result;
    if (test.samples < MIN_TRADES) {
      result.failReason =
        `検証区間の取引が${test.samples}回しかありません(${MIN_TRADES}回以上が必要)。` +
        `成績が悪いのではなく、判定できるだけの回数が無かったということです。`;
      underpowered += 1;
      return;
    }
    if (test.expectancyPips <= 0) {
      result.failReason = `検証区間の1回あたりの損益がマイナス(${test.expectancyPips.toFixed(1)}pips)でした。`;
      return;
    }
    if ((test.profitFactor ?? 0) <= 1) {
      result.failReason = '検証区間で、利益の合計が損失の合計を超えませんでした。';
      return;
    }
    // 損益分岐の勝率は RR で決まる。RR 1:1 なら50%、1:3 なら25%。
    const comboBreakEven = breakEvenWinRateFor(result.rr);
    if (winRateLowerBound(test.wins, test.samples, confirmZ) < comboBreakEven) {
      const lower = winRateLowerBound(test.wins, test.samples, confirmZ) * 100;
      result.failReason =
        `検証区間は黒字でしたが、${combos.length}通りを試したぶんの補正をかけると、` +
        `勝率の下限が${lower.toFixed(1)}%となり損益分岐(${(comboBreakEven * 100).toFixed(1)}%)に届きません。` +
        `偶然の可能性を否定できません。`;
      return;
    }
    result.confirmed = true;
  });

  // 検証区間の期待値が高い順。探索区間の成績で並べても意味がない。
  survivors.sort((a, b) => b.test.expectancyPips - a.test.expectancyPips);

  return {
    tested: combos.length,
    survivors,
    confirmed: survivors.filter((result) => result.confirmed),
    breakEven,
    confirmZ,
    trainBars,
    testBars,
    ambiguousTotal,
    underpowered,
    minTrades: MIN_TRADES,
  };
}
