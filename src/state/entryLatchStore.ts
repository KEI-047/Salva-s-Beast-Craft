import { useSyncExternalStore } from 'react';
import { SignalAction } from '../types';
import { ActionKind } from '../utils/nextAction';
import { SizingResult } from '../utils/positionSizing';

/**
 * エントリー指示の保持(ラッチ)。
 *
 * 「買う」が出た瞬間にOANDAへ行って注文し、戻ってきたら1分足が動いて
 * 「様子見」に戻っていた——これが一番困る。指示が消えるのは正しいが、
 * *実際に持ったポジションを記録する手段* まで消えてはいけない。
 * 記録できないと決済ナビが出ず、持ち玉が野放しになる。
 *
 * そこで ENTRY NOW が出たら、その時の注文内容をここへ数分間だけ掛けておく。
 * ラッチが保つのは「記録ボタンと注文内容」だけで、指示そのものではない。
 * NEXT ACTION は正直に「待つ」へ戻る(仕様5・古い指示を出し続けない)。
 */

/** 指示が出てから記録できる猶予。OANDAで発注して戻るのに要る時間。 */
export const LATCH_TTL_MS = 5 * 60 * 1000;

const STORAGE_KEY = 'hayabusa-fx:entry-latch';

export type EntryLatch = {
  pairId: string;
  pairLabel: string;
  direction: 'BUY' | 'SELL';
  /** 発火時の提示価格。以後は動かさない(注文内容を固定するため) */
  price: number;
  sizing: SizingResult;
  entryLow: number;
  entryHigh: number;
  /** 発火時に成立していた条件 */
  reasons: string[];
  firedAt: number;
  expiresAt: number;
};

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function valid(latch: unknown): latch is EntryLatch {
  const l = latch as EntryLatch | null;
  return (
    !!l &&
    typeof l.pairId === 'string' &&
    (l.direction === 'BUY' || l.direction === 'SELL') &&
    Number.isFinite(l.price) &&
    l.price > 0 &&
    !!l.sizing &&
    Number.isFinite(l.sizing.units) &&
    l.sizing.units > 0 &&
    Number.isFinite(l.expiresAt)
  );
}

/** 期限内なら latch を、切れていれば null を返す。 */
export function aliveLatch(latch: EntryLatch | null, now = Date.now()): EntryLatch | null {
  if (!latch) return null;
  return latch.expiresAt > now ? latch : null;
}

/**
 * ラッチを消すべき理由。null なら残す。
 *
 * 「まだ条件が揃っていない(待つ)」は消す理由にならない。それこそが
 * このラッチの守りたい状況だから。消すのは、そもそも入ってはいけなくなった時だけ。
 */
export function latchClearReason(
  latch: EntryLatch,
  {
    pairId,
    kind,
    bias,
    now = Date.now(),
  }: { pairId: string; kind: ActionKind; bias: SignalAction | null; now?: number }
): string | null {
  if (latch.expiresAt <= now) return '時間が経ちました';
  // 別ペアを見ている間の判定は、このラッチとは無関係なので触らない。
  if (latch.pairId !== pairId) return null;
  // データ異常では消さない。起動直後や配信が詰まった時ほど「もう注文したのに
  // 記録できない」が起きやすい。指示は取り下げ済みで、期限も5分しかない。
  if (kind === 'NO_TRADE') return '新規エントリーを停止しました';
  const opposite = latch.direction === 'BUY' ? 'SELL' : 'BUY';
  if (bias === opposite) return '方向が反転しました';
  return null;
}

function load(): EntryLatch | null {
  try {
    const raw = store()?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return valid(parsed) ? aliveLatch(parsed) : null;
  } catch {
    return null;
  }
}

let current: EntryLatch | null = load();
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit() {
  try {
    if (current) store()?.setItem(STORAGE_KEY, JSON.stringify(current));
    else store()?.removeItem(STORAGE_KEY);
  } catch {
    // 保存に失敗してもアプリ内の状態は保つ
  }
  listeners.forEach((listener) => listener());
}

/** 期限が来たら自分で消える。画面側にタイマーを持たせない。 */
function schedule() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!current) return;
  const wait = current.expiresAt - Date.now();
  timer = setTimeout(() => {
    timer = null;
    if (current && current.expiresAt <= Date.now()) {
      current = null;
      emit();
    }
  }, Math.max(0, wait));
}

schedule();

export type ArmInput = Omit<EntryLatch, 'firedAt' | 'expiresAt'>;

/**
 * 指示を掛ける。
 * 同じペア・同じ方向のラッチが生きている間は上書きしない。
 * 上書きすると、ユーザーが見ている注文内容(価格・数量)が手元で動いてしまう。
 */
export function armLatch(input: ArmInput, now = Date.now()) {
  const live = aliveLatch(current, now);
  if (live && live.pairId === input.pairId && live.direction === input.direction) return;
  current = { ...input, firedAt: now, expiresAt: now + LATCH_TTL_MS };
  schedule();
  emit();
}

export function clearLatch() {
  if (!current) return;
  current = null;
  schedule();
  emit();
}

export function getLatch(): EntryLatch | null {
  return current;
}

export function useEntryLatch(): EntryLatch | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => current
  );
}
