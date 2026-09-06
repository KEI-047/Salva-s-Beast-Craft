import { useSyncExternalStore } from 'react';
import { DEFAULT_MAX_UNITS } from '../utils/orderRequest';

/**
 * 自動売買のスイッチ。
 *
 * 既定は「停止」かつ「送信しない(ドライラン)」。
 * 起動条件を3つとも自分で入れないと本番送信にならない作りにしてある。
 * 画面を開いただけ・リロードしただけで動き出すことは無い。
 *
 *   armed    … 自動売買そのもののON/OFF
 *   dryRun   … true の間は注文を組み立てて表示するだけで送信しない
 *   maxUnits … 1回に出せる上限数量(本番は最小ロットから)
 *
 * 緊急停止(disarm)はどの画面からでも1タップで効き、保存もされる。
 */

const STORAGE_KEY = 'hayabusa-fx:auto-trade';

export type AutoTradeSettings = {
  armed: boolean;
  dryRun: boolean;
  maxUnits: number;
  /** 1日にこの回数まで自動発注する。口座側の取引数上限とは別の、二重の歯止め */
  maxOrdersPerDay: number;
  /** 最後に自動発注した時刻(連打防止) */
  lastOrderAt: string | null;
  /** 本日の自動発注回数と、その「本日」がいつか(日付が変われば0に戻す) */
  ordersToday: number;
  ordersDate: string | null;
  /** 直近の停止理由。緊急停止したらここに残す */
  haltReason: string | null;
};

export const DEFAULT_AUTO_TRADE: AutoTradeSettings = {
  armed: false,
  dryRun: true,
  maxUnits: DEFAULT_MAX_UNITS,
  maxOrdersPerDay: 3,
  lastOrderAt: null,
  ordersToday: 0,
  ordersDate: null,
  haltReason: null,
};

/** 同じシグナルで連続発注しないための最短間隔 */
export const MIN_ORDER_INTERVAL_MS = 60 * 1000;

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function sanitise(value: unknown): AutoTradeSettings {
  const v = (value ?? {}) as Partial<AutoTradeSettings>;
  return {
    // 壊れた保存値から「稼働中」を復元しない。armed は明示的に true の時だけ。
    armed: v.armed === true,
    // 同様に、dryRun は明示的に false の時だけ解除する。
    dryRun: v.dryRun !== false,
    maxUnits:
      Number.isFinite(v.maxUnits) && (v.maxUnits as number) > 0
        ? Math.floor(v.maxUnits as number)
        : DEFAULT_AUTO_TRADE.maxUnits,
    maxOrdersPerDay:
      Number.isFinite(v.maxOrdersPerDay) && (v.maxOrdersPerDay as number) > 0
        ? Math.floor(v.maxOrdersPerDay as number)
        : DEFAULT_AUTO_TRADE.maxOrdersPerDay,
    lastOrderAt: typeof v.lastOrderAt === 'string' ? v.lastOrderAt : null,
    ordersToday:
      Number.isFinite(v.ordersToday) && (v.ordersToday as number) > 0
        ? Math.floor(v.ordersToday as number)
        : 0,
    ordersDate: typeof v.ordersDate === 'string' ? v.ordersDate : null,
    haltReason: typeof v.haltReason === 'string' ? v.haltReason : null,
  };
}

function load(): AutoTradeSettings {
  try {
    const raw = store()?.getItem(STORAGE_KEY);
    return raw ? sanitise(JSON.parse(raw)) : { ...DEFAULT_AUTO_TRADE };
  } catch {
    return { ...DEFAULT_AUTO_TRADE };
  }
}

let current: AutoTradeSettings = load();
const listeners = new Set<() => void>();

function emit() {
  try {
    store()?.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // 保存に失敗してもアプリ内の状態は保つ
  }
  listeners.forEach((listener) => listener());
}

export function setAutoTrade(patch: Partial<AutoTradeSettings>) {
  current = sanitise({ ...current, ...patch });
  emit();
}

/** 緊急停止。理由を残して必ずドライランへ戻す。 */
export function halt(reason: string) {
  current = { ...current, armed: false, dryRun: true, haltReason: reason };
  emit();
}

/** 日付が変わっていれば0に戻した上での、本日の自動発注回数。 */
export function ordersToday(settings: AutoTradeSettings, today = localDateKey()): number {
  return settings.ordersDate === today ? settings.ordersToday : 0;
}

/** 端末のローカル日付。UTCで数えると日本の夜に日付が変わってしまう。 */
export function localDateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function recordOrder(at = new Date()) {
  const today = localDateKey(at);
  current = {
    ...current,
    lastOrderAt: at.toISOString(),
    ordersToday: ordersToday(current, today) + 1,
    ordersDate: today,
  };
  emit();
}

export function useAutoTrade(): AutoTradeSettings {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => current
  );
}

export function getAutoTrade(): AutoTradeSettings {
  return current;
}
