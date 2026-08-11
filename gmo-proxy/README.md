# GMO Public API CORS中継

GMOコイン「外国為替FX」のPublic APIは**ブラウザからの直接アクセス(CORS)に対応していません**。実機で確認済みです。この中継Workerを挟むと解決します。

## このWorkerの性質

**秘密情報を一切持ちません。** GMOのPublic APIは認証不要のため、APIキーもトークンも存在しません。したがって:

- `wrangler secret` の登録は不要
- 漏洩する情報が無い
- 万一URLが第三者に知られても、公開されている為替レートが読めるだけ

念のため、中継するのは読み取り専用の3エンドポイント(`/ticker`, `/klines`, `/status`)のみに制限し、通貨ペアと時間足は許可リスト方式にしています。

## デプロイ手順

```bash
cd gmo-proxy
npx wrangler login    # Cloudflareアカウント(無料)でログイン
npx wrangler deploy
```

以上です。表示されたURL(例: `https://hayabusa-fx-gmo-proxy.<あなた>.workers.dev`)を控えてください。

## 動作確認

```bash
curl "https://<あなたのURL>/ticker"
```

`{"status":0,"data":[{"symbol":"USD_JPY",...}]}` が返れば成功です。

## アプリへの設定

プロジェクトルートの `.env` に追記してビルドし直します。

```bash
EXPO_PUBLIC_GMO_PROXY_URL=https://<あなたのURL>
```

```bash
npx expo export --platform web
```

## 呼び出し元の制限(任意)

`wrangler.toml` の `ALLOWED_ORIGIN` を自分の公開URLにしておくと、他サイトからの呼び出しを弾けます。

```toml
ALLOWED_ORIGIN = "https://kei-047.github.io"
```

変更後は `npx wrangler deploy` で再デプロイしてください。

## 検証済みの動作

- Worker経由で `/ticker` `/klines` が正常に取得でき、`Access-Control-Allow-Origin` が付与される
- アプリ全体をWorker経由で動作させ、3秒ごとの現在値更新・10ペアのシグナル表示・統計カードすべてが動作
- 許可外の通貨ペアは400、未定義パスは404、POST等は405で拒否
