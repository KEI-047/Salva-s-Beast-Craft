/**
 * GMOコイン「外国為替FX」Public API のCORS中継 (Cloudflare Workers)
 *
 * GMOのPublic APIは認証不要のため、このWorkerは**秘密情報を一切持ちません**。
 * ブラウザから直接叩けない(CORSヘッダが返らない)場合にのみ必要になります。
 * まずは中継なしで試し、CORSで失敗する場合だけデプロイしてください。
 *
 * 中継するのは読み取り専用の2つのエンドポイントだけです。
 */
const UPSTREAM = 'https://forex-api.coin.z.com/public/v1';

// 中継を許可するパス。これ以外は404にする。
const ALLOWED_PATHS = new Set(['/ticker', '/klines', '/status']);

const ALLOWED_SYMBOLS = new Set([
  'USD_JPY', 'EUR_JPY', 'GBP_JPY', 'AUD_JPY', 'NZD_JPY',
  'CAD_JPY', 'CHF_JPY', 'EUR_USD', 'GBP_USD', 'AUD_USD',
]);
const ALLOWED_INTERVALS = new Set(['1min', '5min', '10min', '15min', '30min', '1hour']);
const ALLOWED_PRICE_TYPES = new Set(['BID', 'ASK']);

function cors(request, env) {
  const allowed = (env.ALLOWED_ORIGIN || '*').split(',').map((s) => s.trim());
  const origin = request.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': allowed.includes('*')
      ? '*'
      : allowed.includes(origin)
        ? origin
        : allowed[0],
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

const json = (body, status, headers) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

export default {
  async fetch(request, env) {
    const headers = cors(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== 'GET') {
      return json({ error: 'Only GET is allowed' }, 405, headers);
    }

    const url = new URL(request.url);
    if (!ALLOWED_PATHS.has(url.pathname)) {
      return json({ error: 'Not found' }, 404, headers);
    }

    // 上流URLはここで組み立てる。クライアントのパスは使わない。
    const params = new URLSearchParams();

    if (url.pathname === '/klines') {
      const symbol = url.searchParams.get('symbol') || '';
      const interval = url.searchParams.get('interval') || '15min';
      const priceType = url.searchParams.get('priceType') || 'BID';
      const date = url.searchParams.get('date') || '';

      if (!ALLOWED_SYMBOLS.has(symbol)) {
        return json({ error: 'symbol not allowed' }, 400, headers);
      }
      if (!ALLOWED_INTERVALS.has(interval)) {
        return json({ error: 'interval not allowed' }, 400, headers);
      }
      if (!ALLOWED_PRICE_TYPES.has(priceType)) {
        return json({ error: 'priceType not allowed' }, 400, headers);
      }
      if (!/^\d{8}$/.test(date)) {
        return json({ error: 'date must be YYYYMMDD' }, 400, headers);
      }
      params.set('symbol', symbol);
      params.set('interval', interval);
      params.set('priceType', priceType);
      params.set('date', date);
    }

    const query = params.toString();
    const upstream = await fetch(`${UPSTREAM}${url.pathname}${query ? `?${query}` : ''}`, {
      method: 'GET',
    });

    if (!upstream.ok) {
      return json({ error: `upstream ${upstream.status}` }, 502, headers);
    }

    return new Response(await upstream.text(), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
    });
  },
};
