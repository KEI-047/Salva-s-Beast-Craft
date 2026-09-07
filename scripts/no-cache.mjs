import fs from 'node:fs';

/**
 * index.html にキャッシュ抑止を入れる。
 *
 * JSのファイル名にはハッシュが付くので中身の更新は勝手に反映される。しかし
 * その名前を指す index.html 自体が端末に残ると、いつまでも古いJSを読み続ける。
 * 実際に「新しいボタンが出ない」という形で表面化した。
 * GitHub Pages では HTTPヘッダを設定できないため、metaタグで指示する。
 */
const file = process.argv[2] ?? 'dist/index.html';
let html = fs.readFileSync(file, 'utf8');

const meta = [
  '<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">',
  '<meta http-equiv="Pragma" content="no-cache">',
  '<meta http-equiv="Expires" content="0">',
].join('');

if (!html.includes('no-store')) {
  html = html.replace('<head>', `<head>${meta}`);
  fs.writeFileSync(file, html);
}
