/**
 * OANDA v20 の「読み取り専用」プロキシ (Cloudflare Workers)
 *
 * ── 設計方針: このプロキシからは構造的に発注できない ──
 *
 * 1. クライアントからパスを受け取らない。
 *    通貨ペア名などを検証したうえで、上流URLはこのコード内で組み立てる。
 *    そのため /v3/accounts/.../orders のような発注エンドポイントには到達しようがない。
 * 2. 上流へのリクエストは GET 固定。OANDAの発注は POST/PUT のため、HTTPメソッドの面でも発注不可。
 * 3. 通貨ペアは許可リスト方式。リストにない文字列は一切通さない。
 * 4. トークンはWorkerのSecretに置き、ブラウザには決して送らない。
 *
 * さらに運用面として、デモ口座(fxTrade Practice)のトークンを使えば
 * 万一トークンが漏れても動かせる資金が存在しない。README参照。
 */

// 取り扱う通貨ペアの許可リスト(OANDA表記)。ここにないものは拒否する。
const ALLOWED_INSTRUMENTS = new Set([
  'USD_JPY', 'EUR_JPY', 'GBP_JPY', 'AUD_JPY', 'NZD_JPY', 'CAD_JPY', 'CHF_JPY',
  'ZAR_JPY', 'TRY_JPY', 'MXN_JPY', 'NOK_JPY', 'SEK_JPY', 'PLN_JPY', 'HUF_JPY',
  'EUR_USD', 'GBP_USD', 'AUD_USD', 'NZD_USD', 'EUR_AUD', 'GBP_AUD',
  'USD_CHF', 'EUR_CHF', 'GBP_CHF',
]);

// 時間足も許可リスト方式(このアプリは15分足のみ使う)
const ALLOWED_GRANULARITIES = new Set(['M5', 'M15', 'M30', 'H1']);

const MAX_INSTRUMENTS_PER_REQUEST = 30;
const MAX_COUNT = 1000;

function corsHeaders(request, env) {
  const allowed = (env.ALLOWED_ORIGIN || '*').split(',').map((s) => s.trim());
  const origin = request.headers.get('Origin') || '';
  const allowOrigin = allowed.includes('*')
    ? '*'
    : allowed.includes(origin)
      ? origin
      : allowed[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** 1通貨ペア分のローソク足を取得して、必要な項目だけに絞って返す。 */
async function fetchCandles(instrument, granularity, count, env) {
  const host = env.OANDA_ENV === 'live'
    ? 'https://api-fxtrade.oanda.com'
    : 'https://api-fxpractice.oanda.com';

  // 上流URLはここで組み立てる。クライアントの入力がパスに混ざることはない。
  const url =
    `${host}/v3/instruments/${encodeURIComponent(instrument)}/candles` +
    `?granularity=${encodeURIComponent(granularity)}` +
    `&count=${count}&price=M`;

  const upstream = await fetch(url, {
    method: 'GET', // 発注系は POST/PUT のため GET 固定で構造的に到達不可
    headers: {
      Authorization: `Bearer ${env.OANDA_TOKEN}`,
      'Accept-Datetime-Format': 'RFC3339',
    },
  });

  if (!upstream.ok) {
    return { status: 'error', message: `OANDA ${upstream.status}` };
  }

  const data = await upstream.json();
  // 未確定の足(complete=false)は除外し、終値だけを返す。
  const candles = (data.candles || [])
    .filter((c) => c.complete && c.mid)
    .map((c) => ({ time: c.time, close: c.mid.c }));

  return { status: 'ok', candles };
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    // 読み取り専用のため GET 以外は受け付けない
    if (request.method !== 'GET') {
      return json({ error: 'Only GET is allowed' }, 405, cors);
    }
    if (!env.OANDA_TOKEN) {
      return json({ error: 'OANDA_TOKEN is not configured' }, 500, cors);
    }

    const url = new URL(request.url);
    if (url.pathname !== '/candles') {
      return json({ error: 'Not found' }, 404, cors);
    }

    // --- 入力の検証(ここを通ったものだけが上流に届く) ---
    const requested = (url.searchParams.get('instruments') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (requested.length === 0) {
      return json({ error: 'instruments is required' }, 400, cors);
    }
    if (requested.length > MAX_INSTRUMENTS_PER_REQUEST) {
      return json({ error: 'too many instruments' }, 400, cors);
    }

    const invalid = requested.filter((i) => !ALLOWED_INSTRUMENTS.has(i));
    if (invalid.length > 0) {
      return json({ error: `instrument not allowed: ${invalid.join(',')}` }, 400, cors);
    }

    const granularity = url.searchParams.get('granularity') || 'M15';
    if (!ALLOWED_GRANULARITIES.has(granularity)) {
      return json({ error: 'granularity not allowed' }, 400, cors);
    }

    const count = Math.min(
      Math.max(parseInt(url.searchParams.get('count') || '288', 10) || 288, 1),
      MAX_COUNT
    );

    // OANDAにはローソク足の一括取得が無いため並列に投げる(上限120req/秒に対し十分小さい)
    const entries = await Promise.all(
      requested.map(async (instrument) => {
        try {
          return [instrument, await fetchCandles(instrument, granularity, count, env)];
        } catch (err) {
          return [instrument, { status: 'error', message: String(err) }];
        }
      })
    );

    return json(Object.fromEntries(entries), 200, cors);
  },
};
