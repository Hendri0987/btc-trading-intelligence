
const BASE = 'https://www.okx.com';
const INST = 'BTC-USDT-SWAP';

async function get(path) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);

  try {
    const r = await fetch(BASE + path, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' }
    });

    const j = await r.json();

    if (!r.ok || j.code !== '0') {
      throw Error(`HTTP ${r.status}: ${j.msg || j.code}`);
    }

    return { ok: true, data: j.data };
  } catch (e) {
    return {
      ok: false,
      error: e.name === 'AbortError' ? 'Timeout' : e.message
    };
  } finally {
    clearTimeout(timer);
  }
}

exports.handler = async () => {
  const paths = {
    oi: `/api/v5/public/open-interest?instType=SWAP&instId=${INST}`,
    premium: `/api/v5/public/funding-rate?instId=${INST}`,
    depth: `/api/v5/market/books?instId=${INST}&sz=100`,
    trades: `/api/v5/market/trades?instId=${INST}&limit=100`,
    contract: `/api/v5/public/instruments?instType=SWAP&instId=${INST}`
  };

  const entries = await Promise.all(
    Object.entries(paths).map(async ([k, p]) => [k, await get(p)])
  );

  const res = Object.fromEntries(entries);

  const unavailable = entries
    .filter(([, v]) => !v.ok)
    .map(([k]) => k);

  const diagnostics = Object.fromEntries(
    entries.map(([k, v]) => [
      k,
      v.ok ? { ok: true } : { ok: false, error: v.error }
    ])
  );

  const data = {};

  if (res.oi.ok) {
    const v = Number(res.oi.data[0]?.oiCcy);
    if (Number.isFinite(v)) data.openInterestBTC = v;
  }

  if (res.premium.ok) {
    const v = res.premium.data[0];
    const rate = Number(v?.fundingRate);
    const next = Number(v?.fundingTime);

    if (Number.isFinite(rate)) data.fundingRate = rate;
    if (next > 0) data.nextFundingTime = next;
  }

  const c = res.contract.ok ? res.contract.data[0] : null;
  const ctVal = Number(c?.ctVal);
  const validContract =
    ctVal > 0 && c?.ctValCcy === 'BTC';

  if (res.depth.ok && validContract) {
    const b = res.depth.data[0]?.bids || [];
    const a = res.depth.data[0]?.asks || [];

    if (b.length && a.length) {
      const mid =
        (Number(b[0][0]) + Number(a[0][0])) / 2;

      const bid = b.reduce(
        (s, [p, q]) =>
          Number(p) >= mid * 0.995
            ? s + Number(p) * Number(q) * ctVal
            : s,
        0
      );

      const ask = a.reduce(
        (s, [p, q]) =>
          Number(p) <= mid * 1.005
            ? s + Number(p) * Number(q) * ctVal
            : s,
        0
      );

      data.bidDepthUSDT = bid;
      data.askDepthUSDT = ask;

      if (bid + ask > 0) {
        data.depthImbalance = (bid - ask) / (bid + ask);
      }
    }
  } else if (res.depth.ok) {
    unavailable.push('depthConversion');
  }

  if (res.trades.ok) {
    const rows = res.trades.data || [];

    const buy = rows
      .filter(t => t.side === 'buy')
      .reduce((s, t) => s + Number(t.sz), 0);

    const sell = rows
      .filter(t => t.side === 'sell')
      .reduce((s, t) => s + Number(t.sz), 0);

    if (buy + sell > 0) {
      data.takerBuyShare = buy / (buy + sell);
    }

    data.tradeSampleCount = rows.length;

    if (validContract) {
      data.recentTrades = rows
        .filter(t => t.tradeId && Number(t.sz) > 0)
        .map(t => ({
          id: String(t.tradeId),
          side: t.side,
          btc: Number(t.sz) * ctVal,
          ts: Number(t.ts)
        }));
    } else {
      unavailable.push('tradeConversion');
    }
  }

  unavailable.push('ratio');

  const ok = entries.some(([, v]) => v.ok);

  return {
    statusCode: ok ? 200 : 502,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify({
      ok,
      source: 'OKX BTC-USDT-SWAP Public API',
      fetchedAt: new Date().toISOString(),
      data,
      unavailable,
      diagnostics
    })
  };
};
