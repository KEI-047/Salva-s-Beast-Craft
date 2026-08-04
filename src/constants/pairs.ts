import { CurrencyPair } from '../types';

// 松井証券FXの取扱通貨ペア(公開情報ベース)に合わせた一覧。
// 正確な最新の取扱状況は松井証券公式サイトでご確認ください。
export const CURRENCY_PAIRS: CurrencyPair[] = [
  // 対円(円ペア)
  { id: 'usdjpy', base: 'USD', quote: 'JPY', label: 'USD/JPY', nameJa: '米ドル/円', group: 'jpy' },
  { id: 'eurjpy', base: 'EUR', quote: 'JPY', label: 'EUR/JPY', nameJa: 'ユーロ/円', group: 'jpy' },
  { id: 'gbpjpy', base: 'GBP', quote: 'JPY', label: 'GBP/JPY', nameJa: '英ポンド/円', group: 'jpy' },
  { id: 'audjpy', base: 'AUD', quote: 'JPY', label: 'AUD/JPY', nameJa: '豪ドル/円', group: 'jpy' },
  { id: 'nzdjpy', base: 'NZD', quote: 'JPY', label: 'NZD/JPY', nameJa: 'NZドル/円', group: 'jpy' },
  { id: 'cadjpy', base: 'CAD', quote: 'JPY', label: 'CAD/JPY', nameJa: 'カナダドル/円', group: 'jpy' },
  { id: 'chfjpy', base: 'CHF', quote: 'JPY', label: 'CHF/JPY', nameJa: 'スイスフラン/円', group: 'jpy' },
  { id: 'zarjpy', base: 'ZAR', quote: 'JPY', label: 'ZAR/JPY', nameJa: '南アフリカランド/円', group: 'jpy' },
  { id: 'tryjpy', base: 'TRY', quote: 'JPY', label: 'TRY/JPY', nameJa: 'トルコリラ/円', group: 'jpy' },
  { id: 'mxnjpy', base: 'MXN', quote: 'JPY', label: 'MXN/JPY', nameJa: 'メキシコペソ/円', group: 'jpy' },
  { id: 'nokjpy', base: 'NOK', quote: 'JPY', label: 'NOK/JPY', nameJa: 'ノルウェークローネ/円', group: 'jpy' },
  { id: 'sekjpy', base: 'SEK', quote: 'JPY', label: 'SEK/JPY', nameJa: 'スウェーデンクローナ/円', group: 'jpy' },
  { id: 'plnjpy', base: 'PLN', quote: 'JPY', label: 'PLN/JPY', nameJa: 'ポーランドズロチ/円', group: 'jpy' },
  { id: 'hufjpy', base: 'HUF', quote: 'JPY', label: 'HUF/JPY', nameJa: 'ハンガリーフォリント/円', group: 'jpy' },

  // クロス通貨ペア
  { id: 'eurusd', base: 'EUR', quote: 'USD', label: 'EUR/USD', nameJa: 'ユーロ/米ドル', group: 'cross' },
  { id: 'gbpusd', base: 'GBP', quote: 'USD', label: 'GBP/USD', nameJa: '英ポンド/米ドル', group: 'cross' },
  { id: 'audusd', base: 'AUD', quote: 'USD', label: 'AUD/USD', nameJa: '豪ドル/米ドル', group: 'cross' },
  { id: 'nzdusd', base: 'NZD', quote: 'USD', label: 'NZD/USD', nameJa: 'NZドル/米ドル', group: 'cross' },
  { id: 'euraud', base: 'EUR', quote: 'AUD', label: 'EUR/AUD', nameJa: 'ユーロ/豪ドル', group: 'cross' },
  { id: 'gbpaud', base: 'GBP', quote: 'AUD', label: 'GBP/AUD', nameJa: '英ポンド/豪ドル', group: 'cross' },
  { id: 'usdchf', base: 'USD', quote: 'CHF', label: 'USD/CHF', nameJa: '米ドル/スイスフラン', group: 'cross' },
  { id: 'eurchf', base: 'EUR', quote: 'CHF', label: 'EUR/CHF', nameJa: 'ユーロ/スイスフラン', group: 'cross' },
  { id: 'gbpchf', base: 'GBP', quote: 'CHF', label: 'GBP/CHF', nameJa: '英ポンド/スイスフラン', group: 'cross' },
];

export function findPair(id: string): CurrencyPair | undefined {
  return CURRENCY_PAIRS.find((pair) => pair.id === id);
}
