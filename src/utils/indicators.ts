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

/**
 * Kaufman の効率比(Efficiency Ratio)。
 * 「期間全体の正味の値動き ÷ 各足の値動きの合計」で 0〜1 を取り、
 * 1 に近いほど一方向に素直に伸びるトレンド相場、0 に近いほど往復の多い揉み合い相場を示す。
 * 終値だけで算出できるため、高値・安値を取得しない本アプリでも使える。
 */
export function efficiencyRatio(values: number[], period = 20): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  for (let i = period; i < values.length; i++) {
    const netMove = Math.abs(values[i] - values[i - period]);
    let totalMove = 0;
    for (let j = i - period + 1; j <= i; j++) {
      totalMove += Math.abs(values[j] - values[j - 1]);
    }
    result[i] = totalMove === 0 ? null : netMove / totalMove;
  }
  return result;
}

export function lastValid(values: (number | null)[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] !== null) return values[i];
  }
  return null;
}

/* ---------------------- v2: 高値・安値を使う指標 ---------------------- */

export type Candle = { high: number; low: number; close: number };

/**
 * True Range = 「その足で実際に動いた幅」。
 * 高値-安値だけでは、前の終値から窓を開けて飛んだぶんを取りこぼす。
 */
function trueRange(current: Candle, previousClose: number | null): number {
  const highLow = current.high - current.low;
  if (previousClose === null) return highLow;
  return Math.max(
    highLow,
    Math.abs(current.high - previousClose),
    Math.abs(current.low - previousClose)
  );
}

/**
 * ATR(Average True Range)。直近の値動きの大きさ。
 * 損切り幅を固定pipsにすると、静かな相場では広すぎ、荒れた相場では狭すぎる。
 * ATRに比例させることで相場の状態に合わせる。Wilder の平滑化を使う。
 */
export function atr(candles: Candle[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length <= period) return out;

  const ranges = candles.map((candle, i) =>
    trueRange(candle, i === 0 ? null : candles[i - 1].close)
  );

  // 最初の値は単純平均、以降は Wilder の平滑化
  let value = ranges.slice(1, period + 1).reduce((sum, r) => sum + r, 0) / period;
  out[period] = value;
  for (let i = period + 1; i < candles.length; i++) {
    value = (value * (period - 1) + ranges[i]) / period;
    out[i] = value;
  }
  return out;
}

/**
 * ADX(Average Directional Index)。トレンドの「強さ」を測る。方向は示さない。
 * 25以上でトレンド相場、20未満で揉み合いとみなすのが一般的。
 * 揉み合いで順張りシグナルを出さないための足切りに使う。
 */
export function adx(candles: Candle[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length <= period * 2) return out;

  const plusDM: number[] = [0];
  const minusDM: number[] = [0];
  const ranges: number[] = [trueRange(candles[0], null)];

  for (let i = 1; i < candles.length; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    // 大きく動いたほうだけを採用する(両方0のことも、片方だけのこともある)
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    ranges.push(trueRange(candles[i], candles[i - 1].close));
  }

  const wilder = (values: number[]): number[] => {
    const smoothed: number[] = new Array(values.length).fill(0);
    let sum = values.slice(1, period + 1).reduce((total, v) => total + v, 0);
    smoothed[period] = sum;
    for (let i = period + 1; i < values.length; i++) {
      sum = sum - sum / period + values[i];
      smoothed[i] = sum;
    }
    return smoothed;
  };

  const smoothedRange = wilder(ranges);
  const smoothedPlus = wilder(plusDM);
  const smoothedMinus = wilder(minusDM);

  const dx: (number | null)[] = new Array(candles.length).fill(null);
  for (let i = period; i < candles.length; i++) {
    const tr = smoothedRange[i];
    if (tr === 0) continue;
    const plusDI = (smoothedPlus[i] / tr) * 100;
    const minusDI = (smoothedMinus[i] / tr) * 100;
    const total = plusDI + minusDI;
    if (total === 0) continue;
    dx[i] = (Math.abs(plusDI - minusDI) / total) * 100;
  }

  // DX をさらに平滑化したものが ADX
  const start = period * 2;
  const seed = dx.slice(period, start).filter((v): v is number => v !== null);
  if (seed.length === 0) return out;
  let value = seed.reduce((sum, v) => sum + v, 0) / seed.length;
  out[start - 1] = value;
  for (let i = start; i < candles.length; i++) {
    if (dx[i] === null) continue;
    value = (value * (period - 1) + (dx[i] as number)) / period;
    out[i] = value;
  }
  return out;
}

/** 方向性指数 +DI / -DI の現在値。上昇圧力と下降圧力のどちらが強いか。 */
export function directionalIndex(
  candles: Candle[],
  period = 14
): { plus: number; minus: number } | null {
  if (candles.length <= period + 1) return null;
  let plus = 0;
  let minus = 0;
  let range = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    plus += upMove > downMove && upMove > 0 ? upMove : 0;
    minus += downMove > upMove && downMove > 0 ? downMove : 0;
    range += trueRange(candles[i], candles[i - 1].close);
  }
  if (range === 0) return null;
  return { plus: (plus / range) * 100, minus: (minus / range) * 100 };
}

export type SwingLevels = { support: number[]; resistance: number[] };

/**
 * サポート / レジスタンス候補。
 * 左右 lookback 本より高い(低い)足を転換点とみなし、直近のものから返す。
 * 「この価格帯に近づいたら利確・反転に注意」の判断に使う。
 */
export function swingLevels(
  candles: Candle[],
  lookback = 3,
  limit = 3
): SwingLevels {
  const support: number[] = [];
  const resistance: number[] = [];

  for (let i = candles.length - lookback - 1; i >= lookback; i--) {
    const window = candles.slice(i - lookback, i + lookback + 1);
    const isHigh = window.every((c) => c.high <= candles[i].high);
    const isLow = window.every((c) => c.low >= candles[i].low);
    if (isHigh && resistance.length < limit) resistance.push(candles[i].high);
    if (isLow && support.length < limit) support.push(candles[i].low);
    if (support.length >= limit && resistance.length >= limit) break;
  }
  return { support, resistance };
}
