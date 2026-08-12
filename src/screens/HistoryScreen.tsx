import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CONTENT_MAX_WIDTH } from '../constants/layout';
import { summarise, Trade, useTrades } from '../state/tradeHistoryStore';

/** 履歴(仕様16)。タップでエントリー理由・決済理由まで確認できる。 */

function formatRate(value: number): string {
  return value >= 20 ? value.toFixed(3) : value.toFixed(5);
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes()
  ).padStart(2, '0')}`;
}

function heldFor(trade: Trade): string {
  const ms = Date.parse(trade.closedAt) - Date.parse(trade.openedAt);
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}分${seconds}秒`;
}

export function HistoryScreen() {
  const trades = useTrades();
  const daily = summarise(trades);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.summary}>
        <Text style={styles.summaryText}>
          本日 {daily.trades}戦 {daily.wins}勝 {daily.losses}敗
        </Text>
        <Text
          style={[styles.summaryPnl, { color: daily.pnlYen >= 0 ? '#15803D' : '#B91C1C' }]}
        >
          {daily.pnlYen >= 0 ? '+' : '−'}
          {Math.abs(Math.round(daily.pnlYen)).toLocaleString()}円
        </Text>
      </View>

      {trades.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            まだトレードがありません。{'\n'}
            決済を記録すると、ここに理由まで残ります。
          </Text>
        </View>
      ) : (
        trades.map((trade) => {
          const win = trade.result === 'WIN';
          const color = win ? '#15803D' : trade.result === 'LOSS' ? '#B91C1C' : '#64748B';
          const open = openId === trade.id;
          return (
            <Pressable
              key={trade.id}
              style={styles.row}
              onPress={() => setOpenId(open ? null : trade.id)}
            >
              <View style={styles.rowHead}>
                <View>
                  <Text style={styles.date}>{formatDate(trade.closedAt)}</Text>
                  <Text style={styles.pair}>
                    {trade.pairLabel} {trade.direction === 'BUY' ? '買い' : '売り'}
                  </Text>
                </View>
                <View style={styles.rowRight}>
                  <Text style={[styles.pnl, { color }]}>
                    {trade.pnlYen >= 0 ? '+' : '−'}
                    {Math.abs(Math.round(trade.pnlYen)).toLocaleString()}円
                  </Text>
                  <Text style={[styles.pips, { color }]}>
                    {trade.pnlPips >= 0 ? '+' : '−'}
                    {Math.abs(trade.pnlPips).toFixed(1)}pips / {trade.result}
                  </Text>
                </View>
              </View>

              {open && (
                <View style={styles.detail}>
                  <Detail label="ENTRY" value={formatRate(trade.entryPrice)} />
                  <Detail label="決済" value={formatRate(trade.exitPrice)} />
                  <Detail label="TP" value={formatRate(trade.tp)} />
                  <Detail label="SL" value={formatRate(trade.sl)} />
                  <Detail label="数量" value={`${trade.units.toLocaleString()}通貨`} />
                  <Detail label="保有時間" value={heldFor(trade)} />
                  {trade.entryReasons.length > 0 && (
                    <>
                      <Text style={styles.detailHead}>エントリー理由</Text>
                      {trade.entryReasons.map((reason, i) => (
                        <Text key={i} style={styles.detailLine}>・{reason}</Text>
                      ))}
                    </>
                  )}
                  {trade.exitReasons.length > 0 && (
                    <>
                      <Text style={styles.detailHead}>決済理由</Text>
                      {trade.exitReasons.map((reason, i) => (
                        <Text key={i} style={styles.detailLine}>・{reason}</Text>
                      ))}
                    </>
                  )}
                </View>
              )}
            </Pressable>
          );
        })
      )}
    </ScrollView>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F1F5F9' },
  content: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    padding: 14,
    gap: 8,
  },
  summary: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryText: { fontSize: 13, fontWeight: '700', color: '#334155' },
  summaryPnl: { fontSize: 16, fontWeight: '900' },
  empty: { padding: 32, alignItems: 'center' },
  emptyText: { fontSize: 12, color: '#64748B', textAlign: 'center', lineHeight: 20 },
  row: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 14, gap: 8 },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowRight: { alignItems: 'flex-end' },
  date: { fontSize: 11, color: '#94A3B8' },
  pair: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  pnl: { fontSize: 16, fontWeight: '900' },
  pips: { fontSize: 11 },
  detail: { borderTopWidth: 1, borderTopColor: '#F1F5F9', paddingTop: 8, gap: 3 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between' },
  detailLabel: { fontSize: 11, color: '#64748B' },
  detailValue: { fontSize: 12, color: '#334155', fontVariant: ['tabular-nums'] },
  detailHead: { fontSize: 11, fontWeight: '800', color: '#475569', marginTop: 6 },
  detailLine: { fontSize: 11, color: '#64748B', lineHeight: 16 },
});
