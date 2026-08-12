# Hayabusa FX v2 実装計画

仕様書 §35 に従い、コード変更前の調査結果と実装手順をまとめる。
**この計画の承認後に §34 の STEP 1〜11 を順に実装する。**

---

## 0. 先に確認したいこと(5件)

実装を始める前に、仕様と現状が食い違う点を挙げる。**勝手に決めずに確認したい。**

### ① データ源は DMM ではなく GMO

仕様書は「DMM LIVE ●」「DMMリアルタイムデータ」と書かれているが、**本アプリに DMM の実装は無い**。現在は GMOコイン「外国為替FX」の Public API を使っている(認証不要)。

DMM FX は個人向けの公開APIを提供していないため、**DMM への切り替えは実装できない**。表示は実際の取得元に合わせて「**GMO LIVE ●**」とする。これは正確性の問題で、嘘のラベルを出すわけにはいかない。

> 別の意図(例: DMMで取引しているので価格差が気になる)があれば教えてほしい。§7 の「約定価格をユーザーが修正できる」仕組みで吸収する設計になっている。

### ② 「条件一致度 82%」は勝率と誤読される

仕様 §6 の「条件一致度 82%」を、そのままパーセント表示すると **勝率だと誤解される**。仕様 §0 の「勝率を保証する表現を使わない」に反する危険がある。

→ **「条件一致度」は出さず、`5 / 5 条件成立` のように件数で表示する**(仕様 §4 の WAIT 画面と同じ形式)。件数なら勝率と混同しない。

### ③ 4時間足・日足は合成になる

GMOの klines が返すのは `1min / 5min / 10min / 15min / 30min / 1hour` まで。**4時間足と日足は API から直接取れない**ので、1時間足を4本・24本まとめて合成する。合成なので、業者チャートの4時間足と数pips単位でずれる可能性がある。

なお **中継サーバ(Worker)の再デプロイは不要**。allowlist に 1min〜1hour が既に入っていることを確認済み。

### ④ 通知はブラウザの制約を受ける

Web版(スマホのブラウザ)では、通知は Notification API、バイブは Vibration API を使う。

- **ユーザーの許可が必要**(初回にダイアログ)
- **タブを閉じると通知は届かない**(バックグラウンド通知には Service Worker + Push サーバーが必要で、現在の静的ホスティング構成では実装できない)
- iOS Safari はホーム画面に追加した場合のみ通知可

→ 「タブを開いている間だけ通知します」と画面上に明記する。できないことを、できるように見せない。

### ⑤ 数量は 1,000通貨単位に丸める

OANDA証券(国内)の最小取引単位は 1,000通貨。計算結果が 2,340通貨でも **2,000通貨に切り下げ**て表示する(切り上げるとリスクが設定値を超えるため、必ず切り下げ)。

資金が小さく 1,000通貨未満になる場合は「**この資金とSL幅では最小単位(1,000通貨)がリスク許容度を超えます**」と表示し、ENTRY NOW を出さない。

---

## 1. 現在の構造分析

全 4,637行 / TypeScript + Expo SDK 57 (React Native 0.86 / React 19.2.3)。

### 画面

| 画面 | 行数 | 役割 |
|---|---|---|
| `WatchlistScreen` | 388 | 10通貨ペア一覧。シグナル・判定ラベル・件数バナー |
| `DetailScreen` | 255 | 1ペアの詳細。チャート・シグナル根拠・統計・判定カード |
| `ScanScreen` | 301 | 総当たり探索(探索/検証分割・多重比較補正) |

ナビゲーションは `@react-navigation/native-stack` の3画面スタック。**タブは未実装。**

### データ層

```
GMO Public API (認証不要)
  ↓ 中継Worker (CORS回避・秘密情報なし)
src/api/gmo.ts        klines(15分足) + ticker(現在値)
  ↓
src/api/forex.ts      キャッシュ(メモリ+localStorage 10分) / 供給元の切替
  ↓
src/utils/useLivePrices.ts   3秒ごとに ticker をポーリング
src/utils/useBarClose.ts     00/15/30/45分 +8秒 に足を再取得
```

フォールバック: 中継サーバに届かない場合は GitHub Actions が公開した静的JSONを読む(`src/api/publishedData.ts`)。

### 分析層

| ファイル | 内容 |
|---|---|
| `utils/indicators.ts` | sma / **ema** / rsi / macd / efficiencyRatio / lastValid |
| `utils/signal.ts` | `scoreAt()` = SMA±1 + RSI±1(±0.5) + MACD±1 → 合計±3。`actionFromScore(score, minScore)` |
| `utils/statistics.ts` | `backtestSignals(history, mode, horizonBars, minScore)` / `forecastNextBar` |
| `utils/verdict.ts` | `evaluateEntry()` = 勝率 / 期待値 / サンプル数 の3条件判定。Wilson信頼区間 |
| `utils/scan.ts` | 総当たり + Šidák補正 + 探索/検証分割 |
| `utils/normal.ts` | 逆正規分布(補正に必要) |

### 永続化

`localStorage` を3箇所で使用。同じパターン(モジュールレベル変数 + `useSyncExternalStore` + JSON保存)。

- `forex.ts` … レートキャッシュ(10分TTL)
- `strategyStore.ts` … 判定方針(自動/順張り/逆張り)
- `tradeSettings.ts` … FX/BO・ペイアウト・保有時間

**トレード履歴・資金・ポジションの保存は未実装。** v2で新規に必要。

### v2 に対する最大のギャップ

| # | ギャップ | 影響 |
|---|---|---|
| **A** | **`PricePoint` が `{date, rate}` だけで OHLC を持たない** | **ATR / ADX / サポレジが計算できない**。SL幅の算出に ATR が要る |
| **B** | 足種が `15min` 固定(`gmo.ts` の定数) | 1分/5分/1時間のマルチタイムフレームが取れない |
| C | ポジション・資金・履歴の状態が存在しない | ENTRY/HOLD/EXIT フロー全体 |
| D | タブナビゲーションが無い | ホーム/履歴/資金/分析 の4タブ |
| E | ATR / ADX / サポレジ 未実装 | 分析画面・SL算出 |

**A は朗報がある。** GMOの klines レスポンスには `open/high/low/close` が全部入っているのに、`gmo.ts` が close だけ拾って捨てている。つまり **追加のAPIリクエストは1本も要らない**。マッピングを直すだけで OHLC が手に入る。

---

## 2. 再利用する既存機能(壊さない)

仕様 §34「既存機能を不用意に削除しないでください」に従い、以下はそのまま活かす。

| 既存資産 | v2 での使い道 |
|---|---|
| `evaluateEntry()`(3条件判定) | **ENTRY NOW の5条件のうち「統計的優位性」条件として使う**。作り直さない |
| `scoreAt()` / `actionFromScore()` | 各時間足の方向判定にそのまま使う(足種を変えて呼ぶだけ) |
| `backtestSignals()` | 分析画面の過去成績。ホームからは外すが機能は残す |
| `ScanScreen` 一式 | **「分析」タブの中に丸ごと移設**。総当たり探索・多重比較補正・検証分割は v2 でも有効 |
| `useLivePrices()` | 現在価格 + **データ鮮度の監視**(§25 のデータ異常検知に転用) |
| `useBarClose()` | 15分足の確定検知。1分足用に汎用化 |
| `gmo.ts` の中継・CORS対応・並列制御 | そのまま |
| `publishedData.ts` フォールバック | そのまま(ただしフォールバック時は ENTRY NOW を出さない) |
| `LivePriceBar` / `PriceChart` | ホームと分析画面で再利用 |
| BO判定・ペイアウト設定 | 分析タブ配下に残す |
| `docs/roadmap.md` の1%ルール | §26 の資金管理計算の根拠として引き継ぐ |

**削除するもの: なし。** `WatchlistScreen` は「分析」タブの中に残す(10ペアの俯瞰は分析用途として有効)。

---

## 3. 変更するファイル

### 変更(既存)

| ファイル | 変更内容 | リスク |
|---|---|---|
| `src/types.ts` | `PricePoint` に `open/high/low/close` を追加(`rate` は残す=後方互換) | 低 |
| `src/api/gmo.ts` | OHLCを保持。`INTERVAL` を引数化。足種別キャッシュキー | 中 |
| `src/api/forex.ts` | 足種をキャッシュキーに含める | 中 |
| `src/utils/indicators.ts` | **追加のみ**(atr / adx / swingLevels)。既存関数は触らない | 低 |
| `src/utils/useBarClose.ts` | 任意の足種の確定時刻に対応 | 低 |
| `src/utils/useLivePrices.ts` | 最終更新時刻を返す(鮮度監視用) | 低 |
| `App.tsx` | ボトムタブ + スタックの入れ子 | 中 |
| `src/navigation/types.ts` | タブ + 各スタックの型 | 低 |
| `src/screens/WatchlistScreen.tsx` | 分析タブ配下へ移動(中身は据え置き) | 低 |
| `src/screens/ScanScreen.tsx` | 同上 | 低 |

`signal.ts` / `statistics.ts` / `verdict.ts` / `scan.ts` / `normal.ts` は **変更しない**(呼び出し側が足種を渡すだけ)。

### 新規

```
src/state/
  positionStore.ts     ポジション(FLAT / IN_POSITION)と状態遷移
  tradeHistoryStore.ts トレード履歴
  accountStore.ts      資金・リスク設定・日次集計
src/utils/
  timeframes.ts        足種の定義と合成(1h→4h/1d)
  marketContext.ts     マルチタイムフレームの環境認識
  nextAction.ts        NEXT ACTION の決定(状態機械)
  positionSizing.ts    数量・TP・SL・最大損失の計算
  dataHealth.ts        データ鮮度・異常検知
  notify.ts            通知(重複抑制つき)
src/screens/
  HomeScreen.tsx       ホーム(NEXT ACTION)
  HistoryScreen.tsx    履歴
  AccountScreen.tsx    資金
  AnalysisScreen.tsx   分析(既存画面の入口)
```

---

## 4. 新しく追加するコンポーネント

| コンポーネント | 役割 |
|---|---|
| `NextActionCard` | **画面で最も大きい要素。** 🟡待つ / 🟢買う / 🔴売る / 🔵そのまま保有 / 🔴今すぐ決済 / ⛔取引しない |
| `ConditionChecklist` | `3 / 5 条件成立` と各条件の ✓ / 待機中 |
| `OrderTicket` | OANDA入力内容(売買・数量・TP・SL) |
| `RiskSummary` | 最大損失・利益目標・RR |
| `EntryConfirmModal` | 「エントリーした」→ 約定価格の入力・修正 |
| `ExitConfirmModal` | 「決済した」→ 決済価格の入力・修正 |
| `PositionPanel` | 保有中の損益・ENTRY/現在/TP/SL/推奨保護SL |
| `TrendMeter` | トレンド強度・反転リスクのバー |
| `WhyPanel` | 「なぜ?」折りたたみ |
| `DataHealthBanner` | ⚠ データ確認中 |
| `TradeCompleteCard` | TRADE COMPLETE / 資金の増減 |
| `CapitalRoadmap` | 1万→3万→10万→30万→100万 の現在位置 |
| `BottomTabs` | ホーム / 履歴 / 資金 / 分析 |

既存の `SignalBadge` / `VerdictBadge` の配色(緑#15803D・赤#B91C1C・黄#B45309・青#2563EB)を踏襲する。

---

## 5. 状態管理方法

**新しいライブラリは入れない。** 既存の `strategyStore.ts` と同じパターン(モジュールレベル変数 + `useSyncExternalStore` + localStorage)を踏襲する。Redux等を持ち込むと既存3ストアと二重管理になる。

### `positionStore`

```ts
type Position =
  | { state: 'FLAT' }
  | { state: 'IN_POSITION';
      pairId, direction: 'BUY'|'SELL',
      entryPrice: number,      // OANDA実約定価格(ユーザー入力)
      units: number, tp: number, sl: number,
      openedAt: string };
```

localStorage に保存 → **リロードしてもポジションが消えない**(これは必須。持っているのに画面が忘れたら事故になる)。

### `accountStore`

```ts
{ startingCapital, currentCapital, riskPercent (既定2%),
  maxTradesPerDay (既定5), maxDailyLossPercent, maxConsecutiveLosses (既定3),
  goalCapital }
```

### `tradeHistoryStore`

```ts
Trade = { id, pairId, direction, entryPrice, exitPrice, units,
          tp, sl, entryReasons[], exitReasons[], openedAt, closedAt,
          pnlYen, pnlPips, result: 'WIN'|'LOSS'|'EVEN' }
```

日次集計(本日の取引数・損益・連敗数)は履歴から導出する。二重に持つと必ずズレるため、**保存はしない**。

---

## 6. ENTRY / HOLD / EXIT の判定フロー

### 状態機械(`nextAction.ts`)

```
                 ┌── データ異常 ─────→ ⚠ データ確認中(最優先)
                 ├── 停止条件 ──────→ ⛔ 取引しない
                 │   (連敗/日次損失/取引数上限/スプレッド拡大)
現在の状態 ──────┤
                 ├── ポジションあり ─→ HOLD / EXIT NOW
                 └── ポジションなし ─→ WAIT / READY / ENTRY NOW
```

**優先順位は絶対**: データ異常 > 停止条件 > ポジション管理 > 新規エントリー。
仕様 §8「ポジションを持った瞬間、決済ナビへ完全に切り替える」/ §10「EXIT NOW後は決済指示を優先」/ §25「データ異常時はENTRY NOWを出さない」に対応。

### 新規エントリーの5条件(仕様 §4 のチェックリスト)

| # | 条件 | 判定 |
|---|---|---|
| 1 | **市場環境** | 1時間足・4時間足の方向が一致(ADXでトレンド有無) |
| 2 | **15分方向** | 15分足の `scoreAt()` が方向を示す |
| 3 | **5分セットアップ** | 5分足が押し目/戻りを形成 |
| 4 | **1分トリガー** | 1分足が方向へ反転(**最後に成立**) |
| 5 | **RR** | TP/SL が RR 1:1.5 以上、かつ既存 `evaluateEntry()` が「見送り」でない |

- 5条件すべて成立 → **ENTRY NOW**
- 4条件成立(1分トリガー待ち) → **READY**(表示は「🟡 待つ / BUY準備中」)
- 3条件以下 → **WAIT**
- 上位足と15分足が逆方向 / 異常ボラ / スプレッド拡大 → **NO TRADE**

仕様 §20 の「上位足は環境認識。ENTRY NOW の直接トリガーにしない」を守る。日足・3日予測はトリガーに使わない。

### 保有中

| 判定 | 条件 |
|---|---|
| **EXIT NOW** | TP到達 / SL到達 / 1分足の反転 + 短期モメンタム低下 / 抵抗帯接近 / 上位足の環境転換 |
| **HOLD** | 上記いずれも無し。含み益が伸びたら**推奨保護SL**(建値〜トレーリング)を更新 |

### 「なぜ?」

判定に使った各条件の成否をそのまま保持して表示する。**判定と表示で同じデータを使う**(既存の `scoreAt` を表示と検証で共有しているのと同じ方針。食い違いを構造的に防ぐ)。

---

## 7. 資金管理計算方法(仕様 §26)

```
最大許容損失(円) = 現在資金 × リスク率
SL距離(pips)     = |エントリー価格 − SL価格| ÷ pipSize
1通貨あたり損失   = SL距離(pips) × pipSize × (対円なら1、クロスなら決済通貨→円レート)
推奨数量         = 最大許容損失 ÷ 1通貨あたり損失
                 → 1,000通貨単位に切り下げ
```

**例(仕様 §26 と一致)**

```
資金 10,000円 / リスク 2% → 最大損失 200円
SL 10pips = 0.10円/通貨
200 ÷ 0.10 = 2,000通貨  ✓
```

- **SL幅は ATR から決める**(直近の値動きの大きさに合わせる)。固定pipsだと相場が静かな時に広すぎ、荒れた時に狭すぎる
- **TP は RR 1:2 を基準**(仕様 §6 の例に合わせる)
- クロス通貨ペア(EUR/USD等)は決済通貨がUSDなので、**USD/JPYレートで円換算**してから数量を出す
- 1,000通貨未満になる場合は ENTRY NOW を出さず、理由を表示(前述 §0-⑤)

### 停止ルール(仕様 §27)

| ルール | 既定 | 動作 |
|---|---|---|
| 連敗 | 3連敗 | ⛔ 本日の新規トレード停止 |
| 日次損失 | 資金の6%(リスク2%×3) | ⛔ DAILY STOP |
| 1日の取引数 | 5回 | ⛔ 本日の上限に到達 |

すべて設定画面から変更可能にする。日付は端末のローカル日付で判定(0時リセット)。

---

## 8. スマートフォン画面構成

iPhone 縦(390×844、セーフエリア除く実効約 390×700)で、**スクロールせずに以下が収まること**を目標とする。

### ホーム(WAIT時)

```
┌─────────────────────────┐
│ USD/JPY      GMO LIVE ● │  40px  ペア + 接続状況
│ 最終更新 12:34:56        │
│                          │
│      156.320             │  60px  現在価格(大)
│                          │
│ ┌─────────────────────┐ │
│ │      🟡 待つ         │ │ 130px  NEXT ACTION(最大)
│ │     まだ入らない      │ │
│ └─────────────────────┘ │
│                          │
│ BUY候補 156.220〜156.245 │  40px
│                          │
│ 3 / 5 条件成立            │ 150px  チェックリスト
│ ✓15分方向 ✓5分 …        │
│                          │
│ [ なぜ? ]                │  40px  折りたたみ
├─────────────────────────┤
│ ホーム 履歴 資金 分析     │  60px  ボトムタブ
└─────────────────────────┘
                    合計 約520px → 収まる
```

### ホーム(ENTRY NOW時)

NEXT ACTION を 150px に拡大し、その直下に `OrderTicket`(数量・TP・SL)と `RiskSummary`(最大損失・利益目標・RR)、最下部に固定の [ エントリーした ] ボタン。**条件チェックリストは折りたたむ**(もう成立しているので読む必要がない)。

仕様 §28 の「現在アクション・価格・数量・TP・SL・最大損失・エントリーボタンがスクロールしすぎず確認できる」を満たす。

### PC

既存の `CONTENT_MAX_WIDTH` を維持しつつ、ホームは2カラム(左: NEXT ACTION、右: チャート+条件詳細)にする。

---

## 9. 実装手順

仕様 §34 の STEP に沿う。**各STEPごとにテストを書き、既存69件のテストが通り続けることを確認してから次へ進む。**

| STEP | 内容 | 主な成果物 |
|---|---|---|
| **1** | 既存機能整理 + **データ層の拡張** | `PricePoint`にOHLC / 足種の引数化 / `timeframes.ts` / ATR・ADX・サポレジ追加 |
| **2** | 状態管理設計 | `positionStore` / `accountStore` / `tradeHistoryStore` / `nextAction.ts` の状態機械 |
| **3** | 新ホームUI | `HomeScreen` / `NextActionCard` / `ConditionChecklist` / WAIT・READY・NO TRADE |
| **4** | ENTRYフロー | `OrderTicket` / `RiskSummary` / `EntryConfirmModal` / `positionSizing.ts` |
| **5** | HOLD / EXITフロー | `PositionPanel` / `TrendMeter` / `ExitConfirmModal` / `TradeCompleteCard` |
| **6** | 資金管理統合 | `AccountScreen` / `CapitalRoadmap` / 連敗・日次損失の停止 |
| **7** | 履歴 | `HistoryScreen` / 明細 |
| **8** | 分析画面整理 | `AnalysisScreen` に既存3画面 + マルチタイムフレーム + かんたん/PROモード |
| **9** | 通知 | `notify.ts`(重複抑制・許可要求・タブ制約の明示) |
| **10** | スマホUI調整 | 実機幅での収まり確認 |
| **11** | 状態遷移テスト | 完成条件①〜⑪ + 異常系 |

### STEP 11 でテストするシナリオ(仕様の完成条件)

正常系①〜⑪(起動→WAIT→READY→ENTRY NOW→エントリー登録→HOLD→推奨SL更新→EXIT NOW→決済登録→履歴保存→資金更新→数量再計算→WAIT復帰)に加えて、異常系を**モックで再現**して確認する。

| 異常系 | 確認内容 |
|---|---|
| SL到達 | EXIT NOW が出る |
| 3連敗 | ⛔ 新規停止。ENTRY NOW が出ない |
| 日次損失上限 | ⛔ DAILY STOP |
| データ停止 | ⚠ データ確認中。**ENTRY NOW が出ない** |
| 価格異常(飛び値・0・NaN) | 判定を停止する。誤った数値でシグナルを出さない |
| GMO/OANDA価格差 | 約定価格を修正でき、損益がその価格基準で計算される |
| リロード | ポジションが消えない |
| 資金不足(1,000通貨未満) | ENTRY NOW を出さず理由を表示 |

### 検証方法

このサンドボックスは外部ネットワークが遮断されているため実データは取得できない。**既存セッションと同じ方法**で検証する。

1. GMO API のモックサーバ(`scratchpad/gmo-mock.mjs`)を各時間足対応に拡張
2. `npx expo export --platform web` でビルドし、ローカルに配信
3. Playwright(実機幅 390×844)で状態遷移を実際にクリックして確認、スクリーンショットを取得
4. ロジックは Node の単体テストで境界値を確認

**実データでの動作確認はできない。**それは正直に報告する。

---

## 実装しないこと

- **自動売買・自動発注**(ユーザーの指示「自動売買はしない」を維持。発注機能は一切追加しない)
- 利益・勝率の保証、「あと○日で100万円」等の確定的予測(仕様 §0 / §18)
- DMM への接続(公開APIが存在しない)
- バックグラウンド通知(静的ホスティングでは実装不可)
