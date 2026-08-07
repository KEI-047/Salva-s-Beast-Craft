import {
  MarketRegime,
  PricePoint,
  SignalAction,
  SignalResult,
  StrategyMode,
} from '../types';
import { efficiencyRatio, macd, rsi, sma } from './indicators';

const SMA_SHORT_PERIOD = 5;
const SMA_LONG_PERIOD = 20;
const RSI_PERIOD = 14;
const RSI_OVERBOUGHT = 70;
const RSI_OVERSOLD = 30;
const ER_PERIOD = 20;
/**
 * 効率比がこの値以上ならトレンド相場とみなす。
 * ランダムな値動きでは概ね 0.1〜0.3 に収まるため、それを明確に上回る水準に置く。
 */
export const TREND_THRESHOLD = 0.35;

export type ResolvedMode = Exclude<StrategyMode, 'auto'>;

export type IndicatorSeries = {
  smaShort: (number | null)[];
  smaLong: (number | null)[];
  rsi: (number | null)[];
  macdHistogram: (number | null)[];
  efficiencyRatio: (number | null)[];
};

export function computeIndicators(rates: number[]): IndicatorSeries {
  return {
    smaShort: sma(rates, SMA_SHORT_PERIOD),
    smaLong: sma(rates, SMA_LONG_PERIOD),
    rsi: rsi(rates, RSI_PERIOD),
    macdHistogram: macd(rates).histogram,
    efficiencyRatio: efficiencyRatio(rates, ER_PERIOD),
  };
}

export function actionFromScore(score: number): SignalAction {
  if (score >= 2) return 'BUY';
  if (score <= -2) return 'SELL';
  return 'HOLD';
}

export function regimeFrom(er: number | null): MarketRegime | null {
  if (er === null) return null;
  return er >= TREND_THRESHOLD ? 'trend' : 'range';
}

/** auto の場合は効率比を見て、実際に適用する方針を決める。 */
export function resolveMode(
  mode: StrategyMode,
  er: number | null
): { applied: ResolvedMode; regime: MarketRegime | null } {
  const regime = regimeFrom(er);
  if (mode !== 'auto') return { applied: mode, regime };
  // 効率比が算出できない序盤は、より慎重な逆張り側に倒す。
  return { applied: regime === 'trend' ? 'trend' : 'reversion', regime };
}

export type ScoreResult = {
  score: number;
  reasons: string[];
  applied: ResolvedMode;
  regime: MarketRegime | null;
};

/**
 * 指定した足(index)時点でのスコアと根拠を算出する。
 * 画面表示と過去検証(統計)で必ず同じ判定を使うため、両者からこの関数を呼ぶ。
 */
export function scoreAt(
  indicators: IndicatorSeries,
  index: number,
  mode: StrategyMode = 'reversion'
): ScoreResult {
  const smaShort = indicators.smaShort[index];
  const smaLong = indicators.smaLong[index];
  const rsiValue = indicators.rsi[index];
  const macdHistogram = indicators.macdHistogram[index];
  const er = indicators.efficiencyRatio[index];

  const { applied, regime } = resolveMode(mode, er);

  let score = 0;
  const reasons: string[] = [];

  if (smaShort !== null && smaLong !== null) {
    if (smaShort > smaLong) {
      score += 1;
      reasons.push(
        `短期移動平均線(${SMA_SHORT_PERIOD}本)が長期移動平均線(${SMA_LONG_PERIOD}本)を上回っており、上昇トレンドの兆候です。`
      );
    } else if (smaShort < smaLong) {
      score -= 1;
      reasons.push(
        `短期移動平均線(${SMA_SHORT_PERIOD}本)が長期移動平均線(${SMA_LONG_PERIOD}本)を下回っており、下降トレンドの兆候です。`
      );
    }
  }

  if (rsiValue !== null) {
    if (rsiValue > RSI_OVERBOUGHT) {
      if (applied === 'trend') {
        // 順張り: 買われ過ぎ=勢いが強いとみなし、上昇継続に賭ける
        score += 1;
        reasons.push(
          `RSI(${rsiValue.toFixed(1)})が${RSI_OVERBOUGHT}を上回り、強い上昇の勢いが続いています。`
        );
      } else {
        score -= 1;
        reasons.push(
          `RSI(${rsiValue.toFixed(1)})が${RSI_OVERBOUGHT}を上回り、買われ過ぎ水準です。`
        );
      }
    } else if (rsiValue < RSI_OVERSOLD) {
      if (applied === 'trend') {
        score -= 1;
        reasons.push(
          `RSI(${rsiValue.toFixed(1)})が${RSI_OVERSOLD}を下回り、強い下落の勢いが続いています。`
        );
      } else {
        score += 1;
        reasons.push(
          `RSI(${rsiValue.toFixed(1)})が${RSI_OVERSOLD}を下回り、売られ過ぎ水準です。`
        );
      }
    } else if (rsiValue >= 50) {
      score += 0.5;
    } else {
      score -= 0.5;
    }
  }

  if (macdHistogram !== null) {
    if (macdHistogram > 0) {
      score += 1;
      reasons.push('MACDヒストグラムがプラスで、上昇モメンタムが優勢です。');
    } else if (macdHistogram < 0) {
      score -= 1;
      reasons.push('MACDヒストグラムがマイナスで、下降モメンタムが優勢です。');
    }
  }

  return { score, reasons, applied, regime };
}

export function buildSignal(
  history: PricePoint[],
  mode: StrategyMode = 'reversion'
): SignalResult {
  if (history.length === 0) {
    throw new Error('価格データがありません。');
  }
  const rates = history.map((point) => point.rate);
  const lastIndex = rates.length - 1;
  const latestRate = rates[lastIndex];
  const previousRate = rates[lastIndex - 1];
  const changePercent = previousRate
    ? ((latestRate - previousRate) / previousRate) * 100
    : 0;

  const indicators = computeIndicators(rates);
  const { score, reasons, applied, regime } = scoreAt(indicators, lastIndex, mode);

  if (reasons.length === 0) {
    reasons.push('十分なデータがないため、明確なシグナルはありません。');
  }

  return {
    action: actionFromScore(score),
    score,
    reasons,
    latestRate,
    changePercent,
    rsi: indicators.rsi[lastIndex],
    smaShort: indicators.smaShort[lastIndex],
    smaLong: indicators.smaLong[lastIndex],
    macdHistogram: indicators.macdHistogram[lastIndex],
    efficiencyRatio: indicators.efficiencyRatio[lastIndex],
    appliedMode: applied,
    regime,
  };
}
