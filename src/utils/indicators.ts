export function sma(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += values[j];
    }
    result[i] = sum / period;
  }
  return result;
}

export function ema(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return result;

  const multiplier = 2 / (period + 1);
  let previousEma =
    values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  result[period - 1] = previousEma;

  for (let i = period; i < values.length; i++) {
    previousEma = (values[i] - previousEma) * multiplier + previousEma;
    result[i] = previousEma;
  }
  return result;
}

export function rsi(values: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (values.length <= period) return result;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gainSum += change;
    else lossSum -= change;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  result[period] = computeRsiValue(avgGain, avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = computeRsiValue(avgGain, avgLoss);
  }
  return result;
}

function computeRsiValue(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export type MacdResult = {
  macdLine: (number | null)[];
  signalLine: (number | null)[];
  histogram: (number | null)[];
};

export function macd(
  values: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): MacdResult {
  const fastEma = ema(values, fastPeriod);
  const slowEma = ema(values, slowPeriod);

  const macdLine: (number | null)[] = values.map((_, i) => {
    const fast = fastEma[i];
    const slow = slowEma[i];
    return fast !== null && slow !== null ? fast - slow : null;
  });

  const macdValuesOnly: number[] = [];
  const macdIndexes: number[] = [];
  macdLine.forEach((value, i) => {
    if (value !== null) {
      macdValuesOnly.push(value);
      macdIndexes.push(i);
    }
  });

  const signalOnValidValues = ema(macdValuesOnly, signalPeriod);
  const signalLine: (number | null)[] = new Array(values.length).fill(null);
  signalOnValidValues.forEach((value, i) => {
    if (value !== null) {
      signalLine[macdIndexes[i]] = value;
    }
  });

  const histogram: (number | null)[] = values.map((_, i) => {
    const m = macdLine[i];
    const s = signalLine[i];
    return m !== null && s !== null ? m - s : null;
  });

  return { macdLine, signalLine, histogram };
}

export function lastValid(values: (number | null)[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] !== null) return values[i];
  }
  return null;
}
