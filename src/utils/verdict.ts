import { SignalAction, TradeSettings } from '../types';
import { ActionStats, Backtest } from './statistics';
import { breakEvenWinRate, horizonLabel } from './tradeSettings';

/**
 * エントリーしてよいかの判定。FXとバイナリーで損益の決まり方が違うため、条件も分かれる。
 *
 * FX: 値幅で損益が決まる。勝率だけ見ると「方向は当たっているのに負ける」組み合わせ
 *     (外れた時の値幅が大きい)を弾けないので、コスト差引後の期待値を条件に入れる。
 *   1. 勝率がリスクリワードの損益分岐(40%)以上
 *   2. スプレッドを差し引いた期待値がプラス
 *   3. サンプル数が30件以上
 *
 * バイナリー: 当たれば固定倍率、外れれば全損。値幅は損益に一切影響しないため、
 *     期待値の条件は勝率の条件と同じものになる。代わりに必要勝率がぐっと高くなり
 *     (ペイアウト1.85倍なら54.1%)、少ないサンプルの高勝率に意味が無くなるので
 *     信頼区間の下限を条件に入れる。
 *   1. 勝率が 1 ÷ ペイアウト倍率 以上
 *   2. 勝率の95%信頼区間の下限も同じ水準以上
 *   3. サンプル数が30件以上
 */

/** FXの、リスクリワード 1:1.5 のときの損益分岐勝率 = 1 / (1 + 1.5) */
export const BREAK_EVEN_WIN_RATE = 0.4;

/** 統計として扱うために最低限必要なサンプル数 */
export const MIN_SAMPLES = 30;

export type VerdictLevel = 'go' | 'weak' | 'no';

export type VerdictCheck = {
  label: string;
  /** 実測値 */
  actual: string;
  /** 満たすべき条件 */
  required: string;
  passed: boolean;
};

export type Verdict = {
  level: VerdictLevel;
  action: SignalAction;
  /** 一言での結論 */
  headline: string;
  /** そう判定した理由(最初に落ちた条件を説明する) */
  reason: string;
  checks: VerdictCheck[];
  /** 反対方向なら条件を満たす場合の案内。なければ null */
  alternative: string | null;
  /** 条件表とは別に強調して出す指標(バイナリーの期待損益など)。なければ null */
  metric: { label: string; value: string; positive: boolean } | null;
};

const ACTION_LABEL: Record<SignalAction, string> = {
  BUY: '買い',
  SELL: '売り',
  HOLD: '様子見',
};

/** FXの値幅は小数3桁、バイナリーの期待損益は投資額に対する%なので1桁で足りる。 */
function signedPercent(value: number, digits = 3): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

/**
 * 現在値の bid/ask から往復コスト(スプレッド)を % で求める。
 * 買値で入って売値で出るため、この差がそのまま1往復のコストになる。
 */
export function spreadPercent(bid: number, ask: number): number | null {
  const mid = (bid + ask) / 2;
  if (!Number.isFinite(mid) || mid <= 0) return null;
  const spread = ask - bid;
  if (!Number.isFinite(spread) || spread < 0) return null;
  return (spread / mid) * 100;
}

/**
 * 勝率の95%信頼区間の下限(Wilson score interval)。
 * 「31件中16件当たった」程度では真の勝率が損益分岐を超えている保証がないため、
 * 少ないサンプルで出た高勝率を弾くのに使う。件数が少ないほど下限は大きく下がる。
 */
export function winRateLowerBound(wins: number, samples: number): number {
  if (samples <= 0) return 0;
  const z = 1.96;
  const p = wins / samples;
  const denominator = 1 + (z * z) / samples;
  const centre = p + (z * z) / (2 * samples);
  const margin =
    z * Math.sqrt((p * (1 - p)) / samples + (z * z) / (4 * samples * samples));
  return Math.max(0, (centre - margin) / denominator);
}

/**
 * バイナリーの1回あたりの期待損益(投資額に対する%)。
 * 当たれば (ペイアウト倍率 − 1) 倍の利益、外れれば投資額の全額が損失になる。
 */
export function binaryExpectancyPercent(winRate: number, payout: number): number {
  return (winRate * (payout - 1) - (1 - winRate)) * 100;
}

type Evaluation = { level: VerdictLevel; checks: VerdictCheck[]; expectancy: number };

/** 1方向ぶんの成績を、取引種別に応じた条件に照らす。 */
function evaluate(stats: ActionStats, settings: TradeSettings, cost: number | null): Evaluation {
  return settings.tradeType === 'binary'
    ? evaluateBinary(stats, settings)
    : evaluateFx(stats, cost);
}

/**
 * バイナリーの判定。
 * 値幅は損益に一切影響しないため、FXで使う平均変動率の条件は意味を持たない。
 * 代わりに、ペイアウト倍率から決まる損益分岐勝率を超えているかだけで決まる。
 */
function evaluateBinary(stats: ActionStats, settings: TradeSettings): Evaluation {
  const breakEven = breakEvenWinRate(settings.payout);
  const winRate = stats.winRate ?? 0;
  const lowerBound = winRateLowerBound(stats.wins, stats.samples);
  const expectancy = binaryExpectancyPercent(winRate, settings.payout);
  const breakEvenLabel = `${(breakEven * 100).toFixed(1)}%以上`;

  const checks: VerdictCheck[] = [
    {
      label: '勝率',
      // 損益分岐が54.1%のように小数を含むため、実測値も同じ桁で出す。
      // 整数に丸めると「54% / 54.1%以上」が合格に見えず、判定と矛盾して見える。
      actual: stats.samples > 0 ? `${(winRate * 100).toFixed(1)}%` : '—',
      required: breakEvenLabel,
      passed: stats.samples > 0 && winRate >= breakEven,
    },
    {
      label: '勝率の下限(95%信頼区間)',
      actual: stats.samples > 0 ? `${(lowerBound * 100).toFixed(1)}%` : '—',
      required: breakEvenLabel,
      passed: stats.samples > 0 && lowerBound >= breakEven,
    },
    {
      label: 'サンプル数',
      actual: `${stats.samples}件`,
      required: `${MIN_SAMPLES}件以上`,
      passed: stats.samples >= MIN_SAMPLES,
    },
  ];

  const [winRateCheck, boundCheck, samplesCheck] = checks;
  const level: VerdictLevel = !winRateCheck.passed
    ? 'no'
    : boundCheck.passed && samplesCheck.passed
      ? 'go'
      : 'weak';

  return { level, checks, expectancy };
}

/** FXの判定。値幅で損益が決まるため、コストを差し引いた期待値を条件に入れる。 */
function evaluateFx(stats: ActionStats, cost: number | null): Evaluation {
  const hurdle = cost ?? 0;
  const expectancy = stats.avgMovePercent - hurdle;
  const winRate = stats.winRate ?? 0;

  const checks: VerdictCheck[] = [
    {
      label: '勝率',
      actual: `${Math.round(winRate * 100)}%`,
      required: `${Math.round(BREAK_EVEN_WIN_RATE * 100)}%以上`,
      passed: stats.samples > 0 && winRate >= BREAK_EVEN_WIN_RATE,
    },
    {
      label: '1回あたりの期待値(コスト差引後)',
      actual: stats.samples > 0 ? signedPercent(expectancy) : '—',
      required: 'プラス',
      passed: stats.samples > 0 && expectancy > 0,
    },
    {
      label: 'サンプル数',
      actual: `${stats.samples}件`,
      required: `${MIN_SAMPLES}件以上`,
      passed: stats.samples >= MIN_SAMPLES,
    },
  ];

  const [winRateCheck, expectancyCheck, samplesCheck] = checks;
  const hasEdge = winRateCheck.passed && expectancyCheck.passed;
  const level: VerdictLevel = !hasEdge ? 'no' : samplesCheck.passed ? 'go' : 'weak';

  return { level, checks, expectancy };
}

/** 反対方向に妙味がある場合の案内文。無ければ null。 */
function buildAlternative(
  backtest: Backtest,
  settings: TradeSettings,
  cost: number | null
): string | null {
  const others: { action: Exclude<SignalAction, 'HOLD'>; stats: ActionStats }[] =
    backtest.currentAction === 'BUY'
      ? [{ action: 'SELL', stats: backtest.sell }]
      : backtest.currentAction === 'SELL'
        ? [{ action: 'BUY', stats: backtest.buy }]
        : [
            { action: 'BUY', stats: backtest.buy },
            { action: 'SELL', stats: backtest.sell },
          ];

  const promising = others
    .map((other) => ({ ...other, evaluation: evaluate(other.stats, settings, cost) }))
    .filter((other) => other.evaluation.level === 'go');

  if (promising.length === 0) return null;

  // 期待値が高いほうを案内する。
  promising.sort((a, b) => b.evaluation.expectancy - a.evaluation.expectancy);
  const best = promising[0];
  return (
    `このペアは「${ACTION_LABEL[best.action]}」なら3条件を満たします` +
    `(勝率${Math.round((best.stats.winRate ?? 0) * 100)}% / ${best.stats.samples}件)。` +
    `シグナルが切り替わるのを待つほうが有利です。`
  );
}

/** 判定が落ちた理由の文面。取引種別で見るべき数字が違うため分けている。 */
function buildReason(
  level: VerdictLevel,
  checks: VerdictCheck[],
  stats: ActionStats,
  settings: TradeSettings,
  expectancy: number
): string {
  const [first, second] = checks;

  if (settings.tradeType === 'binary') {
    const breakEven = (breakEvenWinRate(settings.payout) * 100).toFixed(1);
    if (level === 'go') {
      return (
        `3つの条件をすべて満たしています。1回あたりの期待損益は投資額の` +
        `${signedPercent(expectancy, 1)}です。バイナリーは外れると投資額が全額なくなるため、` +
        `1回の投資額は資金の1%までに抑えてください。`
      );
    }
    if (level === 'weak') {
      return !second.passed
        ? `勝率は損益分岐(${breakEven}%)を超えていますが、${stats.samples}件では` +
            `偶然の可能性を排除できません(95%信頼区間の下限が${second.actual})。` +
            `サンプルが増えるまで見送るのが安全です。`
        : `勝率は損益分岐(${breakEven}%)を超えていますが、サンプルが${stats.samples}件と` +
            `少なく、偶然の可能性が残ります。`;
    }
    return (
      `勝率がペイアウト${settings.payout.toFixed(2)}倍の損益分岐(${breakEven}%)に届いていません。` +
      `1回あたりの期待損益は投資額の${signedPercent(expectancy, 1)}で、続けるほど減ります。`
    );
  }

  if (level === 'go') {
    return '3つの条件をすべて満たしています。資金の1%までのリスクに抑えて建ててください。';
  }
  if (level === 'weak') {
    return (
      `勝率も期待値も条件を満たしていますが、サンプルが${stats.samples}件と少なく、` +
      `偶然の可能性が残ります。見送るか、通常より小さい枚数に留めてください。`
    );
  }
  const breakEven = Math.round(BREAK_EVEN_WIN_RATE * 100);
  if (!first.passed && !second.passed) {
    return `勝率が損益分岐(${breakEven}%)に届かず、期待値もマイナス(${signedPercent(expectancy)})です。`;
  }
  if (!first.passed) {
    return `勝率が損益分岐(${breakEven}%)に届いていません。`;
  }
  return (
    `方向が当たる回数は足りていますが、1回あたりの期待値がコスト差引後で` +
    `${signedPercent(expectancy)}です。続けるとスプレッド負けします。`
  );
}

/**
 * 現在のシグナルについて、エントリーしてよいかを判定する。
 * cost は往復スプレッド(%)で、FXの判定にのみ使う。
 * 現在値が取れていない場合は null(0%として扱う)。
 */
export function evaluateEntry(
  backtest: Backtest,
  settings: TradeSettings,
  cost: number | null
): Verdict {
  const { current, currentAction } = backtest;
  const alternative = buildAlternative(backtest, settings, cost);
  const binary = settings.tradeType === 'binary';

  if (currentAction === 'HOLD' || !current) {
    return {
      level: 'no',
      action: 'HOLD',
      headline: 'エントリーしない',
      reason: binary
        ? `買い(HIGH) / 売り(LOW) のシグナルが出ていません。次の足を待ってください。`
        : '買い / 売りのシグナルが出ていません。次の足を待ってください。',
      checks: [],
      alternative,
      metric: null,
    };
  }

  if (current.samples === 0) {
    return {
      level: 'no',
      action: currentAction,
      headline: 'エントリーしない',
      reason: `この期間に同じシグナルが出た履歴がないため、成績を確認できません。`,
      checks: evaluate(current, settings, cost).checks,
      alternative,
      metric: null,
    };
  }

  const { level, checks, expectancy } = evaluate(current, settings, cost);

  return {
    level,
    action: currentAction,
    headline:
      level === 'go'
        ? 'エントリー条件クリア'
        : level === 'weak'
          ? '条件は満たすがサンプル不足'
          : 'エントリーしない',
    reason: buildReason(level, checks, current, settings, expectancy),
    checks,
    // すでに条件を満たしている時に「切り替わるのを待て」と言うと矛盾するため出さない。
    alternative: level === 'go' ? null : alternative,
    // バイナリーは値幅が損益に効かないぶん、期待損益を独立した数字として出す。
    metric: binary
      ? {
          label: `1回あたりの期待損益(${horizonLabel(settings.horizonBars)}後判定)`,
          value: `投資額の ${signedPercent(expectancy, 1)}`,
          positive: expectancy > 0,
        }
      : null,
  };
}
