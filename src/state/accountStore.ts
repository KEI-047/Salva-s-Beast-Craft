import { useSyncExternalStore } from 'react';

/**
 * 資金とリスク設定。
 * 既存の strategyStore / tradeSettings と同じ形(モジュール変数 + localStorage)に
 * そろえてある。状態管理ライブラリを足すと既存3ストアと二重管理になるため入れない。
 */

const STORAGE_KEY = 'hayabusa-fx:account';

export type AccountSettings = {
  /** 開始資金(円) */
  startingCapital: number;
  /** 現在資金(円)。決済のたびに実現損益を反映する */
  currentCapital: number;
  /** 1トレードで許容する資金の割合(%) */
  riskPercent: number;
  /** 1日の最大トレード数 */
  maxTradesPerDay: number;
  /** 1日の最大損失(資金に対する%) */
  maxDailyLossPercent: number;
  /** 何連敗で新規を止めるか */
  maxConsecutiveLosses: number;
  /** 次の目標資金(円) */
  goalCapital: number;
};

export const DEFAULT_ACCOUNT: AccountSettings = {
  startingCapital: 10000,
  currentCapital: 10000,
  riskPercent: 2,
  maxTradesPerDay: 5,
  // リスク2% × 3連敗ぶん。これに達したらその日は止める。
  maxDailyLossPercent: 6,
  maxConsecutiveLosses: 3,
  goalCapital: 30000,
};

/** 資金ロードマップの段階(仕様18)。確定的な予測は出さず、現在位置だけ示す。 */
export const CAPITAL_MILESTONES = [10000, 30000, 100000, 300000, 1000000];

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** 壊れた保存値で判定が破綻しないよう、数値の範囲を検査してから採用する。 */
function sanitize(saved: Partial<AccountSettings>): AccountSettings {
  const num = (value: unknown, fallback: number, min: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
      ? value
      : fallback;

  return {
    startingCapital: num(saved.startingCapital, DEFAULT_ACCOUNT.startingCapital, 1, 1e12),
    currentCapital: num(saved.currentCapital, DEFAULT_ACCOUNT.currentCapital, 0, 1e12),
    riskPercent: num(saved.riskPercent, DEFAULT_ACCOUNT.riskPercent, 0.1, 20),
    maxTradesPerDay: num(saved.maxTradesPerDay, DEFAULT_ACCOUNT.maxTradesPerDay, 1, 50),
    maxDailyLossPercent: num(
      saved.maxDailyLossPercent,
      DEFAULT_ACCOUNT.maxDailyLossPercent,
      0.5,
      100
    ),
    maxConsecutiveLosses: num(
      saved.maxConsecutiveLosses,
      DEFAULT_ACCOUNT.maxConsecutiveLosses,
      1,
      20
    ),
    goalCapital: num(saved.goalCapital, DEFAULT_ACCOUNT.goalCapital, 1, 1e12),
  };
}

function load(): AccountSettings {
  try {
    const raw = store()?.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_ACCOUNT;
    return sanitize(JSON.parse(raw) as Partial<AccountSettings>);
  } catch {
    return DEFAULT_ACCOUNT;
  }
}

let current: AccountSettings = load();
const listeners = new Set<() => void>();

function emit() {
  try {
    store()?.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // 保存に失敗してもアプリ内の値は有効なままにする
  }
  listeners.forEach((listener) => listener());
}

export function setAccount(patch: Partial<AccountSettings>) {
  current = sanitize({ ...current, ...patch });
  emit();
}

/** 決済時に実現損益を資金へ反映する。 */
export function applyRealisedPnl(pnlYen: number) {
  if (!Number.isFinite(pnlYen)) return;
  current = { ...current, currentCapital: Math.max(0, current.currentCapital + pnlYen) };
  emit();
}

/** 資金をやり直す(開始資金を設定し直す)。 */
export function resetCapital(startingCapital: number) {
  setAccount({ startingCapital, currentCapital: startingCapital });
}

export function useAccount(): AccountSettings {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => current
  );
}

export function getAccount(): AccountSettings {
  return current;
}

/** 次のマイルストーンと、そこまでの進捗(0〜1)。 */
export function milestoneProgress(account: AccountSettings): {
  from: number;
  to: number;
  ratio: number;
} {
  const to =
    CAPITAL_MILESTONES.find((m) => m > account.currentCapital) ??
    CAPITAL_MILESTONES[CAPITAL_MILESTONES.length - 1];
  const from =
    [...CAPITAL_MILESTONES].reverse().find((m) => m <= account.currentCapital) ??
    CAPITAL_MILESTONES[0];
  if (to <= from) return { from, to, ratio: 1 };
  const ratio = (account.currentCapital - from) / (to - from);
  return { from, to, ratio: Math.max(0, Math.min(1, ratio)) };
}
