import { useSyncExternalStore } from 'react';

/**
 * トレード履歴。
 *
 * 本日の取引数・損益・連敗数は履歴から毎回導出する。別に持つと必ずズレるため
 * 保存しない。日付は端末のローカル日付で判定する(0時リセット)。
 */

const STORAGE_KEY = 'hayabusa-fx:trades';
/** 端末に貯め続けないよう、直近ぶんだけ保持する */
const MAX_TRADES = 500;

export type TradeResult = 'WIN' | 'LOSS' | 'EVEN';

export type Trade = {
  id: string;
  pairId: string;
  pairLabel: string;
  direction: 'BUY' | 'SELL';
  /** OANDAでの実約定価格(ユーザー入力) */
  entryPrice: number;
  exitPrice: number;
  units: number;
  tp: number;
  sl: number;
  entryReasons: string[];
  exitReasons: string[];
  openedAt: string;
  closedAt: string;
  pnlYen: number;
  pnlPips: number;
  result: TradeResult;
};

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function load(): Trade[] {
  try {
    const raw = store()?.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Trade[]) : [];
  } catch {
    return [];
  }
}

let trades: Trade[] = load();
const listeners = new Set<() => void>();

function emit() {
  try {
    store()?.setItem(STORAGE_KEY, JSON.stringify(trades));
  } catch {
    // 容量超過などで保存に失敗してもメモリ上の履歴は保つ
  }
  listeners.forEach((listener) => listener());
}

export function addTrade(trade: Trade) {
  // 新しい順に並べる。表示も履歴画面もこの順で使う。
  trades = [trade, ...trades].slice(0, MAX_TRADES);
  emit();
}

export function clearTrades() {
  trades = [];
  emit();
}

export function useTrades(): Trade[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => trades,
    () => trades
  );
}

export function getTrades(): Trade[] {
  return trades;
}

/* --------------------------- 日次の集計 --------------------------- */

/** 端末のローカル日付。UTCで切ると日本時間の深夜に日付が変わってしまう。 */
export function localDateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export type DailySummary = {
  trades: number;
  wins: number;
  losses: number;
  pnlYen: number;
  /** 直近から数えた連敗数。勝ちが1回でも入ると0に戻る */
  consecutiveLosses: number;
};

export function summarise(
  allTrades: Trade[],
  today: string = localDateKey()
): DailySummary {
  const todays = allTrades.filter((trade) => localDateKey(new Date(trade.closedAt)) === today);

  let consecutiveLosses = 0;
  // trades は新しい順。先頭から負けが続く数を数える。
  for (const trade of allTrades) {
    if (trade.result === 'LOSS') consecutiveLosses++;
    else break;
  }

  return {
    trades: todays.length,
    wins: todays.filter((trade) => trade.result === 'WIN').length,
    losses: todays.filter((trade) => trade.result === 'LOSS').length,
    pnlYen: todays.reduce((sum, trade) => sum + trade.pnlYen, 0),
    consecutiveLosses,
  };
}
