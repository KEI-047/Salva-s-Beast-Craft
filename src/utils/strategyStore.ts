import { useSyncExternalStore } from 'react';
import { StrategyMode } from '../types';

const STORAGE_KEY = 'hayabusa-fx:strategy-mode';
const VALID: StrategyMode[] = ['reversion', 'trend', 'auto'];

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function load(): StrategyMode {
  try {
    const saved = store()?.getItem(STORAGE_KEY) as StrategyMode | null | undefined;
    return saved && VALID.includes(saved) ? saved : 'auto';
  } catch {
    return 'auto';
  }
}

// 画面をまたいで共有し、選択を端末に保存する軽量ストア。
let current: StrategyMode = load();
const listeners = new Set<() => void>();

export function setStrategyMode(next: StrategyMode) {
  if (current === next) return;
  current = next;
  try {
    store()?.setItem(STORAGE_KEY, next);
  } catch {
    // 保存に失敗してもアプリ内の選択は有効なままにする
  }
  listeners.forEach((listener) => listener());
}

export function useStrategyMode(): StrategyMode {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => current
  );
}
