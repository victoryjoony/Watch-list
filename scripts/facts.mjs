import {normalizeFinancials,finite,daysBetween,nyDate} from './market.mjs';
export {normalizeQuote} from './market.mjs';
export function financials(payload) {
  const f=normalizeFinancials(payload),map={};
  for(const s of payload.timeseries.result){
    const key=s.meta?.type?.[0];
    if(!key)continue;
    map[key]=[...new Map((s[key]||[]).filter(x=>x.periodType==='3M'&&x.currencyCode==='USD'&&finite(x.reportedValue?.raw)).map(x=>[x.asOfDate,{date:x.asOfDate,value:x.reportedValue.raw}])).values()].sort((a,b)=>a.date.localeCompare(b.date));
  }
  const revenues=(map.quarterlyTotalRevenue||[]).filter(x=>x.date<=f.period).slice(-4);
  f.ttmRevenue=revenues.length===4&&revenues.at(-1).date===f.period&&revenues.every((x,i)=>!i||(daysBetween(revenues[i-1].date,x.date)>=65&&daysBetween(revenues[i-1].date,x.date)<=115))?revenues.reduce((a,b)=>a+b.value,0):null;
  return f;
}
export function requiredGrowth(ps,margin,dilution,model){
  if(!(finite(ps)&&ps>0&&finite(margin)&&margin>0))return null;
  return (1+model.annualPriceReturn)*(1+dilution)*(ps/(model.terminalPE*margin))**(1/model.years)-1;
}
export function valuation(stock,quote,facts,model){
  // Baseline market capitalization uses dated source; never silently treat it as a current quote.
  if(!quote||quote.status!=='ok'||quote.splitFactor!==1)return {status:'unavailable',reason:'최신 시세 또는 분할 조정 주식 수 확인 필요'};
  const fresh=facts?.status==='ok'&&facts.ttmRevenue>0&&facts.shares>0;
  const cap=fresh?quote.close*facts.shares:stock.baseline.marketCap*(quote.close/stock.baseline.price);
  const revenue=fresh?facts.ttmRevenue:stock.baseline.ttmRevenue;
  const ps=cap/revenue;
  return {status:fresh?'current-proxy':'baseline-proxy',marketCap:cap,ttmRevenue:revenue,ps,
    inputPeriod:fresh?facts.period:stock.baseline.period,priceDate:quote.date,
    method:fresh?'최근 분기 말 보통주 수 × 종가 / 최근 4개 분기 매출':'2026-10-23 시총에 가격 변화만 반영 / 최초 조사 TTM 매출 · 주식 수 변화 미반영',
    required:model.annualDilution.map(d=>({dilution:d,growth:requiredGrowth(ps,stock.margin,d,model)})),
    sensitivity:stock.marginRange.map(m=>({margin:m,growth:requiredGrowth(ps,m,0.03,model)}))};
}
export function extended(payload,now=new Date(),targetDate=null){
  const r=payload?.chart?.result?.[0];
  if(payload?.chart?.error||r?.meta?.currency!=='USD'||r?.meta?.exchangeTimezoneName!=='America/New_York')throw new Error('장외 시세 통화·시간대·응답 확인 필요');
  const periods=r.meta.currentTradingPeriod,rows=[];
  for(let i=0;i<(r.timestamp||[]).length;i++){
    const t=r.timestamp[i],price=r.indicators?.quote?.[0]?.close?.[i];
    if(!finite(price)||price<=0||t>now.getTime()/1000)continue;
    const date=nyDate(t),hour=+new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',hourCycle:'h23'}).format(new Date(t*1000));
    if(hour>=16&&hour<20&&(!targetDate||date===targetDate))rows.push({time:new Date(t*1000).toISOString(),date,price});
  }
  const last=rows.at(-1);
  return {status:last?'ok':'unavailable',first:last?rows.find(x=>x.date===last.date):null,last:last||null,
    completed:Boolean(last&&(nyDate(now.getTime()/1000)>last.date||+new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',hourCycle:'h23'}).format(now)>=20)),
    note:'장외 1분봉 종가 표본. 첫 체결가·실적 공개 순간 가격을 뜻하지 않으며, 거래소 전체 체결을 포괄하지 않음.',
    regularEnd:periods?.regular?.end||null,fetchedAt:now.toISOString()};
}
export function eventSnapshot(stock,daily,intraday,old,now){
  if(!stock.event)return null;
  const r=daily?.chart?.result?.[0],q=r?.indicators?.quote?.[0];
  const row=date=>{
    const i=r?.timestamp?.findIndex(t=>nyDate(t)===date);
    if(i===undefined||i<0)return null;
    // Do not capture incomplete earnings-day regular bars.
    const end=r.meta?.currentTradingPeriod?.regular?.end;
    if(date===nyDate(now.getTime()/1000)&&(!end||now.getTime()/1000<end+900))return null;
    return {date,open:q?.open?.[i]??null,high:q?.high?.[i]??null,low:q?.low?.[i]??null,close:q?.close?.[i]??null};
  };
  let e=old||{};
  const ex=intraday?.last?.date===stock.event.dateNY?intraday:null;
  return {...e,label:stock.event.label,dateNY:stock.event.dateNY,source:stock.event.source,
    previous:row(stock.event.previousSession)||e.previous||null,
    regular:row(stock.event.dateNY)||e.regular||null,
    afterhours:ex||e.afterhours||null};
}
