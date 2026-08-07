import { useEffect, useRef } from 'react';
import { nextBarCloseAt } from './statistics';

/**
 * 配信側にデータが載るまでの待ち時間。
 * 足の確定ちょうどに取りにいくと、まだ最新足が返ってこないことがあるため少し遅らせる。
 */
const SETTLE_DELAY_MS = 8 * 1000;

/**
 * 15分足が確定する 00/15/30/45 分の直後にコールバックを実行する。
 * setInterval で固定間隔を刻むとタブが休止した際にずれるため、
 * 毎回「次の確定時刻」までの残り時間を計算し直して setTimeout を張り直す。
 */
export function useBarClose(onBarClose: () => void, enabled = true) {
  const callbackRef = useRef(onBarClose);
  callbackRef.current = onBarClose;

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    const schedule = () => {
      const wait = nextBarCloseAt().getTime() - Date.now() + SETTLE_DELAY_MS;
      timer = setTimeout(() => {
        if (cancelled) return;
        callbackRef.current();
        schedule();
      }, Math.max(1000, wait));
    };

    schedule();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled]);
}
