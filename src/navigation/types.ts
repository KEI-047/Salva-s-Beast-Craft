/**
 * ボトムタブ4つ(仕様14)と、分析タブの中のスタック。
 * 既存のウォッチリスト・詳細・総当たり探索は削除せず、分析タブの下に残す。
 */
export type RootTabParamList = {
  HomeTab: undefined;
  HistoryTab: undefined;
  AccountTab: undefined;
  AnalysisTab: undefined;
};

export type AnalysisStackParamList = {
  AnalysisHome: undefined;
  Watchlist: undefined;
  Detail: { pairId: string };
  Scan: undefined;
};

/** 既存画面が参照している名前。分析スタックと同じ内容。 */
export type RootStackParamList = AnalysisStackParamList;
