import { PricePoint, Timeframe } from '../types';

/**
 * 確定した日のローソク足を、日単位で永久に保存する。
 *
 * 既存のキャッシュは「何日ぶん取ったか」をキーにして10分で捨てていた。
 * そのため30日ぶんを見るたびに300リクエストを投げ直すことになり、
 * 90日・180日といった長さは現実的に扱えなかった。
 *
 * しかし**過ぎた日の足は二度と変わらない**。日付をキーにすれば、
 * 一度取った日は永久に使い回せる。初回だけ費用を払えば、翌日からは
 * 増えた1日ぶんしか取りに行かない。
 *
 * 保存量の都合で、値は「刻み単位の整数」かつ「その日の始値からの差分」に
 * して詰める。素直にJSONで持つと10ペア×90日で3MBを超え、localStorage の
 * 上限(おおむね5MB)に当たる。
 */

const PREFIX = 'hayabusa-fx:bars:';
const INDEX_KEY = 'hayabusa-fx:bars-index';

/** 保存しておく日数の上限(1ペア・1足種あたり)。超えたら古い日から捨てる。 */
export const MAX_CACHED_DAYS = 200;

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** 価格の刻み。対円は0.001、それ以外は0.00001。 */
export function tickDigits(price: number): number {
  return price >= 20 ? 3 : 5;
}

function keyFor(symbol: string, interval: Timeframe, date: string): string {
  return `${PREFIX}${symbol}:${interval}:${date}`;
}

/** YYYYMMDD をその日の0時(端末の時刻)に直す。klines の日付指定と揃える。 */
export function dayStartMs(date: string): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(4, 6));
  const day = Number(date.slice(6, 8));
  return new Date(year, month - 1, day).getTime();
}

/**
 * 1日ぶんを1本の文字列に詰める。
 * 形式: "digits|baseTick|分,始,高,安,終;分,始,高,安,終;..."
 * 価格は baseTick からの差分なので、たいてい数文字で収まる。
 */
export function encodeDay(bars: PricePoint[], date: string): string {
  if (bars.length === 0) return '';
  const first = bars[0];
  const digits = tickDigits(first.close ?? first.rate);
  const scale = Math.pow(10, digits);
  const tick = (value: number) => Math.round(value * scale);
  const base = tick(first.open ?? first.rate);
  const start = dayStartMs(date);

  const rows = bars.map((bar) => {
    const minute = Math.round((Date.parse(bar.date) - start) / 60000);
    const open = tick(bar.open ?? bar.rate) - base;
    const high = tick(bar.high ?? bar.rate) - base;
    const low = tick(bar.low ?? bar.rate) - base;
    const close = tick(bar.close ?? bar.rate) - base;
    return `${minute},${open},${high},${low},${close}`;
  });

  return `${digits}|${base}|${rows.join(';')}`;
}

export function decodeDay(encoded: string, date: string): PricePoint[] {
  if (!encoded) return [];
  const [digitsPart, basePart, rowsPart] = encoded.split('|');
  const digits = Number(digitsPart);
  const base = Number(basePart);
  if (!Number.isFinite(digits) || !Number.isFinite(base) || !rowsPart) return [];

  const scale = Math.pow(10, digits);
  const start = dayStartMs(date);
  const points: PricePoint[] = [];

  for (const row of rowsPart.split(';')) {
    const parts = row.split(',');
    if (parts.length !== 5) continue;
    const minute = Number(parts[0]);
    const open = (base + Number(parts[1])) / scale;
    const high = (base + Number(parts[2])) / scale;
    const low = (base + Number(parts[3])) / scale;
    const close = (base + Number(parts[4])) / scale;
    if (![minute, open, high, low, close].every(Number.isFinite)) continue;
    points.push({
      date: new Date(start + minute * 60000).toISOString(),
      rate: close,
      open,
      high,
      low,
      close,
    });
  }
  return points;
}

/* ------------------------------ 索引の管理 ------------------------------ */

/** 保存した日を古い順に覚えておく。容量が尽きたらここから捨てる。 */
function readIndex(): string[] {
  try {
    const raw = store()?.getItem(INDEX_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((k) => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

function writeIndex(keys: string[]) {
  try {
    store()?.setItem(INDEX_KEY, JSON.stringify(keys));
  } catch {
    // 索引が書けなくても本体は読める。次回作り直される。
  }
}

/** 古いものから n 件捨てる。 */
function evict(count: number) {
  const index = readIndex();
  const dropped = index.splice(0, Math.max(1, count));
  const s = store();
  dropped.forEach((key) => {
    try {
      s?.removeItem(key);
    } catch {
      // 消せなくても続行
    }
  });
  writeIndex(index);
}

export function readDay(
  symbol: string,
  interval: Timeframe,
  date: string
): PricePoint[] | null {
  try {
    const raw = store()?.getItem(keyFor(symbol, interval, date));
    if (raw === null || raw === undefined) return null;
    // 休場日は空で確定している。取り直さないよう、空も「取得済み」として扱う。
    return decodeDay(raw, date);
  } catch {
    return null;
  }
}

/**
 * 1日ぶんを保存する。
 * **確定した日だけ**を渡すこと。当日ぶんはまだ増えるので保存してはいけない。
 */
export function writeDay(
  symbol: string,
  interval: Timeframe,
  date: string,
  bars: PricePoint[]
) {
  const s = store();
  if (!s) return;
  const key = keyFor(symbol, interval, date);
  const value = encodeDay(bars, date);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      s.setItem(key, value);
      const index = readIndex().filter((k) => k !== key);
      index.push(key);
      // 上限を超えたぶんは古い日から落とす
      if (index.length > MAX_CACHED_DAYS * 12) {
        writeIndex(index);
        evict(index.length - MAX_CACHED_DAYS * 12);
      } else {
        writeIndex(index);
      }
      return;
    } catch {
      // 容量超過。古い日を捨てて空けてから、もう一度だけ試す。
      evict(40);
    }
  }
}

/** 当日か(確定していないので保存しない) */
export function isToday(date: string, now = new Date()): boolean {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return date === `${y}${m}${d}`;
}

/** 保存済みの日数(表示用)。 */
export function cachedDayCount(): number {
  return readIndex().length;
}

/** すべて捨てる(設定画面から使う想定)。 */
export function clearBarCache() {
  const s = store();
  readIndex().forEach((key) => {
    try {
      s?.removeItem(key);
    } catch {
      // 続行
    }
  });
  writeIndex([]);
}
