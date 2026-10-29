
const BASE = "https://www.okx.com";
const INST = "BTC-USDT-SWAP";

async function request(path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(BASE + path, {
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });

    const json = await response.json();

    if (!response.ok || json.code !== "0") {
      throw Error(
        `HTTP ${response.status}: ${json.msg || json.code}`
      );
    }

    return { ok: true, data: json.data };
  } catch (error) {
    return { ok: false, error: error.message };
  } finally {
    clearTimeout(timeout);
  }
}

exports.handler = async () => {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=30"
  };

  const paths = {
    oi: `/api/v5/public/open-interest?instType=SWAP&instId=${INST}`,
    premium: `/api/v5/public/funding-rate?instId=${INST}`,
    depth: `/api/v5/market/books?instId=${INST}&sz=100`,
    trades: `/api/v5/market/trades?instId=${INST}&limit=100`
  };

  const entries = await Promise.all(
    Object.entries(paths).map(async ([key, path]) =>
      [key, await request(path)]
    )
  );

  const results = Object.fromEntries(entries);
  const unavailable = entries
    .filter(([, result]) => !result.ok)
    .map(([key]) => key);

  const diagnostics = Object.fromEntries(
    entries.map(([key, result]) => [
      key,
      result.ok
        ? { ok: true }
        : { ok: false, error: result.error }
    ])
  );

  const data = {};

  if (results.oi.ok) {
    const row = results.oi.data[0];
    const value = Number(row?.oiCcy);

    if (Number.isFinite(value)) {
      data.openInterestBTC = value;
    }
  }

  if (results.premium.ok) {
    const row = results.premium.data[0];
    const rate = Number(row?.fundingRate);
    const next = Number(row?.fundingTime);

    if (Number.isFinite(rate)) {
      data.fundingRate = rate;
    }

    if (Number.isFinite(next) && next > 0) {
      data.nextFundingTime = next;
    }
  }

  if (results.depth.ok) {
    const book = results.depth.data[0];

    const bids = book?.bids || [];
    const asks = book?.asks || [];

    // OKX swap quantities are contracts.
    // Convert using contract value in BTC.
    const contract = await request(
      `/api/v5/public/instruments?instType=SWAP&instId=${INST}`
    );

    const ctVal = contract.ok
      ? Number(contract.data[0]?.ctVal)
      : NaN;

    const ctValCcy = contract.ok
      ? contract.data[0]?.ctValCcy
      : null;

    if (ctVal > 0 && ctValCcy === "BTC" &&
        bids.length && asks.length) {
      const mid =
        (Number(bids[0][0]) + Number(asks[0][0])) / 2;

      const bid = bids.reduce((sum, [price, qty]) => {
        const p = Number(price);
        return p >= mid * 0.995
          ? sum + p * Number(qty) * ctVal
          : sum;
      }, 0);

      const ask = asks.reduce((sum, [price, qty]) => {
        const p = Number(price);
        return p <= mid * 1.005
          ? sum + p * Number(qty) * ctVal
          : sum;
      }, 0);

      data.bidDepthUSDT = bid;
      data.askDepthUSDT = ask;

      if (bid + ask > 0) {
        data.depthImbalance =
          (bid - ask) / (bid + ask);
      }
    } else {
      unavailable.push("depthConversion");
      diagnostics.depthConversion = {
        ok: false,
        error: "Contract conversion unavailable"
      };
    }
  }

  if (results.trades.ok) {
    const trades = results.trades.data || [];
    const buy = trades
      .filter(t => t.side === "buy")
      .reduce((s, t) => s + Number(t.sz), 0);

    const sell = trades
      .filter(t => t.side === "sell")
      .reduce((s, t) => s + Number(t.sz), 0);

    if (buy + sell > 0) {
      data.takerBuyShare = buy / (buy + sell);
    }

    // Recent-trade sample, not a full 5m candle.
    data.tradeSampleCount = trades.length;
  }

  // OKX does not provide an equivalent ratio
  // through these selected public endpoints.
  unavailable.push("ratio");

  const ok = entries.some(([, result]) => result.ok);

  return {
    statusCode: ok ? 200 : 502,
    headers,
    body: JSON.stringify({
      ok,
      source: "OKX BTC-USDT-SWAP Public API",
      fetchedAt: new Date().toISOString(),
      data,
      unavailable,
      diagnostics
    })
  };
};
