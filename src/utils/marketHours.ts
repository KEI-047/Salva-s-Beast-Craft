/**
 * 為替市場が開いているか(日本時間)。
 *
 * 休場中に「⚠ データ確認中」と出すのは嘘に近い。壊れているのではなく、
 * 単に市場が閉まっているだけだからだ。閉まっていることと、配信が落ちていることを
 * 画面で区別する必要がある。
 *
 * 判定の優先は「業者が返す status」→「時計」の順にする。GMOの ticker は休場中に
 * status が OPEN 以外になるので、それが取れているならそちらが正しい。時計は
 * ticker 自体が返ってこない時の保険であり、**目安**として扱う(実際の開始・終了は
 * 米国の夏時間や年末年始で前後する)。
 */

/** 週明けの再開時刻(日本時間の時)。GMOの外国為替FXは月曜7:00ごろ再開する。 */
export const OPEN_HOUR_JST = 7;

/** 週末の終了時刻(日本時間の時)。土曜の朝に閉まる。 */
export const CLOSE_HOUR_JST = 7;

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

/** 日本時間の「曜日・時・分」を取り出す。端末のタイムゾーンに依存させない。 */
export function jstParts(now: Date): { day: number; hour: number; minute: number } {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return {
    day: jst.getUTCDay(),
    hour: jst.getUTCHours(),
    minute: jst.getUTCMinutes(),
  };
}

/**
 * 週末の休場か(目安)。
 * 土曜7:00ごろ〜月曜7:00ごろは開いていない。
 * 判定を厳しくしすぎると開いているのに止めてしまうので、境界は控えめに取る。
 */
export function isWeekendClosed(now: Date): boolean {
  const { day, hour } = jstParts(now);
  if (day === 0) return true; // 日曜は終日
  if (day === 6 && hour >= CLOSE_HOUR_JST) return true; // 土曜の朝以降
  if (day === 1 && hour < OPEN_HOUR_JST) return true; // 月曜の早朝
  return false;
}

/** 次に開く時刻(日本時間の目安)。開いている時は null。 */
export function nextOpenAt(now: Date): Date | null {
  if (!isWeekendClosed(now)) return null;
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const open = new Date(jst.getTime());
  open.setUTCHours(OPEN_HOUR_JST, 0, 0, 0);
  // 月曜の朝までカレンダーを進める
  while (open.getTime() <= jst.getTime() || open.getUTCDay() !== 1) {
    open.setUTCDate(open.getUTCDate() + 1);
    open.setUTCHours(OPEN_HOUR_JST, 0, 0, 0);
  }
  return new Date(open.getTime() - 9 * 60 * 60 * 1000);
}

/** 「あと◯時間◯分(月曜7:00ごろ)」のような一文。開いていれば null。 */
export function describeReopen(now: Date): string | null {
  const open = nextOpenAt(now);
  if (!open) return null;
  const { day } = jstParts(open);
  const minutes = Math.max(0, Math.round((open.getTime() - now.getTime()) / 60000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const remaining = hours > 0 ? `あと約${hours}時間${rest}分` : `あと約${rest}分`;
  return `${remaining}(${DAY_NAMES[day]}曜 ${OPEN_HOUR_JST}:00ごろ・日本時間)`;
}
