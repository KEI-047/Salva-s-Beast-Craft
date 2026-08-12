import { useSyncExternalStore } from 'react';
import { pipSize } from '../utils/timeframes';

/**
 * 保有ポジション。
 *
 * localStorage に必ず保存する。ポジションを持っているのに画面を再読み込みして
 * 忘れてしまうと、決済ナビが出ないまま放置される事故になる。
 * 保有できるのは常に1つだけ(仕様のフローが1本道のため)。
 */

const STORAGE_KEY = 'hayabusa-fx:position';

export type OpenPosition = {
  pairId: string;
  pairLabel: string;
  direction: 'BUY' | 'SELL';
  /** OANDAでの実約定価格。GMOの提示値とは差が出るためユーザーが入力・修正する */
  entryPrice: number;
  units: number;
  tp: number;
  sl: number;
  /** エントリー時に成立していた条件(「なぜ入ったか」を履歴に残すため) */
  entryReasons: string[];
  openedAt: string;
};

export type PositionState =
  | { state: 'FLAT' }
  | { state: 'IN_POSITION'; position: OpenPosition };

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function valid(position: unknown): position is OpenPosition {
  const p = position as OpenPosition | null;
  return (
    !!p &&
    typeof p.pairId === 'string' &&
    (p.direction === 'BUY' || p.direction === 'SELL') &&
    Number.isFinite(p.entryPrice) &&
    p.entryPrice > 0 &&
    Number.isFinite(p.units) &&
    p.units > 0
  );
}

function load(): PositionState {
  try {
    const raw = store()?.getItem(STORAGE_KEY);
    if (!raw) return { state: 'FLAT' };
    const parsed = JSON.parse(raw);
    // 壊れた保存値で「持っていないのに保有中」にならないよう検査する
    return valid(parsed) ? { state: 'IN_POSITION', position: parsed } : { state: 'FLAT' };
  } catch {
    return { state: 'FLAT' };
  }
}

let current: PositionState = load();
const listeners = new Set<() => void>();

function emit() {
  try {
    if (current.state === 'IN_POSITION') {
      store()?.setItem(STORAGE_KEY, JSON.stringify(current.position));
    } else {
      store()?.removeItem(STORAGE_KEY);
    }
  } catch {
    // 保存に失敗してもアプリ内の状態は保つ
  }
  listeners.forEach((listener) => listener());
}

export function openPosition(position: OpenPosition) {
  current = { state: 'IN_POSITION', position };
  emit();
}

export function closePosition() {
  current = { state: 'FLAT' };
  emit();
}

/** 保有中に推奨保護SLを引き上げるなど、建玉の一部だけ更新する。 */
export function updatePosition(patch: Partial<OpenPosition>) {
  if (current.state !== 'IN_POSITION') return;
  current = { state: 'IN_POSITION', position: { ...current.position, ...patch } };
  emit();
}

export function usePosition(): PositionState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => current
  );
}

export function getPosition(): PositionState {
  return current;
}

/* --------------------------- 損益の計算 --------------------------- */

/**
 * 建玉の損益。
 * 対円ペアは「値幅 × 数量」がそのまま円になる。
 * クロスペア(EUR/USD等)は決済通貨がUSDなので、円換算レートを掛ける。
 */
export function positionPnl(
  position: OpenPosition,
  currentPrice: number,
  quoteToJpy = 1
): { pnlYen: number; pnlPips: number } {
  const diff =
    position.direction === 'BUY'
      ? currentPrice - position.entryPrice
      : position.entryPrice - currentPrice;
  return {
    pnlYen: diff * position.units * quoteToJpy,
    pnlPips: diff / pipSize(position.entryPrice),
  };
}

/** TP / SL に到達しているか。到達判定は方向で向きが逆になる。 */
export function hitTarget(
  position: OpenPosition,
  currentPrice: number
): 'TP' | 'SL' | null {
  if (position.direction === 'BUY') {
    if (currentPrice >= position.tp) return 'TP';
    if (currentPrice <= position.sl) return 'SL';
  } else {
    if (currentPrice <= position.tp) return 'TP';
    if (currentPrice >= position.sl) return 'SL';
  }
  return null;
}
