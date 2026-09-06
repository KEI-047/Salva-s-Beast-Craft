import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { AutoTradeSettings } from '../state/autoTradeStore';
import { AutoDecision } from '../utils/autoTrade';

/**
 * 自動売買の操作盤(仕様外の追加機能)。
 *
 * 一番大きく出すのは「いま撃つのか、撃たないのか」と「本番かドライランか」。
 * 本番送信は、自動売買ONとは別のスイッチにしてある。1つのスイッチで
 * いきなり実弾が飛ぶ作りにはしない。
 *
 * 緊急停止はこの画面のどこからでも1タップで効く。
 */

export function AutoTradePanel({
  settings,
  decision,
  connected,
  onToggleArmed,
  onToggleDryRun,
  onHalt,
}: {
  settings: AutoTradeSettings;
  decision: AutoDecision;
  /** 発注の送信先が設定されているか。未設定ならドライランから出られない */
  connected: boolean;
  onToggleArmed: (value: boolean) => void;
  onToggleDryRun: (value: boolean) => void;
  onHalt: () => void;
}) {
  const live = settings.armed && !settings.dryRun;
  const state = !settings.armed ? '停止中' : settings.dryRun ? '確認モード' : '稼働中';

  return (
    <View style={[styles.card, live && styles.cardLive]}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>自動売買</Text>
        <View style={[styles.badge, live ? styles.badgeLive : styles.badgeIdle]}>
          <Text style={[styles.badgeText, live && styles.badgeTextLive]}>{state}</Text>
        </View>
      </View>

      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.rowLabel}>自動売買を動かす</Text>
          <Text style={styles.rowNote}>
            条件がそろった時に、この端末が注文を組み立てます
          </Text>
        </View>
        <Switch value={settings.armed} onValueChange={onToggleArmed} />
      </View>

      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.rowLabel}>本番の口座へ送信する</Text>
          <Text style={styles.rowNote}>
            {connected
              ? 'OFFの間は、送る内容を表示するだけで送信しません'
              : '送信先が未設定のため、いまはONにできません'}
          </Text>
        </View>
        <Switch
          value={!settings.dryRun}
          disabled={!connected}
          onValueChange={(value) => onToggleDryRun(!value)}
        />
      </View>

      <View style={styles.limits}>
        <Text style={styles.limitText}>
          1回の上限 {settings.maxUnits.toLocaleString()}通貨 / 1日 {settings.maxOrdersPerDay}回まで
          {settings.ordersDate ? ` (本日 ${settings.ordersToday}回)` : ''}
        </Text>
      </View>

      {/* いま何が起きているか。撃たないなら、その理由をそのまま出す。 */}
      <View style={styles.status}>
        {decision.fire ? (
          <>
            <Text style={styles.statusTitle}>
              {decision.dryRun ? '送信する内容(送信はしません)' : '送信します'}
            </Text>
            {decision.plan.summary.map((line, index) => (
              <Text key={index} style={styles.statusLine}>
                {line}
              </Text>
            ))}
            {decision.note && <Text style={styles.noteLine}>{decision.note}</Text>}
            {decision.plan.warnings.map((line, index) => (
              <Text key={`w${index}`} style={styles.warnLine}>
                ⚠ {line}
              </Text>
            ))}
          </>
        ) : (
          <>
            <Text style={styles.statusTitle}>いまは発注しません</Text>
            <Text style={styles.statusLine}>{decision.reason}</Text>
          </>
        )}
      </View>

      {settings.haltReason && (
        <Text style={styles.haltLine}>停止した理由: {settings.haltReason}</Text>
      )}

      {settings.armed && (
        <Pressable style={styles.haltButton} onPress={onHalt}>
          <Text style={styles.haltText}>緊急停止</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
    gap: 10,
  },
  cardLive: { borderColor: '#DC2626', borderWidth: 2 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 14, fontWeight: '900', color: '#0F172A' },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  badgeIdle: { backgroundColor: '#E2E8F0' },
  badgeLive: { backgroundColor: '#DC2626' },
  badgeText: { fontSize: 11, fontWeight: '800', color: '#475569' },
  badgeTextLive: { color: '#FFFFFF' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 13, fontWeight: '700', color: '#0F172A' },
  rowNote: { fontSize: 10, color: '#64748B', lineHeight: 15 },
  limits: { borderTopWidth: 1, borderTopColor: '#F1F5F9', paddingTop: 8 },
  limitText: { fontSize: 11, color: '#64748B' },
  status: { backgroundColor: '#F8FAFC', borderRadius: 10, padding: 10, gap: 2 },
  statusTitle: { fontSize: 12, fontWeight: '800', color: '#334155' },
  statusLine: { fontSize: 11, color: '#475569', lineHeight: 17 },
  warnLine: { fontSize: 11, color: '#B45309', lineHeight: 17 },
  noteLine: { fontSize: 11, color: '#1D4ED8', lineHeight: 17 },
  haltLine: { fontSize: 11, color: '#B91C1C' },
  haltButton: {
    backgroundColor: '#B91C1C',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  haltText: { fontSize: 14, fontWeight: '900', color: '#FFFFFF' },
});
