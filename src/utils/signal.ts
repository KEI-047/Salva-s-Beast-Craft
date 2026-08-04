import { PricePoint, SignalResult } from '../types';
import { lastValid, macd, rsi, sma } from './indicators';

const SMA_SHORT_PERIOD = 5;
const SMA_LONG_PERIOD = 20;
const RSI_PERIOD = 14;
const RSI_OVERBOUGHT = 70;
const RSI_OVERSOLD = 30;

export function buildSignal(history: PricePoint[]): SignalResult {
  if (history.length === 0) {
    throw new Error('価格データがありません。');
  }
  const rates = history.map((point) => point.rate);
  const latestRate = rates[rates.length - 1];
  const previousRate = rates[rates.length - 2];
  const changePercent = previousRate
    ? ((latestRate - previousRate) / previousRate) * 100
    : 0;

  const smaShortSeries = sma(rates, SMA_SHORT_PERIOD);
  const smaLongSeries = sma(rates, SMA_LONG_PERIOD);
  const rsiSeries = rsi(rates, RSI_PERIOD);
  const { histogram } = macd(rates);

  const smaShort = lastValid(smaShortSeries);
  const smaLong = lastValid(smaLongSeries);
  const rsiValue = lastValid(rsiSeries);
  const macdHistogram = lastValid(histogram);

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

  let action: SignalResult['action'] = 'HOLD';
  if (score >= 2) action = 'BUY';
  else if (score <= -2) action = 'SELL';

  if (reasons.length === 0) {
    reasons.push('十分なデータがないため、明確なシグナルはありません。');
  }

  return {
    action,
    score,
    reasons,
    latestRate,
    changePercent,
    rsi: rsiValue,
    smaShort,
    smaLong,
    macdHistogram,
  };
}
