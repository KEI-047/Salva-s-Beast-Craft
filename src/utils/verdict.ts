import { SignalAction } from '../types';
import { ActionStats, Backtest } from './statistics';

/**
 * エントリーしてよいかの判定。
 *
 * 勝率だけを見ると「方向は当たっているのに負ける」組み合わせを弾けない。
 * (勝率は方向しか数えないため、外れた時の値幅が大きいと収支はマイナスになる)
 * そのため次の3条件をすべて満たした場合のみ「条件クリア」とする。
 *
 *   1. サンプル数が十分か
 *   2. 勝率が損益分岐点に届いているか
 *   3. スプレッドを差し引いても1回あたりの期待値がプラスか
 */

/** リスクリワード 1:1.5 のときの損益分岐勝率 = 1 / (1 + 1.5) */
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
};

const ACTION_LABEL: Record<SignalAction, string> = {
  BUY: '買い',
  SELL: '売り',
  HOLD: '様子見',
};

function signedPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(3)}%`;
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

type Evaluation = { level: VerdictLevel; checks: VerdictCheck[]; expectancy: number };

/** 1方向ぶんの成績を3条件に照らす。現在のシグナルにも反対方向にも同じ関数を使う。 */
function evaluate(stats: ActionStats, cost: number | null): Evaluation {
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
    .map((other) => ({ ...other, evaluation: evaluate(other.stats, cost) }))
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

/**
 * 現在のシグナルについて、エントリーしてよいかを判定する。
 * cost は往復スプレッド(%)。現在値が取れていない場合は null(0%として扱う)。
 */
export function evaluateEntry(backtest: Backtest, cost: number | null): Verdict {
  const { current, currentAction } = backtest;
  const alternative = buildAlternative(backtest, cost);

  if (currentAction === 'HOLD' || !current) {
    return {
      level: 'no',
      action: 'HOLD',
      headline: 'エントリーしない',
      reason: '買い / 売りのシグナルが出ていません。次の足を待ってください。',
      checks: [],
      alternative,
    };
  }

  if (current.samples === 0) {
    return {
      level: 'no',
      action: currentAction,
      headline: 'エントリーしない',
      reason: 'この期間に同じシグナルが出た履歴がないため、成績を確認できません。',
      checks: evaluate(current, cost).checks,
      alternative,
    };
  }

  const { level, checks, expectancy } = evaluate(current, cost);
  const [winRateCheck, expectancyCheck] = checks;
  // すでに条件を満たしている時に「切り替わるのを待て」と言うと矛盾するため出さない。
  const hint = level === 'go' ? null : alternative;

  let headline: string;
  let reason: string;

  if (level === 'go') {
    headline = 'エントリー条件クリア';
    reason =
      '3つの条件をすべて満たしています。資金の1%までのリスクに抑えて建ててください。';
  } else if (level === 'weak') {
    headline = '条件は満たすがサンプル不足';
    reason =
      `勝率も期待値も条件を満たしていますが、サンプルが${current.samples}件と少なく、` +
      `偶然の可能性が残ります。見送るか、通常より小さい枚数に留めてください。`;
  } else {
    headline = 'エントリーしない';
    if (!winRateCheck.passed && !expectancyCheck.passed) {
      reason =
        `勝率が損益分岐(${Math.round(BREAK_EVEN_WIN_RATE * 100)}%)に届かず、` +
        `期待値もマイナス(${signedPercent(expectancy)})です。`;
    } else if (!winRateCheck.passed) {
      reason =
        `勝率が損益分岐(${Math.round(BREAK_EVEN_WIN_RATE * 100)}%)に届いていません。`;
    } else {
      reason =
        `方向が当たる回数は足りていますが、1回あたりの期待値がコスト差引後で` +
        `${signedPercent(expectancy)}です。続けるとスプレッド負けします。`;
    }
  }

  return { level, action: currentAction, headline, reason, checks, alternative: hint };
}
