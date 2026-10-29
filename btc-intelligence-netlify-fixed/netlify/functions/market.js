const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };
exports.handler = async () => {
  try {
    const frames = await Promise.all([5,15,60].map(async interval => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        const r = await fetch(`https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=${interval}`, {signal:controller.signal,headers:{'User-Agent':'BTC-Trading-Intelligence/Final'}});
        if(!r.ok) throw new Error(`Kraken ${interval}m HTTP ${r.status}`);
        const j = await r.json();
        if(j.error?.length) throw new Error(`Kraken ${interval}m: ${j.error.join(', ')}`);
        const key = Object.keys(j.result||{}).find(k=>k!=='last');
        if(!key || !Array.isArray(j.result[key])) throw new Error(`Missing ${interval}m candles`);
        const candles = j.result[key].slice(0,-1).slice(-700).map(a=>({t:Number(a[0])*1000,o:Number(a[1]),h:Number(a[2]),l:Number(a[3]),c:Number(a[4]),v:Number(a[6])})).filter(c=>Object.values(c).every(Number.isFinite));
        if(candles.length<70) throw new Error(`Insufficient ${interval}m history`);
        return candles;
      } finally {clearTimeout(timer)}
    }));
    return {statusCode:200,headers,body:JSON.stringify({source:'Kraken BTC/USD Spot',fetchedAt:new Date().toISOString(),m5:frames[0],m15:frames[1],h1:frames[2],disclaimer:'Spot reference, not Binance Futures execution price'})};
  } catch(e) {return {statusCode:502,headers,body:JSON.stringify({error:String(e.message||e)})}}
};
