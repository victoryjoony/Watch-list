const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const nyDate = seconds => new Intl.DateTimeFormat('en-CA', {
  timeZone:'America/New_York', year:'numeric',month:'2-digit',day:'2-digit'
}).format(new Date(seconds*1000));
export const daysBetween = (a,b) => (Date.parse(b)-Date.parse(a))/86400000;
export const finite = v => typeof v==='number' && Number.isFinite(v);
export function normalizeQuote(payload, now = new Date(), baselineDate='2026-10-26') {
  const r=payload?.chart?.result?.[0];
  if(payload?.chart?.error || !r) throw new Error('종가 응답 누락');
  if(r.meta?.currency!=='USD' || r.meta?.exchangeTimezoneName!=='America/New_York') throw new Error('통화·거래소 시간대 불일치');
  const q=r.indicators?.quote?.[0], nowSec=now.getTime()/1000, today=nyDate(nowSec);
  const end=r.meta.currentTradingPeriod?.regular?.end;
  const start=r.meta.currentTradingPeriod?.regular?.start;
  const rows=(r.timestamp||[]).map((t,i)=>({t,date:nyDate(t),close:q?.close?.[i]}))
    .filter(x=>finite(x.close)&&x.close>0&&x.t<=nowSec)
    .filter(x=>x.date<today || (x.date===today&&start&&nyDate(start)===today&&end&&nowSec>=end+900))
    .sort((a,b)=>a.t-b.t);
  const latest=rows.at(-1);
  if(!latest || daysBetween(latest.date,today)>10) throw new Error('최근 완료 정규장 종가 없음');
  const previous=rows.at(-2);
  const splits=Object.values(r.events?.splits||{}).filter(s=>nyDate(s.date)>baselineDate&&nyDate(s.date)<=latest.date);
  let splitFactor=1;
  for(const s of splits){
    if(!(finite(s.numerator)&&finite(s.denominator)&&s.numerator>0&&s.denominator>0)) throw new Error('주식분할 비율 확인 필요');
    splitFactor*=s.numerator/s.denominator;
  }
  const splitOnLatest=splits.some(s=>nyDate(s.date)===latest.date);
  return {close:+latest.close.toFixed(4),date:latest.date,currency:'USD',previousClose:previous?.close??null,
    changePct:previous&&!splitOnLatest?(latest.close/previous.close-1)*100:null,splitFactor,
    source:'Yahoo Finance 공개 일별 시세',sourceUrl:'https://finance.yahoo.com/quote/'+r.meta.symbol+'/history/',
    fetchedAt:now.toISOString(),status:'ok'};
}
export function normalizeFinancials(payload) {
  if(payload?.timeseries?.error || !Array.isArray(payload?.timeseries?.result)) throw new Error('재무 응답 누락');
  const map={};
  for(const series of payload.timeseries.result){
    const type=series.meta?.type?.[0];
    if(!type)continue;
    map[type]=(series[type]||[]).filter(x=>DATE.test(x.asOfDate||'')&&x.currencyCode==='USD'&&finite(x.reportedValue?.raw))
      .map(x=>({date:x.asOfDate,value:x.reportedValue.raw,period:x.periodType}))
      .filter(x=>type.startsWith('quarterly')?x.period==='3M':x.period==='TTM')
      .sort((a,b)=>a.date.localeCompare(b.date));
    map[type]=[...new Map(map[type].map(x=>[x.date,x])).values()];
  }
  const revenues=map.quarterlyTotalRevenue||[],current=revenues.at(-1);
  if(!current||current.value<=0)throw new Error('최근 분기 매출 없음');
  const date=current.date;
  const at=(key,d=date)=>map[key]?.find(x=>x.date===d)?.value??null;
  const prior=revenues.find(x=>{const d=daysBetween(x.date,date);return d>=330&&d<=400;});
  const op=at('quarterlyOperatingIncome'),oldOp=prior?at('quarterlyOperatingIncome',prior.date):null;
  const ocf=at('quarterlyOperatingCashFlow'),capex=at('quarterlyCapitalExpenditure');
  let ttm=(map.trailingDilutedEPS||[]).find(x=>x.date===date)?.value??null;
  let epsMethod=ttm===null?null:'공급자 TTM 희석 EPS';
  if(ttm===null){
    const eps=(map.quarterlyDilutedEPS||[]).filter(x=>x.date<=date).slice(-4);
    if(eps.length===4&&eps.at(-1).date===date&&eps.every((x,i)=>!i||(daysBetween(eps[i-1].date,x.date)>=65&&daysBetween(eps[i-1].date,x.date)<=115))){
      ttm=eps.reduce((n,x)=>n+x.value,0);epsMethod='최근 4개 분기 희석 EPS 합계(근사)';
    }
  }
  const shares=at('quarterlyOrdinarySharesNumber');
  return {period:date,revenue:current.value,quarterEPS:at('quarterlyDilutedEPS'),
    revenueYoY:prior&&prior.value>0?current.value/prior.value-1:null,
    operatingMargin:finite(op)?op/current.value:null,
    marginChangePP:prior&&finite(oldOp)&&finite(op)?(op/current.value-oldOp/prior.value)*100:null,
    operatingCashFlow:ocf,capex:finite(capex)?Math.abs(capex):null,
    fcfProxy:finite(ocf)&&finite(capex)?ocf-Math.abs(capex):null,
    ttmEPS:ttm,epsMethod,shares:finite(shares)&&shares>0?shares:null,
    source:'Yahoo Finance 공개 재무 시계열',currency:'USD',status:'ok'};
}
