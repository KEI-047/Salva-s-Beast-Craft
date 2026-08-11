/**
 * 標準正規分布の逆累積分布関数(Acklam の有理近似)。
 *
 * 多数の組み合わせを総当たりで試すと、本当は優位性が無くても偶然
 * 好成績に見えるものが必ず出る。それを弾くには試行回数に応じて
 * 有意水準を厳しくする必要があり、そのためには 1.96 のような
 * 固定値ではなく任意の水準に対応する z 値が要る。
 *
 * 絶対誤差は 1.15e-9 程度で、この用途には十分。
 */
const A = [
  -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
  1.383577518672690e2, -3.066479806614716e1, 2.506628277459239,
];
const B = [
  -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
  6.680131188771972e1, -1.328068155288572e1,
];
const C = [
  -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
  -2.549732539343734, 4.374664141464968, 2.938163982698783,
];
const D = [
  7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
  3.754408661907416,
];

const P_LOW = 0.02425;

export function inverseNormalCdf(p: number): number {
  if (!(p > 0 && p < 1)) return NaN;

  if (p < P_LOW) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      ((((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) /
        ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1))
    );
  }
  if (p > 1 - P_LOW) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -((((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) /
        ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1))
    );
  }
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q) /
    (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1)
  );
}

/**
 * 片側信頼水準に対応する z 値。既定の 0.975 は z = 1.96。
 * 総当たり探索では tests 件ぶん厳しくする(Šidák 補正)。
 */
export function zForConfidence(oneSidedConfidence: number): number {
  return inverseNormalCdf(oneSidedConfidence);
}

/**
 * Šidák 補正後の片側信頼水準。
 * tests 個の組み合わせを試して「どれか1つでも偶然通る」確率を
 * familywise に抑えるため、個々の水準を引き上げる。
 */
export function correctedConfidence(baseConfidence: number, tests: number): number {
  if (tests <= 1) return baseConfidence;
  // 各試行が独立に通る確率を c とすると、全部外れる確率は c^n。
  // これを元の信頼水準に等しく保つので c = baseConfidence^(1/n)。
  return Math.pow(baseConfidence, 1 / tests);
}
