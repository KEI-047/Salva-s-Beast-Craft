import { useSyncExternalStore } from 'react';
import { CURRENCY_PAIRS, findPair } from '../constants/pairs';
import { CurrencyPair } from '../types';

/**
 * ホームで見ている通貨ペア。
 * ホームと分析で同じペアを見ないと話が食い違うため、画面間で共有する。
 */

const STORAGE_KEY = 'hayabusa-fx:selected-pair';

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function load(): string {
  try {
    const saved = store()?.getItem(STORAGE_KEY);
    // 保存値が壊れていても必ず実在するペアに落とす
    return saved && findPair(saved) ? saved : CURRENCY_PAIRS[0].id;
  } catch {
    return CURRENCY_PAIRS[0].id;
  }
}

let currentId = load();
const listeners = new Set<() => void>();

export function setSelectedPair(pairId: string) {
  if (!findPair(pairId) || pairId === currentId) return;
  currentId = pairId;
  try {
    store()?.setItem(STORAGE_KEY, pairId);
  } catch {
    // 保存に失敗してもアプリ内の選択は有効なままにする
  }
  listeners.forEach((listener) => listener());
}

export function useSelectedPairId(): string {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => currentId,
    () => currentId
  );
}

export function useSelectedPair(): CurrencyPair {
  const id = useSelectedPairId();
  return findPair(id) ?? CURRENCY_PAIRS[0];
}
