exports.handler = async () => {
  try {
    const intervals = [5,15];
    const results = await Promise.all(intervals.map(async interval => {
      const response = await fetch(`https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=${interval}`, {headers:{'User-Agent':'BTC-Intelligence-v2'}});
      if (!response.ok) throw new Error(`Kraken HTTP ${response.status}`);
      const body=await response.json();
      if(body.error?.length) throw new Error(body.error.join(', '));
      const key=Object.keys(body.result).find(k=>k!=='last');
      if(!key || !Array.isArray(body.result[key])) throw new Error('Missing OHLC data');
      return body.result[key].slice(0,-1).slice(-240).map(x=>({t:Number(x[0])*1000,o:Number(x[1]),h:Number(x[2]),l:Number(x[3]),c:Number(x[4]),v:Number(x[6])}));
    }));
    if(results.some(x=>x.length<60)) throw new Error('Insufficient candle history');
    return {statusCode:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify({source:'Kraken BTC/USD Spot',fetchedAt:new Date().toISOString(),m5:results[0],m15:results[1]})};
  }catch(e){return {statusCode:502,headers:{'Content-Type':'application/json'},body:JSON.stringify({error:String(e.message||e)})};}
};
