
const API = "https://fapi.binance.com";

async function getData(path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(API + path, {
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });

    const body = await response.text();

    if (!response.ok) {
      return {
        ok: false,
        httpStatus: response.status,
        error: body.slice(0, 300)
      };
    }

    try {
      return {
        ok: true,
        httpStatus: response.status,
        data: JSON.parse(body)
      };
    } catch {
      return {
        ok: false,
        httpStatus: response.status,
        error: "Invalid JSON response"
      };
    }
  } catch (error) {
    return {
      ok: false,
      httpStatus: null,
      error: error.name === "AbortError"
        ? "Request timeout"
        : error.message
    };
  } finally {
    clearTimeout(timeout);
  }
}

exports.handler = async () => {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  };

  const endpoints = {
    oi: "/fapi/v1/openInterest?symbol=BTCUSDT",
    premium: "/fapi/v1/premiumIndex?symbol=BTCUSDT",
    ratio: "/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=1",
    klines: "/fapi/v1/klines?symbol=BTCUSDT&interval=5m&limit=3",
    depth: "/fapi/v1/depth?symbol=BTCUSDT&limit=100"
  };

  const entries = await Promise.all(
    Object.entries(endpoints).map(async ([name, path]) => {
      return [name, await getData(path)];
    })
  );

  const results = Object.fromEntries(entries);
  const diagnostics = {};
  const unavailable = [];
  const data = {};

  for (const [name, result] of entries) {
    diagnostics[name] = {
      ok: result.ok,
      httpStatus: result.httpStatus,
      ...(result.ok ? {} : { error: result.error })
    };

    if (!result.ok) unavailable.push(name);
  }

  if (results.oi.ok) {
    const n = Number(results.oi.data.openInterest);
    if (Number.isFinite(n)) data.openInterestBTC = n;
  }

  if (results.premium.ok) {
    const premium = results.premium.data;
    const funding = Number(premium.lastFundingRate);
    const next = Number(premium.nextFundingTime);

    if (Number.isFinite(funding)) data.fundingRate = funding;
    if (next > 0) data.nextFundingTime = next;
  }

  if (results.ratio.ok) {
    const ratio = results.ratio.data;
    if (Array.isArray(ratio) && ratio[0]) {
      const n = Number(ratio[0].longShortRatio);
      if (Number.isFinite(n)) data.longShortRatio = n;
    }
  }

  if (results.klines.ok) {
    const klines = results.klines.data;

    if (Array.isArray(klines)) {
      const now = Date.now();
      const closed = klines.filter(
        k => Number(k[6]) < now
      ).at(-1);

      if (closed) {
        const total = Number(closed[5]);
        const buy = Number(closed[9]);

        if (total > 0 && Number.isFinite(buy)) {
          data.takerBuyShare = buy / total;
          data.takerBuyVolumeBTC = buy;
          data.takerSellVolumeBTC = total - buy;
        }
      }
    }
  }

  if (results.depth.ok) {
    const depth = results.depth.data;

    if (Array.isArray(depth.bids) && Array.isArray(depth.asks)) {
      const bestBid = Number(depth.bids[0]?.[0]);
      const bestAsk = Number(depth.asks[0]?.[0]);
      const mid = (bestBid + bestAsk) / 2;

      if (Number.isFinite(mid) && mid > 0) {
        const bid = depth.bids.reduce((sum, [p, q]) => {
          p = Number(p);
          q = Number(q);
          return p >= mid * 0.995 ? sum + p * q : sum;
        }, 0);

        const ask = depth.asks.reduce((sum, [p, q]) => {
          p = Number(p);
          q = Number(q);
          return p <= mid * 1.005 ? sum + p * q : sum;
        }, 0);

        data.bidDepthUSDT = bid;
        data.askDepthUSDT = ask;

        if (bid + ask > 0) {
          data.depthImbalance = (bid - ask) / (bid + ask);
        }
      }
    }
  }

  const ok = unavailable.length < entries.length;

  return {
    statusCode: ok ? 200 : 502,
    headers,
    body: JSON.stringify({
      ok,
      source: "Binance USD-M Futures public API",
      fetchedAt: new Date().toISOString(),
      data,
      unavailable,
      diagnostics
    })
  };
};
