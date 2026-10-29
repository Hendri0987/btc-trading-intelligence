const allowed = new Set(['/fapi/v1/klines','/fapi/v1/premiumIndex','/fapi/v1/openInterest']);
export default async (request) => {
  const url = new URL(request.url);
  const path = url.searchParams.get('path');
  if (!path) return Response.json({error:'Missing path'}, {status:400});
  const target = new URL(path, 'https://fapi.binance.com');
  if (!allowed.has(target.pathname) || target.searchParams.get('symbol') !== 'BTCUSDT' || target.origin !== 'https://fapi.binance.com') return Response.json({error:'Unsupported market request'}, {status:400});
  if (target.pathname.endsWith('/klines') && (!['5m','15m'].includes(target.searchParams.get('interval')) || Number(target.searchParams.get('limit'))>220)) return Response.json({error:'Unsupported candles'}, {status:400});
  try {
    const response = await fetch(target.toString(), {headers:{Accept:'application/json'},signal:AbortSignal.timeout(9000)});
    const body = await response.text();
    return new Response(body,{status:response.status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
  } catch(e) {
    return Response.json({error:'Binance upstream unavailable',detail:String(e.message)},{status:502});
  }
};
