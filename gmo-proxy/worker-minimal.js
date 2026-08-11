// スマホのブラウザからCloudflareのダッシュボードに貼り付ける用の短縮版。
// 機能は worker.js と同じ(GMOのPublic APIをCORS付きで中継するだけ)。
// 秘密情報は持たない。転送先はGMO固定、GETのみ、中継するパスも3つに限定。
const UPSTREAM = 'https://forex-api.coin.z.com/public/v1';
const PATHS = ['/ticker', '/klines', '/status'];
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'GET') return new Response('{"error":"GET only"}', { status: 405, headers: CORS });

    const url = new URL(request.url);
    if (!PATHS.includes(url.pathname)) {
      return new Response('{"error":"not found"}', { status: 404, headers: CORS });
    }

    const upstream = await fetch(`${UPSTREAM}${url.pathname}${url.search}`);
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  },
};
