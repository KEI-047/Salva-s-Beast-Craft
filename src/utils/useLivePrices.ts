import { useEffect, useRef, useState } from 'react';
import { isGmoEnabled } from '../api/forex';
import { fetchGmoPrices } from '../api/gmo';
import { fetchOandaPrices, isOandaEnabled, LivePrice } from '../api/oanda';

/**
 * 現在値の取得間隔。
 * GMOのtickerは全銘柄を1リクエストで返すため、3秒間隔でも毎分20回に収まる。
 */
export const LIVE_POLL_MS = 3000;

type PairRef = { id: string; base: string; quote: string };

/** 現在値に対応しているデータ源か(Twelve Dataには現在値APIが無い) */
function supportsLivePrices(): boolean {
  return isGmoEnabled() || isOandaEnabled();
}

/**
 * 現在値(bid/ask)を数秒おきに取得する。
 * GMO構成では ticker が全銘柄を1リクエストで返すため、監視数によらず呼び出しは1回。
 */
export function useLivePrices(pairs: PairRef[], enabled = true) {
  const [prices, setPrices] = useState<Record<string, LivePrice>>({});
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // pairs は毎レンダー新しい配列になりうるので、識別子で変化を判定する。
  const key = pairs.map((pair) => pair.id).join(',');
  const pairsRef = useRef(pairs);
  pairsRef.current = pairs;

  useEffect(() => {
    if (!enabled || !supportsLivePrices() || pairsRef.current.length === 0) {
      setLive(false);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      try {
        const next = isGmoEnabled()
          ? await fetchGmoPrices(pairsRef.current)
          : await fetchOandaPrices(pairsRef.current);
        if (cancelled) return;
        setPrices(next);
        setLive(Object.keys(next).length > 0);
        setError(null);
      } catch (err) {
        // 一時的な失敗では表示中の値を保持し、ライブ表示だけ落とす
        if (!cancelled) {
          setLive(false);
          setError(err instanceof Error ? err.message : '現在値を取得できません');
        }
      }
      if (!cancelled) timer = setTimeout(tick, LIVE_POLL_MS);
    };

    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, enabled]);

  return { prices, live, error };
}
