import fs from 'node:fs/promises';
import {normalizeQuote,financials,valuation,extended,eventSnapshot} from './facts.mjs';
import {daysBetween} from './market.mjs';
const config=JSON.parse(await fs.readFile('config/watchlist.json','utf8'));
let previous={stocks:{},events:[],history:[]};
try{previous=JSON.parse(await fs.readFile('data/latest.json','utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
const now=new Date(),today=now.toISOString().slice(0,10),out={schemaVersion:1,checkedAt:now.toISOString(),stocks:{},health:{status:'ok',errors:[]},events:previous.events||[],history:previous.history||[]};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function json(url){
  for(let n=0;n<3;n++){
    try{
      const r=await fetch(url,{headers:{'User-Agent':'Watch-list research contact github.com/victoryjoony/Watch-list','Accept':'application/json'},signal:AbortSignal.timeout(20000)});
      if(!r.ok)throw new Error('HTTP '+r.status);
      return await r.json();
    }catch(e){if(n===2)throw e;await pause(1000*(n+1));}
  }
}
const types=['quarterlyTotalRevenue','quarterlyOperatingIncome','quarterlyOperatingCashFlow','quarterlyCapitalExpenditure','quarterlyOrdinarySharesNumber','quarterlyDilutedEPS','trailingDilutedEPS'];
for(const stock of config.stocks){
  const old=previous.stocks[stock.ticker]||{},s={...structuredClone(old),errors:[],checkedAt:now.toISOString()},ticker=stock.ticker;
  let daily=null,intra=null;
  async function attempt(key,fn){
    try{s[key]=await fn();}catch(e){s.errors.push(key+': '+e.message);s[key]=s[key]?{...s[key],status:'stale'}:{status:'unavailable'};}
    await pause(400);
  }
  await attempt('quote',async()=>{
    const start=Math.floor(Math.min(now.getTime()/1000-420*86400,Date.parse(config.reviewedAt)/1000-86400*40));
    daily=await json(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&events=splits&period1=${start}&period2=${Math.floor(now.getTime()/1000)+86400}`);
    const q=normalizeQuote(daily,now,stock.baseline.priceDate);
    if(old.quote?.date>q.date)throw new Error('가격 기준일 후퇴');
    return q;
  });
  await attempt('financials',async()=>{
    const p=await json(`https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${ticker}?symbol=${ticker}&type=${types.join(',')}&period1=${Math.floor(now.getTime()/1000)-900*86400}&period2=${Math.floor(now.getTime()/1000)}`);
    const f=financials(p);
    if(f.period<stock.baseline.period||f.period<(old.financials?.period||''))throw new Error('재무 기간 후퇴 또는 최초 조사보다 과거');
    return {...f,fetchedAt:now.toISOString(),sourceUrl:`https://finance.yahoo.com/quote/${ticker}/financials/`};
  });
  await attempt('afterhours',async()=>{
    const p=await json(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1m&range=5d&includePrePost=true`);
    const latest=extended(p,now);
    intra=stock.event?extended(p,now,stock.event.dateNY):latest;
    return {...latest,sourceUrl:`https://finance.yahoo.com/quote/${ticker}/`};
  });
  // Primary SEC disclosure discovery: link to actual filing; no automated interpretation of its content.
  await attempt('filings',async()=>{
    const p=await json(`https://data.sec.gov/submissions/CIK${stock.cik}.json`),r=p.filings?.recent;
    if(!r?.accessionNumber)throw new Error('최근 공시 목록 없음');
    const entries=r.accessionNumber.map((a,i)=>({form:r.form[i],date:r.filingDate[i],items:r.items?.[i]||'',url:`https://www.sec.gov/Archives/edgar/data/${Number(stock.cik)}/${a.replaceAll('-','')}/${r.primaryDocument[i]}`}))
      .filter(x=>['10-K','10-Q','8-K','4'].includes(x.form)).slice(0,12);
    return {status:'ok',fetchedAt:now.toISOString(),entries};
  });
  s.event=eventSnapshot(stock,daily,intra,old.event,now);
  s.valuation=valuation(stock,s.quote,s.financials,config.model);
  s.flags=[];
  if(s.errors.length)s.flags.push('[사실] 일부 자료 조회 실패: 이전 값의 기준일과 상태 확인 필요.');
  if(s.financials.status==='ok'){
    if(daysBetween(stock.baseline.period,s.financials.period)>14)s.flags.push('[사실] 최초 조사 이후 새 분기 자료 반영. [의견] 기존 결론·이익률 가정을 다시 검토할 시점.');
    if(s.financials.revenueYoY<0)s.flags.push('[사실] 최근 분기 매출 전년 대비 감소.');
    if(s.financials.fcfProxy<0)s.flags.push('[사실] 분기 영업현금흐름−설비투자가 음수.');
    if(s.financials.marginChangePP<=-3)s.flags.push('[사실] 영업이익률이 전년 동기 대비 3%p 이상 하락.');
    if(daysBetween(s.financials.period,today)>150)s.flags.push('[사실] 재무 기준일이 150일 이상 경과. 공급자 실적 반영 지연 확인 필요.');
  }
  const newFilings=s.filings.entries?.filter(x=>x.date>config.reviewedAt&&x.form!=='4')||[];
  if(newFilings.length)s.flags.push('[사실] 최초 조사 이후 SEC 공시 있음. [의견] 원문에서 실적·계약·경영진 변경 등 확인 필요.');
  if(!s.flags.length)s.flags.push('[의견] 자동 수집 범위에서 새 재검토 신호 없음. 신규 투자 판단을 뜻하지 않음.');
  if(old.financials?.period&&s.financials.status==='ok'&&daysBetween(old.financials.period,s.financials.period)>14){
    const id=ticker+':'+s.financials.period;
    if(!out.events.some(x=>x.id===id))out.events.unshift({id,ticker,period:s.financials.period,detectedAt:now.toISOString()});
  }
  out.stocks[ticker]=s;out.health.errors.push(...s.errors.map(e=>ticker+' '+e));
  console.log(ticker, s.quote.date||'가격 없음',s.financials.period||'재무 없음',s.errors);
}
out.health.status=Object.values(out.stocks).every(s=>s.quote.status!=='ok')?'failed':out.health.errors.length?'partial':'ok';
out.events=out.events.slice(0,100);
out.history=out.history.filter(x=>x.date!==today);
out.history.push({date:today,checkedAt:out.checkedAt,status:out.health.status,stocks:Object.fromEntries(Object.entries(out.stocks).map(([t,s])=>[t,{date:s.quote.date,close:s.quote.close,priceStatus:s.quote.status,financialPeriod:s.financials.period,required:s.valuation.required}]))});
out.history=out.history.slice(-400);
await fs.mkdir('data',{recursive:true});await fs.writeFile('data/latest.json.tmp',JSON.stringify(out,null,2)+'\n');await fs.rename('data/latest.json.tmp','data/latest.json');
if(process.env.GITHUB_STEP_SUMMARY)await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,`## Watch-list\n${out.checkedAt}\nStatus: ${out.health.status}\n${out.health.errors.map(x=>'- '+x).join('\n')}\n`);
