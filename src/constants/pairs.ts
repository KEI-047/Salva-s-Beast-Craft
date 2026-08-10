import { CurrencyPair } from '../types';

// GMOコイン「外国為替FX」が取り扱う10通貨ペア。
// データ取得元がGMOのPublic APIのため、この10ペアに揃えている。
export const CURRENCY_PAIRS: CurrencyPair[] = [
  // 対円(円ペア)
  { id: 'usdjpy', base: 'USD', quote: 'JPY', label: 'USD/JPY', nameJa: '米ドル/円', group: 'jpy' },
  { id: 'eurjpy', base: 'EUR', quote: 'JPY', label: 'EUR/JPY', nameJa: 'ユーロ/円', group: 'jpy' },
  { id: 'gbpjpy', base: 'GBP', quote: 'JPY', label: 'GBP/JPY', nameJa: '英ポンド/円', group: 'jpy' },
  { id: 'audjpy', base: 'AUD', quote: 'JPY', label: 'AUD/JPY', nameJa: '豪ドル/円', group: 'jpy' },
  { id: 'nzdjpy', base: 'NZD', quote: 'JPY', label: 'NZD/JPY', nameJa: 'NZドル/円', group: 'jpy' },
  { id: 'cadjpy', base: 'CAD', quote: 'JPY', label: 'CAD/JPY', nameJa: 'カナダドル/円', group: 'jpy' },
  { id: 'chfjpy', base: 'CHF', quote: 'JPY', label: 'CHF/JPY', nameJa: 'スイスフラン/円', group: 'jpy' },

  // クロス通貨ペア
  { id: 'eurusd', base: 'EUR', quote: 'USD', label: 'EUR/USD', nameJa: 'ユーロ/米ドル', group: 'cross' },
  { id: 'gbpusd', base: 'GBP', quote: 'USD', label: 'GBP/USD', nameJa: '英ポンド/米ドル', group: 'cross' },
  { id: 'audusd', base: 'AUD', quote: 'USD', label: 'AUD/USD', nameJa: '豪ドル/米ドル', group: 'cross' },
];

export function findPair(id: string): CurrencyPair | undefined {
  return CURRENCY_PAIRS.find((pair) => pair.id === id);
}
