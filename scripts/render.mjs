import fs from 'node:fs/promises';
const config=JSON.parse(await fs.readFile('config/watchlist.json','utf8')),data=JSON.parse(await fs.readFile('data/latest.json','utf8'));
const esc=s=>String(s??'확인 못 함').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const num=(n,d=2)=>Number.isFinite(n)?n.toLocaleString('en-US',{maximumFractionDigits:d}):'확인 못 함';
const pct=n=>Number.isFinite(n)?num(n*100,1)+'%':'확인 못 함';
const usd=n=>Number.isFinite(n)?'$'+num(n/1e6,1)+'M':'확인 못 함';
const link=(url,label)=>`[${label}](${url})`;
const kst=new Date(data.checkedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false});
const lines=['# 관심종목 Watch-list','',`[사실] 마지막 자동 확인: **${kst} KST** · 수집 상태: **${data.health.status}**.`,
  '', '## 먼저 보는 결론', '',
  `[의견] **FN 우선 조사 · ACMR 조건부 조사 · BWXT 가격 대비 중기 성장 재확인**이 ${config.reviewedAt} 조사 당시의 결론입니다. 자동 갱신은 새 투자 의견을 작성하지 않습니다.`,
  '', '[사실] 매일 **한국 오전 9:10**에 GitHub Actions가 실행됩니다. PC를 켜 둘 필요가 없습니다. 주말에도 확인하며 정규장 휴장일에는 직전 종가를 표시합니다. GitHub 사정에 따라 실행이 늦어질 수 있습니다.',
  '', '[사실] 가격·분기 재무는 Yahoo Finance 공개 자료(2차 자료), 최근 공시 목록은 SEC 원문으로 확인합니다. 실패한 조회는 이전 값을 유지하고 stale로 표시합니다. API 반영 지연이 있으며 실적 발표 순간을 보장하지 않습니다.',
  '', '[추정] 역산은 주가 수익률 연 10%, 10년, 말기 PER 20배, 회사별 순이익률과 연 희석 0%/3% 가정입니다. 최근 한 분기 성장률이 10년간 유지된다는 뜻은 아닙니다. 배당·세금·환율은 제외합니다.',
  '', '[사실] '+link('https://github.com/victoryjoony/Watch-list/actions','실행 내역')+' · '+link('docs/index.html','HTML 원본')+' · '+link('reports/fn-entry-timing-2026-10-24.html','FN 기존 타이밍 보고서(2026-10-24)')+' · '+link('reports/growth-research-2026-10-24.html','기존 심층 보고서(2026-10-24)'),
  '', '## 일일 비교', '',
  '| 종목 | [사실] 정규장 종가 / 기준일 | [사실] 최근 분기 매출 성장 / 기간 | [추정] 요구 성장 0% / 3% 희석 | 모형 입력 |',
  '|---|---|---|---|---|'];
for(const c of config.stocks){
  const s=data.stocks[c.ticker],v=s.valuation,f=s.financials,q=s.quote;
  lines.push(`| ${c.ticker} | $${num(q.close)} / ${q.date||'확인 못 함'} (${q.status}) | ${pct(f.revenueYoY)} / ${f.period||'확인 못 함'} (${f.status}) | ${pct(v.required?.[0]?.growth)} / ${pct(v.required?.[1]?.growth)} | ${v.status} |`);
}
for(const c of config.stocks){
  const s=data.stocks[c.ticker],f=s.financials,q=s.quote,v=s.valuation,a=s.afterhours;
  lines.push('',`## ${c.ticker} · ${c.name}`, '',`[의견] **${c.conclusion}** (판단 기준 ${config.reviewedAt}).`, '',`[의견] 계속 확인할 외부·사업 요인: ${c.risks}.`, '',
    `[사실] 종가 $${num(q.close)} · 전일 대비 ${Number.isFinite(q.changePct)?num(q.changePct,2)+'%':'확인 못 함'} · 미국 거래일 ${q.date||'확인 못 함'} · ${q.status} · ${link(q.sourceUrl||`https://finance.yahoo.com/quote/${c.ticker}/history/`,'가격 출처')}.`, '',
    `[사실] 최근 분기(${f.period||'확인 못 함'}) 매출 ${usd(f.revenue)} · 전년 동기 대비 ${pct(f.revenueYoY)} · 영업이익률 ${pct(f.operatingMargin)} · OCF−설비투자 ${usd(f.fcfProxy)} · ${f.status} · ${link(f.sourceUrl||`https://finance.yahoo.com/quote/${c.ticker}/financials/`,'재무 출처')}.`, '',
    `[추정] ${v.method||v.reason} · 입력 재무 기준일 ${v.inputPeriod||'확인 못 함'} · 가격 기준일 ${v.priceDate||'확인 못 함'} · 시총 근사 ${usd(v.marketCap)} · TTM 매출 ${usd(v.ttmRevenue)} · P/S ${num(v.ps)}배.`, '',
    `[추정] 말기 순이익률 ${pct(c.margin)}: 요구 매출 CAGR ${pct(v.required?.[0]?.growth)}(희석 0%) / ${pct(v.required?.[1]?.growth)}(희석 3%). ${link(c.modelSource,'최초 이익률 검토 자료')} · 가정 검토일 ${config.reviewedAt}.`, '',
    `[추정] 희석 3%에서 순이익률 ${pct(c.marginRange[0])}~${pct(c.marginRange[1])}를 적용한 요구 성장 범위: ${pct(v.sensitivity?.[1]?.growth)}~${pct(v.sensitivity?.[0]?.growth)}.`, '',
    `[사실] 최신 장외 표본: ${a.last?'$'+num(a.last.price)+' · '+a.last.time+' (UTC) · 미국일 '+a.last.date+' · '+(a.completed?'해당 장외 세션 종료 시각 경과':'장외 진행 중일 수 있음'):'확인 못 함'} · 상태 ${a.status} · ${link(a.sourceUrl||`https://finance.yahoo.com/quote/${c.ticker}/`,'시세 출처')}.`, '',
    '[사실] 장외 값은 1분봉 표본으로, 첫 체결가나 실적 공개 순간 가격을 뜻하지 않습니다.', '',
    ...s.flags.map(x=>'- '+x), '',
    '[사실] '+link(c.primary,'최초 조사 SEC 원문')+' · '+link(c.ir,'회사 IR 공지')+'. 경영진 개인 이슈·소송·규제 변경의 전수 감시나 공시 내용의 자동 해석은 포함되지 않습니다.', '',
    '[사실] 최근 SEC 공시 목록 ('+(s.filings.status||'확인 못 함')+', 조회 '+(s.filings.fetchedAt||'확인 못 함')+'):', '',
    ...(s.filings.entries?.slice(0,6).map(x=>'- [사실] '+link(x.url,`${x.date} ${x.form}${x.items?' · 항목 '+x.items:''}`))||['- [사실] 확인 못 함.'])
  );
  if(s.errors.length)lines.push('',...s.errors.map(x=>'- [사실] 수집 경고: '+x));
  if(s.event){
    const e=s.event;
    lines.push('', '### FN 실적 발표 추적', '',`[사실] ${e.dateNY} 미국일 ${e.label} · ${link(e.source,'회사 일정 출처')}.`, '',
      `[사실] 발표 전 거래일(${c.event.previousSession}) 종가: ${e.previous?'$'+num(e.previous.close):'아직 미수집'}.`, '',
      `[사실] 발표일(${e.dateNY}) 정규장 O/H/L/C: ${e.regular?[e.regular.open,e.regular.high,e.regular.low,e.regular.close].map(n=>'$'+num(n)).join(' / '):'아직 미수집'}.`, '',
      `[사실] 발표일 장외 첫 가용 표본: ${e.afterhours?.first?'$'+num(e.afterhours.first.price)+' · '+e.afterhours.first.time+' UTC':'아직 미수집'}; 최신 가용 표본: ${e.afterhours?.last?'$'+num(e.afterhours.last.price)+' · '+e.afterhours.last.time+' UTC':'아직 미수집'}.`, '',
      '[사실] 당일 장 마감 후 공시·실적 수치가 공급자에 반영되기까지 지연될 수 있습니다. [의견] 공급자 새 분기 수치와 원문을 대조한 후 기존 가정을 재검토해야 합니다.');
  }
}
lines.push('', '## 운영·한계', '',
  '[사실] 자동 확인 시각과 가격 거래일·재무 기간은 서로 다릅니다. Yahoo의 분기 말 날짜는 회사의 실제 회계 마감일과 며칠 다를 수 있습니다. 시총은 분기 말 보통주 수를 이용한 근사이며 실시간 시총이 아닙니다. 최신 재무가 없으면 최초 조사 시총에 가격만 반영한 근사라고 표시합니다.', '',
  '[사실] GitHub 공개 저장소 예약 실행은 장기간 저장소 활동이 없으면 중지될 수 있습니다. 실패·중지 여부는 Actions에서 확인할 수 있습니다. 이 저장소는 별도의 앱 예약·푸시 알림을 만들지 않습니다.', '',
  '[의견] 자동 결과는 조사할 사항을 정리하는 도구입니다. 저평가 확정이나 신규 진입·매수·매도 지시로 해석하지 않습니다.', '',
  '[사실] 설정은 config/watchlist.json, 원시 수집값·최근 일별 기록은 data/latest.json에 저장합니다. 과거 보고서는 작성 당시 상태로 보존됩니다.');
const md=lines.join('\n')+'\n';await fs.writeFile('README.md',md);
// Render the same text as a self-contained, script-free mobile HTML page.
function inline(s){return esc(s).replace(/\[([^\]]+)\]\(([^)]+)\)/g,(_,label,url)=>`<a href="${url.startsWith('http')?url:'../'+url}">${label}</a>`).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');}
let html='',table=false;
for(const l of lines){
  if(l.startsWith('|')){
    if(l.startsWith('|---'))continue;
    if(!table){html+='<div class="scroll"><table>';table=true;}
    html+='<tr>'+l.slice(1,-1).split('|').map(x=>'<td>'+inline(x.trim())+'</td>').join('')+'</tr>';continue;
  }
  if(table){html+='</table></div>';table=false;}
  if(l.startsWith('### '))html+='<h3>'+inline(l.slice(4))+'</h3>';
  else if(l.startsWith('## '))html+='<h2>'+inline(l.slice(3))+'</h2>';
  else if(l.startsWith('# '))html+='<h1>'+inline(l.slice(2))+'</h1>';
  else if(l.startsWith('- '))html+='<p class="bullet">• '+inline(l.slice(2))+'</p>';
  else if(l)html+='<p>'+inline(l)+'</p>';
}
await fs.mkdir('docs',{recursive:true});await fs.writeFile('docs/index.html',`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>관심종목 Watch-list</title><style>body{margin:0;background:#f3f5fa;color:#17243a;font:16px/1.8 system-ui,sans-serif}main{max-width:1050px;margin:auto;padding:32px 22px 100px}h1{font-size:36px}h2{margin-top:48px;border-top:1px solid #cbd5e1;padding-top:24px}h2:first-of-type{background:#dcece4;padding:24px;border-radius:16px}h3{margin-top:32px}a{color:#075db4}p{overflow-wrap:anywhere}.scroll{overflow:auto;background:white;border-radius:12px}table{border-collapse:collapse;width:100%;min-width:760px;font-size:14px}td{padding:16px;border-bottom:1px solid #dce1ea}tr:first-child{font-weight:700;background:#dce5f4}.bullet{padding-left:12px}strong{color:#102c56}</style><main>${html}</main></html>`);
console.log('Rendered README.md and docs/index.html');
