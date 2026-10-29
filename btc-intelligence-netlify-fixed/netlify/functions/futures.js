// Public Binance USD-M futures data. No API key required.
const API='https://fapi.binance.com';
const json=async(path)=>{const ctrl=new AbortController();const t=setTimeout(()=>ctrl.abort(),8000);try{const r=await fetch(API+path,{signal:ctrl.signal,headers:{'Accept':'application/json'}});if(!r.ok)throw Error('Binance HTTP '+r.status);return await r.json()}finally{clearTimeout(t)}};
exports.handler=async()=>{
 const headers={'Content-Type':'application/json','Cache-Control':'public, max-age=30'};
 try{
  const requests={oi:'/fapi/v1/openInterest?symbol=BTCUSDT',premium:'/fapi/v1/premiumIndex?symbol=BTCUSDT',ratio:'/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=1',klines:'/fapi/v1/klines?symbol=BTCUSDT&interval=5m&limit=3',depth:'/fapi/v1/depth?symbol=BTCUSDT&limit=100'};
  const entries=await Promise.all(Object.entries(requests).map(async ([k,v])=>{try{return [k,await json(v),null]}catch(e){return [k,null,e.message]}}));
  const data={},unavailable=[];const results=Object.fromEntries(entries.map(([k,v,e])=>{if(e)unavailable.push(k);return [k,v]}));
  if(unavailable.length===entries.length)throw Error('Seluruh endpoint Binance gagal (mungkin dibatasi menurut wilayah server).');
  if(results.oi){const n=Number(results.oi.openInterest);if(Number.isFinite(n))data.openInterestBTC=n;}
  if(results.premium){const n=Number(results.premium.lastFundingRate);if(Number.isFinite(n))data.fundingRate=n;const t=Number(results.premium.nextFundingTime);if(t>0)data.nextFundingTime=t;}
  if(Array.isArray(results.ratio)&&results.ratio[0]){const n=Number(results.ratio[0].longShortRatio);if(Number.isFinite(n))data.longShortRatio=n;}
  // Use last fully CLOSED 5m candle; index 9 is taker buy base volume.
  if(Array.isArray(results.klines)){const now=Date.now();const closed=results.klines.filter(k=>Number(k[6])<now).at(-1);if(closed){const total=Number(closed[5]),buy=Number(closed[9]);if(total>0&&Number.isFinite(buy)){data.takerBuyShare=buy/total;data.takerBuyVolumeBTC=buy;data.takerSellVolumeBTC=total-buy;}}}
  if(results.depth&&Array.isArray(results.depth.bids)&&Array.isArray(results.depth.asks)){
   const bids=results.depth.bids,asks=results.depth.asks;const bestBid=Number(bids[0]?.[0]),bestAsk=Number(asks[0]?.[0]),mid=(bestBid+bestAsk)/2;
   if(Number.isFinite(mid)&&mid>0){const bid=bids.reduce((s,[p,q])=>{p=Number(p);q=Number(q);return p>=mid*.995?s+p*q:s},0),ask=asks.reduce((s,[p,q])=>{p=Number(p);q=Number(q);return p<=mid*1.005?s+p*q:s},0);data.bidDepthUSDT=bid;data.askDepthUSDT=ask;if(bid+ask>0)data.depthImbalance=(bid-ask)/(bid+ask);}
  }
  return {statusCode:200,headers,body:JSON.stringify({ok:true,source:'Binance USD-M Futures public API',fetchedAt:new Date().toISOString(),data,unavailable})};
 }catch(e){return {statusCode:502,headers,body:JSON.stringify({ok:false,error:e.message})};}
};
