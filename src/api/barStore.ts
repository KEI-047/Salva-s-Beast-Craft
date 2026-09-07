import { PricePoint, Timeframe } from '../types';
import { decodeDay, encodeDay, isToday } from './barCache';

/**
 * 確定した日の足の保存先。
 *
 * localStorage は上限がおおむね5MBで、10ペア×365日ぶん(約9MB)が入らない。
 * 検証は取引回数がすべてなので、ここが上限だと「優位性があるか」を判定できる
 * ところまで到達できない。そこで IndexedDB を使う。桁違いに入る。
 *
 * IndexedDB が使えない環境(古い端末・プライベートモード)では localStorage に
 * 落ちる。その場合は保存量が小さいので、長期間の検証は初回と同じ回数の取得が
 * 必要になるが、動作はする。
 *
 * 値の詰め方(1日を1本の文字列にする)は barCache.ts と共有している。
 */

const DB_NAME = 'hayabusa-fx';
const DB_VERSION = 1;
const STORE = 'bars';
const LOCAL_PREFIX = 'hayabusa-fx:bars:';

function keyFor(symbol: string, interval: Timeframe, date: string): string {
  return `${symbol}:${interval}:${date}`;
}

/* ------------------------------ IndexedDB ------------------------------ */

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      // 別タブが古い版を掴んでいると開けないことがある。待ち続けない。
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

/** 1トランザクションでまとめて読む。日数ぶんの往復を作らない。 */
function idbReadMany(
  db: IDBDatabase,
  keys: string[]
): Promise<Map<string, string>> {
  return new Promise((resolve) => {
    const found = new Map<string, string>();
    try {
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      keys.forEach((key) => {
        const request = store.get(key);
        request.onsuccess = () => {
          if (typeof request.result === 'string') found.set(key, request.result);
        };
      });
      tx.oncomplete = () => resolve(found);
      tx.onerror = () => resolve(found);
      tx.onabort = () => resolve(found);
    } catch {
      resolve(found);
    }
  });
}

function idbWriteMany(db: IDBDatabase, entries: [string, string][]): Promise<void> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      entries.forEach(([key, value]) => store.put(value, key));
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/* ---------------------------- localStorage ---------------------------- */

function localStore(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function localRead(key: string): string | null {
  try {
    return localStore()?.getItem(LOCAL_PREFIX + key) ?? null;
  } catch {
    return null;
  }
}

function localWrite(key: string, value: string) {
  try {
    localStore()?.setItem(LOCAL_PREFIX + key, value);
  } catch {
    // 容量超過。IndexedDB が本命なので、ここは入らなくても続行する。
  }
}

/* -------------------------------- 公開API -------------------------------- */

export type DayBars = Map<string, PricePoint[]>;

/**
 * 指定した日の足をまとめて読む。保存が無い日はキーごと含めない。
 * 「取得済みだが休場で空」と「未取得」を区別するため、空配列も値として返す。
 */
export async function readDays(
  symbol: string,
  interval: Timeframe,
  dates: string[]
): Promise<DayBars> {
  const result: DayBars = new Map();
  if (dates.length === 0) return result;

  const keys = dates.map((date) => keyFor(symbol, interval, date));
  const db = await openDb();

  if (db) {
    const found = await idbReadMany(db, keys);
    dates.forEach((date, index) => {
      const raw = found.get(keys[index]);
      if (raw !== undefined) result.set(date, decodeDay(raw, date));
    });
    if (result.size > 0) return result;
  }

  // IndexedDB が使えない、または未保存。localStorage も見る。
  dates.forEach((date, index) => {
    if (result.has(date)) return;
    const raw = localRead(keys[index]);
    if (raw !== null) result.set(date, decodeDay(raw, date));
  });
  return result;
}

/**
 * 確定した日をまとめて保存する。
 * 当日ぶんはまだ足が増えるので、渡されても保存しない。
 */
export async function writeDays(
  symbol: string,
  interval: Timeframe,
  days: [string, PricePoint[]][]
): Promise<void> {
  const entries = days
    .filter(([date]) => !isToday(date))
    .map(([date, bars]) => [keyFor(symbol, interval, date), encodeDay(bars, date)] as [string, string]);
  if (entries.length === 0) return;

  const db = await openDb();
  if (db) {
    await idbWriteMany(db, entries);
    return;
  }
  entries.forEach(([key, value]) => localWrite(key, value));
}

/** 保存件数(表示・確認用)。IndexedDB が使えなければ null。 */
export async function storedDayCount(): Promise<number | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** すべて捨てる。 */
export async function clearStoredBars(): Promise<void> {
  const db = await openDb();
  if (db) {
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }
  const store = localStore();
  if (!store) return;
  try {
    Object.keys(store)
      .filter((key) => key.startsWith(LOCAL_PREFIX))
      .forEach((key) => store.removeItem(key));
  } catch {
    // 続行
  }
}
