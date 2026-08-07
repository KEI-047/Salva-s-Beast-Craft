import { useEffect, useRef, useState } from 'react';
import { fetchOandaPrices, isOandaEnabled, LivePrice } from '../api/oanda';

/** 現在値の取得間隔。OANDAは120リクエスト/秒まで許容されるため十分余裕がある。 */
export const LIVE_POLL_MS = 5000;

type PairRef = { id: string; base: string; quote: string };

/**
 * 現在値(bid/ask)を数秒おきに取得する。
 * OANDAプロキシが未設定の場合は何もしない(Twelve Data構成では現在値APIが無いため)。
 */
export function useLivePrices(pairs: PairRef[], enabled = true) {
  const [prices, setPrices] = useState<Record<string, LivePrice>>({});
  const [live, setLive] = useState(false);

  // pairs は毎レンダー新しい配列になりうるので、識別子で変化を判定する。
  const key = pairs.map((pair) => pair.id).join(',');
  const pairsRef = useRef(pairs);
  pairsRef.current = pairs;

  useEffect(() => {
    if (!enabled || !isOandaEnabled() || pairsRef.current.length === 0) {
      setLive(false);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      try {
        const next = await fetchOandaPrices(pairsRef.current);
        if (cancelled) return;
        setPrices(next);
        setLive(Object.keys(next).length > 0);
      } catch {
        // 一時的な失敗では表示中の値を保持し、ライブ表示だけ落とす
        if (!cancelled) setLive(false);
      }
      if (!cancelled) timer = setTimeout(tick, LIVE_POLL_MS);
    };

    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, enabled]);

  return { prices, live };
}
