import { StyleSheet, Text, View } from 'react-native';
import { SignalAction } from '../types';
import { ActionStats, Backtest, Forecast } from '../utils/statistics';
import { horizonLabel } from '../utils/tradeSettings';
import { BREAK_EVEN_WIN_RATE, MIN_SAMPLES } from '../utils/verdict';

const BREAK_EVEN_PERCENT = Math.round(BREAK_EVEN_WIN_RATE * 100);

const ACTION_LABEL: Record<SignalAction, string> = {
  BUY: '買い',
  SELL: '売り',
  HOLD: '様子見',
};

function formatRate(value: number): string {
  return value >= 20 ? value.toFixed(3) : value.toFixed(5);
}

function WinRateBar({ stats, breakEven }: { stats: ActionStats; breakEven: number }) {
  const pct = Math.round((stats.winRate ?? 0) * 100);
  // 損益分岐を境に色を変える。判定カードとまったく同じ基準を使う。
  const color = pct >= breakEven + 10 ? '#15803D' : pct >= breakEven ? '#CA8A04' : '#B91C1C';
  return (
    <View style={styles.barBlock}>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: color }]} />
        {/* 損益分岐点の目印 */}
        <View style={[styles.barMidline, { left: `${breakEven}%` }]} />
      </View>
      <View style={styles.barLabels}>
        <Text style={[styles.winRate, { color }]}>{pct}%</Text>
        <Text style={styles.barCaption}>
          過去{stats.samples}回中{stats.wins}回的中(損益分岐 {breakEven}%)
        </Text>
      </View>
    </View>
  );
}

export function ForecastCard({
  forecast,
  backtest,
  horizonBars = 1,
  breakEvenPercent = BREAK_EVEN_PERCENT,
}: {
  forecast: Forecast | null;
  backtest: Backtest;
  /** 何本先の足で判定するか。バイナリーの判定時刻に合わせて変わる。 */
  horizonBars?: number;
  /** 損益分岐勝率(%)。バイナリーではペイアウト倍率で決まる。 */
  breakEvenPercent?: number;
}) {
  const { current, currentAction } = backtest;
  const span = horizonLabel(horizonBars);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>統計にもとづく予測</Text>

      {/* --- 判定時刻の想定レンジ --- */}
      {forecast && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{span}後の想定レンジ</Text>
          <View style={styles.rangeRow}>
            <View style={styles.rangeEnd}>
              <Text style={styles.rangeCaption}>下限</Text>
              <Text style={[styles.rangeValue, { color: '#B91C1C' }]}>
                {formatRate(forecast.low68)}
              </Text>
            </View>
            <View style={styles.rangeCenter}>
              <Text style={styles.rangeCaption}>現在値</Text>
              <Text style={styles.rangeCurrent}>{formatRate(forecast.latestRate)}</Text>
            </View>
            <View style={[styles.rangeEnd, { alignItems: 'flex-end' }]}>
              <Text style={styles.rangeCaption}>上限</Text>
              <Text style={[styles.rangeValue, { color: '#15803D' }]}>
                {formatRate(forecast.high68)}
              </Text>
            </View>
          </View>
          <Text style={styles.rangeNote}>
            約68%の確率でこの範囲に収まります(直近のボラティリティ ±
            {forecast.volatilityPercent.toFixed(3)}%/{span})
            {'\n'}
            約95%の範囲: {formatRate(forecast.low95)} 〜 {formatRate(forecast.high95)}
          </Text>
        </View>
      )}

      {/* --- 現在シグナルの過去成績 --- */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>
          現在のシグナル「{ACTION_LABEL[currentAction]}」の過去成績
        </Text>

        {currentAction === 'HOLD' ? (
          <Text style={styles.emptyText}>
            様子見のため方向性の予測はありません。買い/売りのシグナルが出た時に、その方向の過去成績を表示します。
          </Text>
        ) : !current || current.samples === 0 ? (
          <Text style={styles.emptyText}>
            この期間に同じシグナルが出た履歴がないため、成績を算出できません。
          </Text>
        ) : (
          <>
            <WinRateBar stats={current} breakEven={breakEvenPercent} />
            <Text style={styles.detailText}>
              シグナル発生後、{span}後の足が{ACTION_LABEL[currentAction]}方向へ動いた割合です。
              平均変動率 {current.avgMovePercent >= 0 ? '+' : ''}
              {current.avgMovePercent.toFixed(3)}%
            </Text>
            {current.samples < MIN_SAMPLES && (
              <Text style={styles.warnText}>
                サンプルが{current.samples}件と少ないため、参考値としてご覧ください。
              </Text>
            )}
          </>
        )}
      </View>

      {/* --- 両方向の比較 --- */}
      <View style={styles.compareRow}>
        <CompareCell label="買いシグナル" stats={backtest.buy} />
        <CompareCell label="売りシグナル" stats={backtest.sell} />
      </View>

      <Text style={styles.disclaimer}>
        いずれも表示期間の過去データを集計した結果であり、将来の成績を保証するものではありません。
        想定レンジは価格がランダムに動くと仮定した目安で、方向性の予測ではありません。
      </Text>
    </View>
  );
}

function CompareCell({ label, stats }: { label: string; stats: ActionStats }) {
  const pct = stats.winRate === null ? null : Math.round(stats.winRate * 100);
  return (
    <View style={styles.compareCell}>
      <Text style={styles.compareLabel}>{label}</Text>
      <Text style={styles.compareValue}>{pct === null ? '—' : `${pct}%`}</Text>
      <Text style={styles.compareCaption}>{stats.samples}件</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    gap: 16,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  title: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  section: {
    gap: 6,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  rangeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  rangeEnd: {
    flex: 1,
  },
  rangeCenter: {
    flex: 1,
    alignItems: 'center',
  },
  rangeCaption: {
    fontSize: 10,
    color: '#94A3B8',
  },
  rangeValue: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 2,
  },
  rangeCurrent: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 2,
  },
  rangeNote: {
    fontSize: 11,
    color: '#64748B',
    lineHeight: 16,
  },
  barBlock: {
    gap: 4,
  },
  barTrack: {
    height: 12,
    borderRadius: 6,
    backgroundColor: '#E2E8F0',
    overflow: 'hidden',
    justifyContent: 'center',
  },
  barFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 6,
  },
  barMidline: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: '#FFFFFF',
  },
  barLabels: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  winRate: {
    fontSize: 22,
    fontWeight: '800',
  },
  barCaption: {
    fontSize: 12,
    color: '#64748B',
  },
  detailText: {
    fontSize: 12,
    color: '#334155',
    lineHeight: 17,
  },
  warnText: {
    fontSize: 11,
    color: '#B45309',
    lineHeight: 15,
  },
  emptyText: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 17,
  },
  compareRow: {
    flexDirection: 'row',
    gap: 10,
  },
  compareCell: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  compareLabel: {
    fontSize: 11,
    color: '#64748B',
  },
  compareValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 2,
  },
  compareCaption: {
    fontSize: 10,
    color: '#94A3B8',
  },
  disclaimer: {
    fontSize: 10,
    color: '#94A3B8',
    lineHeight: 14,
  },
});
