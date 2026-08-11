export type CurrencyPairGroup = 'jpy' | 'cross';

export type CurrencyPair = {
  id: string;
  base: string;
  quote: string;
  label: string;
  nameJa: string;
  group: CurrencyPairGroup;
};

export type PricePoint = {
  date: string;
  rate: number;
};

export type SignalAction = 'BUY' | 'SELL' | 'HOLD';

/**
 * 取引の種類。損益の決まり方が根本的に違うため、エントリー判定の式が変わる。
 * - fx:     値幅で損益が決まる。勝率が低くても値幅が伸びれば勝てる
 * - binary: 当たれば固定倍率、外れれば投資額全損。値幅は一切関係なく、勝率だけで決まる
 */
export type TradeType = 'fx' | 'binary';

/** バイナリーの判定時刻(エントリーから何本先の15分足で判定するか) */
export type BinaryHorizon = 1 | 4 | 8;

export type TradeSettings = {
  tradeType: TradeType;
  /** ペイアウト倍率。国内型(外為オプション)は 1000 ÷ 購入価格 */
  payout: number;
  horizonBars: BinaryHorizon;
};

/**
 * 売買判定の方針。
 * - reversion: 逆張り。RSIの買われ過ぎ/売られ過ぎを反転の兆候とみなす
 * - trend:     順張り。RSIの高さを勢いの強さとみなし、強いトレンドに乗る
 * - auto:      効率比で相場つきを判定し、上記2つを自動で切り替える
 */
export type StrategyMode = 'reversion' | 'trend' | 'auto';

/** 効率比から判定した相場つき */
export type MarketRegime = 'trend' | 'range';

export type SignalResult = {
  action: SignalAction;
  score: number;
  reasons: string[];
  latestRate: number;
  changePercent: number;
  rsi: number | null;
  smaShort: number | null;
  smaLong: number | null;
  macdHistogram: number | null;
  /** 効率比(0〜1)。相場つきの判定に使う */
  efficiencyRatio: number | null;
  /** 実際に適用された判定方針(autoの場合は解決後の値) */
  appliedMode: Exclude<StrategyMode, 'auto'>;
  regime: MarketRegime | null;
};
