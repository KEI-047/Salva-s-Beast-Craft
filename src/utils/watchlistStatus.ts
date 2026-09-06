import { AccountSettings } from '../state/accountStore';
import { PositionState } from '../state/positionStore';
import { DailySummary } from '../state/tradeHistoryStore';
import { PricePoint, SignalAction, StrategyMode } from '../types';
import { buildMarketContext } from './marketContext';
import { stopReasons } from './nextAction';
import { composeBars } from './timeframes';

/**
 * 一覧で「取引していいか / 様子見か / 止まっているか」を1行で出すための判定。
 *
 * ホームは5条件(環境・方向・セットアップ・1分トリガー・統計)で最終判断するが、
 * 一覧で10ペアぶんの1分足まで取ると毎回100リクエスト近くになる。
 * そこで一覧は **15分足だけを取得し、そこから1時間足・4時間足を合成**して
 * 「準備が整っているか」までを見る。1分足のトリガーは、そもそも数分で変わるため
 * 一覧に出しても意味が薄く、ホームで待つべきもの。
 *
 * つまり:
 *   一覧 = そのペアを開く価値があるか
 *   ホーム = 実際に入るか
 * であり、一覧が「候補」を出したペアをホームで開いてトリガーを待つ、という導線になる。
 */

export type WatchlistLevel = 'candidate' | 'watch' | 'stopped';

export type PairStatus = {
  level: WatchlistLevel;
  /** かんたんモードの言葉。色だけに頼らないため文字も持つ */
  emoji: string;
  label: string;
  /** 狙う方向。決まっていなければ HOLD */
  direction: SignalAction;
  /** 一行の理由 */
  detail: string;
  /** 何条件そろっているか(一覧は3条件) */
  metCount: number;
  totalCount: number;
};

/** 一覧で見る条件。1分トリガーと5分セットアップはホームに任せる。 */
const LIST_CONDITION_KEYS = ['environment', 'direction', 'edge'] as const;

export type PairStatusInput = {
  /** 15分足。これだけ取れば1時間足・4時間足は合成できる */
  fifteen: PricePoint[];
  mode: StrategyMode;
  minScore: number;
  edgeOk: boolean;
  edgeDetail: string;
  /**
   * データが信用できない理由。null なら正常。
   * 現在値が「存在するか」だけでは足りない。止まった配信でも古い値は返ってくるので、
   * ホームと同じ evaluateDataHealth の結果を渡して鮮度まで見る。
   */
  dataIssue: string | null;
  /** 休場中か。異常ではないので文言を分ける */
  closed?: boolean;
};

export function buildPairStatus({
  fifteen,
  mode,
  minScore,
  edgeOk,
  edgeDetail,
  dataIssue,
  closed = false,
}: PairStatusInput): PairStatus {
  if (closed) {
    return {
      level: 'stopped',
      emoji: '🌙',
      label: '休場中',
      direction: 'HOLD',
      detail: dataIssue ?? '市場が休場中です。',
      metCount: 0,
      totalCount: LIST_CONDITION_KEYS.length,
    };
  }
  if (dataIssue) {
    return {
      level: 'stopped',
      emoji: '⚠',
      label: 'データ確認中',
      direction: 'HOLD',
      detail: dataIssue,
      metCount: 0,
      totalCount: LIST_CONDITION_KEYS.length,
    };
  }

  // 15分足から1時間足(60分)と4時間足(240分)を合成する。
  const context = buildMarketContext({
    bars: {
      fourHour: composeBars(fifteen, 240),
      hourly: composeBars(fifteen, 60),
      fifteen,
      // 一覧では見ない足。空にすると readFrame が HOLD を返すので、
      // 下の LIST_CONDITION_KEYS で対象から外している。
      five: [],
      minute: [],
    },
    mode,
    minScore,
    edgeOk,
    edgeDetail,
  });

  const conditions = context.conditions.filter((condition) =>
    (LIST_CONDITION_KEYS as readonly string[]).includes(condition.key)
  );
  const metCount = conditions.filter((condition) => condition.met).length;
  const unmet = conditions.filter((condition) => !condition.met);

  if (context.conflicted) {
    return {
      level: 'stopped',
      emoji: '⛔',
      label: '取引しない',
      direction: 'HOLD',
      detail: '上位足が逆を向いています',
      metCount,
      totalCount: conditions.length,
    };
  }

  if (unmet.length === 0 && context.bias !== 'HOLD') {
    const buy = context.bias === 'BUY';
    return {
      level: 'candidate',
      emoji: buy ? '🟢' : '🔴',
      label: buy ? '買い候補' : '売り候補',
      direction: context.bias,
      detail: 'ホームで1分足のトリガーを待ちます',
      metCount,
      totalCount: conditions.length,
    };
  }

  return {
    level: 'watch',
    emoji: '🟡',
    label: '様子見',
    direction: context.bias,
    detail: unmet[0]?.detail ?? '条件成立を待っています',
    metCount,
    totalCount: conditions.length,
  };
}

/**
 * 口座側の停止(連敗・日次損失・取引数上限)は通貨ペアによらず全体に効く。
 * 保有中も新規は出さない。止まっている理由を返し、無ければ null。
 */
export function globalStop(
  account: AccountSettings,
  daily: DailySummary,
  position: PositionState
): string | null {
  if (position.state === 'IN_POSITION') {
    return `${position.position.pairLabel} を保有中です。決済してから次を探します`;
  }
  const reasons = stopReasons(account, daily);
  return reasons.length > 0 ? reasons.join(' / ') : null;
}

/** 全体が止まっている時に各行へ出す状態。 */
export function stoppedStatus(reason: string): PairStatus {
  return {
    level: 'stopped',
    emoji: '⛔',
    label: '取引しない',
    direction: 'HOLD',
    detail: reason,
    metCount: 0,
    totalCount: LIST_CONDITION_KEYS.length,
  };
}
