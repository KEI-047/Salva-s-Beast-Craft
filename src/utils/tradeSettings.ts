import { useSyncExternalStore } from 'react';
import { BinaryHorizon, TradeSettings, TradeType } from '../types';
import { BAR_MINUTES } from './statistics';

const STORAGE_KEY = 'hayabusa-fx:trade-settings';

export const PAYOUT_OPTIONS = [1.8, 1.85, 1.9, 2.0];
export const HORIZON_OPTIONS: BinaryHorizon[] = [1, 4, 8];

const DEFAULTS: TradeSettings = { tradeType: 'fx', payout: 1.85, horizonBars: 1 };

/** 判定時刻までの分数 */
export function horizonMinutes(horizonBars: number): number {
  return horizonBars * BAR_MINUTES;
}

export function horizonLabel(horizonBars: number): string {
  const minutes = horizonMinutes(horizonBars);
  return minutes < 60 ? `${minutes}分` : `${minutes / 60}時間`;
}

/** ペイアウト倍率から損益分岐勝率を求める。1.85倍なら 54.1%。 */
export function breakEvenWinRate(payout: number): number {
  return 1 / payout;
}

/** 国内型(外為オプション)の購入価格から倍率へ。ペイアウトは1枚1,000円固定。 */
export function payoutFromPrice(priceYen: number): number {
  return 1000 / priceYen;
}

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function load(): TradeSettings {
  try {
    const raw = store()?.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const saved = JSON.parse(raw) as Partial<TradeSettings>;
    return {
      tradeType: saved.tradeType === 'binary' ? 'binary' : 'fx',
      // 保存値が壊れていても判定が破綻しないよう、範囲を検査してから採用する。
      payout:
        typeof saved.payout === 'number' && saved.payout > 1 && saved.payout <= 10
          ? saved.payout
          : DEFAULTS.payout,
      horizonBars: HORIZON_OPTIONS.includes(saved.horizonBars as BinaryHorizon)
        ? (saved.horizonBars as BinaryHorizon)
        : DEFAULTS.horizonBars,
    };
  } catch {
    return DEFAULTS;
  }
}

// 画面をまたいで共有し、選択を端末に保存する軽量ストア。
let current: TradeSettings = load();
const listeners = new Set<() => void>();

export function setTradeSettings(patch: Partial<TradeSettings>) {
  const next = { ...current, ...patch };
  if (
    next.tradeType === current.tradeType &&
    next.payout === current.payout &&
    next.horizonBars === current.horizonBars
  ) {
    return;
  }
  current = next;
  try {
    store()?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 保存に失敗してもアプリ内の選択は有効なままにする
  }
  listeners.forEach((listener) => listener());
}

export function setTradeType(tradeType: TradeType) {
  setTradeSettings({ tradeType });
}

export function useTradeSettings(): TradeSettings {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => current
  );
}

/**
 * 集計に使う先読み本数。
 *
 * FXも15分に固定する理由は無い。スプレッドは保有時間によらず1往復ぶんしか
 * かからないため、長く持つほど同じコストに対して値幅が大きくなり、
 * コスト差引後の期待値は有利になりうる。どの保有時間が有効かは実測次第なので、
 * FX・バイナリーとも設定値をそのまま使う。
 */
export function activeHorizon(settings: TradeSettings): number {
  return settings.horizonBars;
}
