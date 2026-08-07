import { PricePoint, SignalAction, SignalResult } from '../types';
import { macd, rsi, sma } from './indicators';

const SMA_SHORT_PERIOD = 5;
const SMA_LONG_PERIOD = 20;
const RSI_PERIOD = 14;
const RSI_OVERBOUGHT = 70;
const RSI_OVERSOLD = 30;

export type IndicatorSeries = {
  smaShort: (number | null)[];
  smaLong: (number | null)[];
  rsi: (number | null)[];
  macdHistogram: (number | null)[];
};

export function computeIndicators(rates: number[]): IndicatorSeries {
  return {
    smaShort: sma(rates, SMA_SHORT_PERIOD),
    smaLong: sma(rates, SMA_LONG_PERIOD),
    rsi: rsi(rates, RSI_PERIOD),
    macdHistogram: macd(rates).histogram,
  };
}

export function actionFromScore(score: number): SignalAction {
  if (score >= 2) return 'BUY';
  if (score <= -2) return 'SELL';
  return 'HOLD';
}

/**
 * 指定した足(index)時点でのスコアと根拠を算出する。
 * 画面表示と過去検証(統計)で必ず同じ判定を使うため、両者からこの関数を呼ぶ。
 */
export function scoreAt(
  indicators: IndicatorSeries,
  index: number
): { score: number; reasons: string[] } {
  const smaShort = indicators.smaShort[index];
  const smaLong = indicators.smaLong[index];
  const rsiValue = indicators.rsi[index];
  const macdHistogram = indicators.macdHistogram[index];

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
    if (rsiValue < RSI_OVERSOLD) {
      score += 1;
      reasons.push(`RSI(${rsiValue.toFixed(1)})が${RSI_OVERSOLD}を下回り、売られ過ぎ水準です。`);
    } else if (rsiValue > RSI_OVERBOUGHT) {
      score -= 1;
      reasons.push(`RSI(${rsiValue.toFixed(1)})が${RSI_OVERBOUGHT}を上回り、買われ過ぎ水準です。`);
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

  return { score, reasons };
}

export function buildSignal(history: PricePoint[]): SignalResult {
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
  const { score, reasons } = scoreAt(indicators, lastIndex);

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
  };
}
