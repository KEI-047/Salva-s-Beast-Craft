#!/usr/bin/env bash
#
# GitHub Pages 向けのWebビルド。
#
# 手で `npx expo export -p web` を叩くと EXPO_PUBLIC_GMO_PROXY_URL を渡し忘れる。
# 渡し忘れたバンドルはブラウザからGMOへ直接アクセスし、CORSで全滅する。
# 画面には「⚠ データ確認中」しか出ないため、原因が分かりにくい。
# 既定値をここに固定し、**ビルド後にバンドルへ実際に入ったかを検査**する。
#
# この中継サーバは秘密情報を一切持たない(GMOのPublic APIは認証不要)。
# したがってURLをリポジトリに置いても漏れる情報はない。
#
# 使い方: bash scripts/deploy-web.sh   → dist/ を作る(デプロイはしない)
set -euo pipefail

cd "$(dirname "$0")/.."

PROXY="${EXPO_PUBLIC_GMO_PROXY_URL:-https://hayabusa-fx-gmo-proxy.kei-047.workers.dev}"
# GitHub Pages はリポジトリ名のサブパスで配信されるため、baseUrl が要る。
BASE="${WEB_BASE_URL:-/Salva-s-Beast-Craft}"

echo "中継サーバ: $PROXY"
echo "ベースURL : $BASE"

cp app.json app.json.deploybak
trap 'mv -f app.json.deploybak app.json 2>/dev/null || true' EXIT

node -e "
const fs = require('fs');
const app = JSON.parse(fs.readFileSync('app.json', 'utf8'));
app.expo.experiments = { ...(app.expo.experiments || {}), baseUrl: process.argv[1] };
fs.writeFileSync('app.json', JSON.stringify(app, null, 2) + '\n');
" "$BASE"

rm -rf dist
# --clear は必須。EXPO_PUBLIC_* はバンドル時に埋め込まれるため、キャッシュが残っていると
# 前回の値(未設定なら undefined)のまま出力される。実際にこれで事故を起こしている。
EXPO_PUBLIC_GMO_PROXY_URL="$PROXY" npx expo export -p web --clear

mv -f app.json.deploybak app.json
trap - EXIT

# 検査: 中継サーバのURLがバンドルに入っていなければ、その dist は公開してはいけない。
if ! grep -rqF "$PROXY" dist/_expo/static/js/web/; then
  echo "エラー: 中継サーバのURLがバンドルに入っていません。公開しないでください。" >&2
  exit 1
fi
if ! grep -qF "$BASE/_expo/static/js/web/" dist/index.html; then
  echo "エラー: index.html のベースURLが $BASE になっていません。" >&2
  exit 1
fi

echo "OK: dist/ を作成し、中継サーバURLとベースURLの両方を確認しました。"
