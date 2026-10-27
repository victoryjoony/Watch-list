import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeQuote,financials,requiredGrowth,valuation,extended,eventSnapshot} from '../scripts/facts.mjs';
const model={annualPriceReturn:.1,years:10,terminalPE:20,annualDilution:[0,.03]};
test('reverse growth reproduces required future price including dilution',()=>{
  const ps=3,m=.1,d=.03,g=requiredGrowth(ps,m,d,model);
  const finalMultiple=20*m*(1+g)**10/(1+d)**10/ps;
  assert.ok(Math.abs(finalMultiple-1.1**10)<1e-10);
});
test('split or stale quote blocks model rather than silently use old shares',()=>{
  assert.equal(valuation({}, {status:'ok',splitFactor:2},{},model).status,'unavailable');
  assert.equal(valuation({}, {status:'stale',splitFactor:1},{},model).status,'unavailable');
});
test('unavailable current financials explicitly use dated baseline proxy',()=>{
  const v=valuation({baseline:{marketCap:100,price:10,ttmRevenue:50,period:'2026-06-30'},margin:.1,marginRange:[.08,.12]}, {status:'ok',splitFactor:1,close:12,date:'2026-10-26'}, {status:'unavailable'},model);
  assert.equal(v.status,'baseline-proxy');assert.equal(v.marketCap,120);assert.equal(v.inputPeriod,'2026-06-30');
});
function chart(){return {chart:{result:[{meta:{symbol:'FN',currency:'USD',exchangeTimezoneName:'America/New_York',currentTradingPeriod:{regular:{start:Date.parse('2026-11-02T14:30:00Z')/1000,end:Date.parse('2026-11-02T21:00:00Z')/1000}}},timestamp:['2026-10-30T13:30Z','2026-11-02T14:30Z'].map(x=>Date.parse(x)/1000),indicators:{quote:[{close:[100,110]}]}}]}};}
test('unfinished regular session is excluded; completed close is accepted',()=>{
  assert.equal(normalizeQuote(chart(),new Date('2026-11-02T20:00Z')).date,'2026-10-30');
  assert.equal(normalizeQuote(chart(),new Date('2026-11-02T21:16Z')).date,'2026-11-02');
});
test('old quote and wrong currency fail visibly',()=>{
  assert.throws(()=>normalizeQuote(chart(),new Date('2026-12-02T22:00Z')));
  const p=chart();p.chart.result[0].meta.currency='CNY';assert.throws(()=>normalizeQuote(p));
});
test('November 09:10 KST is still afterhours; at 10 KST session ended',()=>{
  const p=chart();p.chart.result[0].timestamp=[Date.parse('2026-11-02T21:01Z')/1000,Date.parse('2026-11-02T23:30Z')/1000];
  assert.equal(extended(p,new Date('2026-11-03T00:10Z')).completed,false);
  assert.equal(extended(p,new Date('2026-11-03T01:00Z')).completed,true);
  assert.equal(extended(p,new Date('2026-11-03T00:10Z')).first.time,'2026-11-02T21:01:00.000Z');
});
test('event samples survive after API rolling intraday window moves on',()=>{
  const old={afterhours:{last:{price:150,time:'2026-11-02T23:59Z'}}};
  assert.equal(eventSnapshot({event:{dateNY:'2026-11-02'}},null,null,old,new Date()).afterhours.last.price,150);
});
test('earnings afterhours can be refreshed to final sample on later daily run',()=>{
  const p=chart();p.chart.result[0].timestamp=['2026-11-02T21:01Z','2026-11-03T00:59Z','2026-11-03T22:00Z'].map(x=>Date.parse(x)/1000);
  p.chart.result[0].indicators.quote[0].close=[100,110,120];
  const e=extended(p,new Date('2026-11-04T00:10Z'),'2026-11-02');
  assert.equal(e.last.price,110);assert.equal(e.completed,true);
});
const series=(type,dates,values)=>({meta:{type:[type]},[type]:dates.map((date,i)=>({asOfDate:date,currencyCode:'USD',periodType:'3M',reportedValue:{raw:values[i]}}))});
test('TTM requires four continuous quarters, missing quarter is never added as annual total',()=>{
  const dates=['2025-06-30','2025-09-30','2025-12-31','2026-03-31','2026-06-30'];
  const p={timeseries:{result:[series('quarterlyTotalRevenue',dates,[10,12,14,16,20]),series('quarterlyOperatingIncome',dates,[1,2,2,3,4]),series('quarterlyCapitalExpenditure',dates,[-1,-1,-1,-1,-1]),series('quarterlyOperatingCashFlow',dates,[2,2,2,2,3])]}};
  const f=financials(p);assert.equal(f.ttmRevenue,62);assert.equal(f.revenueYoY,1);assert.equal(f.fcfProxy,2);
  p.timeseries.result[0].quarterlyTotalRevenue.splice(2,1);assert.equal(financials(p).ttmRevenue,null);
});
