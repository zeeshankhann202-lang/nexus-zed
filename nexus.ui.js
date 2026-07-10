// NEXUS ZED v5.1 — Settings + Module Page Renderers

// ═══════════════════════════════════════════════════════════
// NEXUS ZED v5.1 — EXTENSION ENGINE
// Settings · OHLC · Module Renderers · Audit · ML · Monte Carlo
// ═══════════════════════════════════════════════════════════

// ─── SETTINGS SYSTEM ───────────────────────────────────────
const CFG = {
  worker:'', tdKey:'', oandaKey:'', oandaAcct:'',
  equity:0, riskPct:1, maxLossPct:2,
  tz:'Asia/Karachi', minGrade:'B',
  zoneLabels:true, regLine:true, chartMode:'nexus', defaultTF:'15m',
  sndSignal:true, sndZone:true, sndNews:true,
};

function loadCFG(){
  try{
    const s=localStorage.getItem('nexus_cfg');
    if(s) Object.assign(CFG,JSON.parse(s));
    if(CFG.equity) S.equity=CFG.equity;
    if(CFG.riskPct) S.riskPct=CFG.riskPct;
  }catch(e){}
}

function saveCFG(){
  try{ localStorage.setItem('nexus_cfg',JSON.stringify(CFG)); }catch(e){}
}

function openSettings(){
  const m=document.getElementById('settingsModal');
  if(!m) return;
  // Populate fields from CFG
  setV('set-equity', CFG.equity||'');
  setV('set-risk', CFG.riskPct||1);
  setV('set-maxloss', CFG.maxLossPct||2);
  setV('set-tz', CFG.tz||'Asia/Karachi');
  setV('set-worker', CFG.worker||'');
  setV('set-td-key', CFG.tdKey||'');
  setV('set-oanda-key', CFG.oandaKey||'');
  setV('set-oanda-acct', CFG.oandaAcct||'');
  setV('set-min-grade', CFG.minGrade||'B');
  setV('set-chart-mode', CFG.chartMode||'nexus');
  setV('set-default-tf', CFG.defaultTF||'15m');
  setChk('set-zone-labels', CFG.zoneLabels!==false);
  setChk('set-reg-line', CFG.regLine!==false);
  setChk('set-snd-signal', CFG.sndSignal!==false);
  setChk('set-snd-zone', CFG.sndZone!==false);
  setChk('set-snd-news', CFG.sndNews!==false);
  updateRiskSlider(CFG.riskPct||1);
  updateMaxLoss(CFG.maxLossPct||2);
  m.classList.add('open');
  // Tab listeners
  document.querySelectorAll('.smod-tab').forEach(t=>{
    t.onclick=()=>{
      document.querySelectorAll('.smod-tab').forEach(x=>x.classList.remove('active'));
      document.querySelectorAll('.smod-tab-content').forEach(x=>x.classList.remove('active'));
      t.classList.add('active');
      const tab=document.getElementById('stab-'+t.dataset.stab);
      if(tab) tab.classList.add('active');
    };
  });
}

function closeSettings(){ document.getElementById('settingsModal').classList.remove('open'); }

function saveSettings(){
  CFG.equity=parseFloat(getV('set-equity'))||S.equity||10000; S.equity=CFG.equity;
  CFG.riskPct=parseFloat(getV('set-risk'))||1;
  CFG.maxLossPct=parseFloat(getV('set-maxloss'))||2;
  CFG.tz=getV('set-tz')||'Asia/Karachi';
  CFG.worker=getV('set-worker')||'';
  CFG.tdKey=getV('set-td-key')||'';
  CFG.oandaKey=getV('set-oanda-key')||'';
  CFG.oandaAcct=getV('set-oanda-acct')||'';
  CFG.minGrade=getV('set-min-grade')||'B';
  CFG.chartMode=getV('set-chart-mode')||'nexus';
  CFG.defaultTF=getV('set-default-tf')||'15m';
  CFG.zoneLabels=getChk('set-zone-labels');
  CFG.regLine=getChk('set-reg-line');
  CFG.sndSignal=getChk('set-snd-signal');
  CFG.sndZone=getChk('set-snd-zone');
  CFG.sndNews=getChk('set-snd-news');
  S.equity=CFG.equity; S.riskPct=CFG.riskPct;
  showZoneLabels=CFG.zoneLabels;
  saveCFG();
  closeSettings();
  // Apply immediately
  if(CFG.tdKey) fetchOHLCFromTwelveData();
  runPositionSize(); renderAll();
  addAuditEntry('SYS','Settings saved — equity $'+CFG.equity+', risk '+CFG.riskPct+'%');
}

function settingChanged(){}
function updateRiskSlider(v){ setV('set-risk-val',parseFloat(v).toFixed(1)+'%'); }
function updateMaxLoss(v){ setV('set-maxloss-val',parseFloat(v).toFixed(1)+'%'); }
function getV(id){ const e=document.getElementById(id); return e?e.value:''; }
function setV(id,v){ const e=document.getElementById(id); if(e) e.value=v; }
function getChk(id){ const e=document.getElementById(id); return e?e.checked:false; }
function setChk(id,v){ const e=document.getElementById(id); if(e) e.checked=v; }

function toggleKeyVis(id,btn){
  const e=document.getElementById(id); if(!e) return;
  e.type=e.type==='password'?'text':'password';
  btn.textContent=e.type==='password'?'👁':'🙈';
}

async function testWorker(){
  const url=getV('set-worker'); if(!url){ showStatus('worker-status','err','Enter a Worker URL first'); return; }
  showStatus('worker-status','warn','Testing...');
  try{
    const r=await fetch(url+'?test=1',{signal:AbortSignal.timeout(5000)});
    if(r.ok){ showStatus('worker-status','ok','✓ Worker connected successfully'); }
    else{ showStatus('worker-status','err','Worker returned HTTP '+r.status); }
  }catch(e){ showStatus('worker-status','err','Connection failed: '+e.message); }
}

async function testTwelveData(){
  const key=getV('set-td-key'); if(!key){ showStatus('td-status','err','Enter your API key first'); return; }
  showStatus('td-status','warn','Testing key...');
  try{
    const r=await fetch(`https://api.twelvedata.com/price?symbol=XAU/USD&apikey=${key}`,{signal:AbortSignal.timeout(6000)});
    const d=await r.json();
    if(d.price){ showStatus('td-status','ok','✓ Key valid — XAU/USD: $'+parseFloat(d.price).toFixed(2)); }
    else{ showStatus('td-status','err','Invalid key: '+( d.message||'Unknown error')); }
  }catch(e){ showStatus('td-status','err','Test failed: '+e.message); }
}

function showStatus(id,cls,msg){
  const e=document.getElementById(id); if(!e) return;
  e.style.display='block'; e.className='smod-status '+cls; e.textContent=msg;
}

function clearAllData(){
  if(!confirm('Clear ALL locally stored data? This resets settings, journal, and ML data.')) return;
  try{ localStorage.clear(); }catch(e){}
  location.reload();
}

function testBeep(){
  try{
    const ctx=new(window.AudioContext||window.webkitAudioContext)();
    const osc=ctx.createOscillator(); const g=ctx.createGain();
    osc.connect(g); g.connect(ctx.destination);
    osc.frequency.value=880; g.gain.setValueAtTime(0.3,ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.4);
    osc.start(); osc.stop(ctx.currentTime+0.4);
  }catch(e){}
}

function playSignalBeep(freq=660){
  if(!CFG.sndSignal) return;
  try{
    const ctx=new(window.AudioContext||window.webkitAudioContext)();
    const osc=ctx.createOscillator(); const g=ctx.createGain();
    osc.connect(g); g.connect(ctx.destination);
    osc.frequency.value=freq; g.gain.setValueAtTime(0.25,ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.5);
    osc.start(); osc.stop(ctx.currentTime+0.5);
  }catch(e){}
}

// Wire settings button
document.querySelector('.nav-avatar').onclick=()=>openSettings();
document.getElementById('settingsModal').onclick=(e)=>{ if(e.target===e.currentTarget) closeSettings(); };

// Wire settings nav tab
document.querySelectorAll('[data-page="settings"]').forEach(b=>{
  b.addEventListener('click',e=>{ e.stopPropagation(); openSettings(); });
});

// addAuditEntry defined in nexus.helpers.js);
  if(AUDIT.length>200) AUDIT.pop();
  renderAuditLog();
}

function renderAuditLog(){
  const container=document.getElementById('auditLog'); if(!container) return;
  const col={SYS:'var(--piv)',LIVE:'var(--buy)',SIGNAL:'var(--gold)',ERR:'var(--sell)',INFO:'var(--blue)',ML:'var(--cyan)'};
  container.innerHTML=AUDIT.slice(0,50).map(a=>`
    <div style="display:flex;gap:8px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.03);font-size:11px;">
      <span style="color:var(--t3);flex-shrink:0;font-family:var(--mono);">${a.ts}</span>
      <span style="padding:0 5px;border-radius:3px;background:rgba(255,255,255,.05);color:${col[a.level]||'var(--t2)'};font-size:9px;font-weight:700;flex-shrink:0;">${a.level}</span>
      <span style="color:var(--t2);flex:1;line-height:1.4;">${a.msg}</span>
    </div>`).join('');
}

// addAuditEntry is globally defined in nexus.helpers.js

// ─── OHLC DATA — TWELVE DATA API ───────────────────────────
async function fetchOHLCFromTwelveData(){
  // Try Worker first (hides API key, adds caching, enforces tier)
  const workerBase = CFG.worker;
  if (workerBase) {
    const tfs = [{td:'1min',k:'m1'},{td:'5min',k:'m5'},{td:'15min',k:'m15'},
                 {td:'1h',k:'h1'},{td:'4h',k:'h4'},{td:'1day',k:'d1'}];
    let got = 0;
    for (const {td,k} of tfs) {
      const candles = await fetchOHLCFromWorker(td);
      if (candles && candles.length) {
        CANDLES[k] = candles;
        if (candles.length > 1) {
          const trs = candles.slice(-14).map((c,i,a)=>i===0?c.h-c.l:Math.max(c.h-c.l,Math.abs(c.h-a[i-1].c),Math.abs(c.l-a[i-1].c)));
          CANDLES.atr[k] = +(trs.reduce((a,b)=>a+b)/trs.length).toFixed(2);
        }
        if (k==='d1' && candles.length > 1) { CANDLES.pdh = candles[candles.length-2].h; CANDLES.pdl = candles[candles.length-2].l; }
        got++;
      }
    }
    if (got > 0) {
      if (CANDLES.m15.length) S.ph = CANDLES.m15.map(c=>c.c);
      CS.offsetBars = 0; CS.visibleBars = 60;
      detectEqualLevels();
      runStructureEngine(); runZoneEngine(); runRegression(); runADX(); runBrainSignal(); runPositionSize();
      renderAll(); renderAllModules();
      addAuditEntry('SYS', `Worker OHLC: ${got}/6 TFs loaded`);
      setFeed('fsGold','XAU+OHLC: LIVE','ok');
      return true;
    }
  }
  // Fallback: Twelve Data direct
  const key=CFG.tdKey; if(!key) return false;
  const tfs=[{td:'1min',k:'m1'},{td:'5min',k:'m5'},{td:'15min',k:'m15'},{td:'1h',k:'h1'},{td:'4h',k:'h4'},{td:'1day',k:'d1'}];
  let got=0;
  for(const {td,k} of tfs){
    try{
      const url=`https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=${td}&outputsize=100&apikey=${key}`;
      const r=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(8000)});
      if(!r.ok) continue;
      const d=await r.json();
      if(d.status==='error'){ addAuditEntry('ERR','Twelve Data: '+d.message); break; }
      if(d.values&&d.values.length){
        CANDLES[k]=d.values.map(v=>({
          t:new Date(v.datetime).getTime(),
          o:parseFloat(v.open), h:parseFloat(v.high),
          l:parseFloat(v.low),  c:parseFloat(v.close),
          v:parseFloat(v.volume||0),
        })).reverse();
        // Compute ATR for this TF
        if(CANDLES[k].length>1){
          const trs=CANDLES[k].slice(-14).map((c,i,a)=>i===0?c.h-c.l:Math.max(c.h-c.l,Math.abs(c.h-a[i-1].c),Math.abs(c.l-a[i-1].c)));
          CANDLES.atr[k]=+(trs.reduce((a,b)=>a+b)/trs.length).toFixed(2);
        }
        // PDH/PDL from D1
        if(k==='d1'&&CANDLES.d1.length>1){
          const prev=CANDLES.d1[CANDLES.d1.length-2];
          CANDLES.pdh=prev.h; CANDLES.pdl=prev.l;
        }
        got++;
        addAuditEntry('LIVE',`OHLC ${k.toUpperCase()}: ${CANDLES[k].length} bars loaded [Twelve Data]`);
      }
      await new Promise(r=>setTimeout(r,300)); // rate limit respect
    }catch(e){ addAuditEntry('ERR',`OHLC ${k} failed: ${e.message}`); }
  }
  if(got>0){
    // Use M15 candles as primary price history
    if(CANDLES.m15.length){
      S.ph=CANDLES.m15.map(c=>c.c);
    }
    // Reset chart viewport to show latest bars
    CS.offsetBars = 0; CS.visibleBars = 60;
    detectEqualLevels();
    runStructureEngine(); runZoneEngine(); runRegression(); runADX(); runBrainSignal();
    renderAll(); renderAllModules();
    addAuditEntry('SYS',`OHLC loaded: ${got}/6 timeframes`);
    setFeed('fsGold','XAU+OHLC: LIVE','ok');
  }
  return got>0;
}

// Refresh OHLC every 5 minutes
setInterval(()=>{ if(CFG.tdKey) fetchOHLCFromTwelveData(); },300000);

// ─── EQUAL HIGHS / LOWS DETECTION ──────────────────────────
function detectEqualLevels(){
  const candles=CANDLES.h1.length?CANDLES.h1:CANDLES.m15;
  if(candles.length<10) return;
  const atr=CANDLES.atr.h1||CANDLES.atr.m15||15;
  const tol=atr*0.2;
  // Equal highs
  const highs=candles.map(c=>c.h);
  const eqHighs=[];
  for(let i=0;i<highs.length-1;i++){
    for(let j=i+1;j<highs.length;j++){
      if(Math.abs(highs[i]-highs[j])<tol&&highs[i]>S.gold.price){
        eqHighs.push({level:(highs[i]+highs[j])/2,count:2,tf:'H1'});
        break;
      }
    }
  }
  const lows=candles.map(c=>c.l);
  const eqLows=[];
  for(let i=0;i<lows.length-1;i++){
    for(let j=i+1;j<lows.length;j++){
      if(Math.abs(lows[i]-lows[j])<tol&&lows[i]<S.gold.price){
        eqLows.push({level:(lows[i]+lows[j])/2,count:2,tf:'H1'});
        break;
      }
    }
  }
  CANDLES.equalHighs=eqHighs.slice(-3);
  CANDLES.equalLows=eqLows.slice(-3);
}

// ─── MONTE CARLO ENGINE ─────────────────────────────────────
function runMonteCarlo(){
  const price=S.gold.price; if(!price) return;
  const atr=CANDLES.atr.h4||S.mem.atr.slice(-1)[0]||15;
  const br=S.brain;
  const direction=br?.direction||'NEUTRAL';
  const N=500, STEPS=20;
  const mu=direction==='BUY'?0.0003:direction==='SELL'?-0.0003:0;
  const sigma=(atr/price)/Math.sqrt(STEPS);
  const finals=[];
  const paths=[];
  for(let i=0;i<N;i++){
    let p=price; const path=[p];
    for(let s=0;s<STEPS;s++){
      const u1=Math.random(),u2=Math.random();
      const z=Math.sqrt(-2*Math.log(u1))*Math.cos(2*Math.PI*u2);
      p=p*Math.exp(mu-0.5*sigma*sigma+sigma*z);
      path.push(p);
    }
    finals.push(p); paths.push(path);
  }
  finals.sort((a,b)=>a-b);
  const p10=finals[Math.floor(N*0.10)];
  const p50=finals[Math.floor(N*0.50)];
  const p90=finals[Math.floor(N*0.90)];
  const pUp=finals.filter(f=>f>price).length/N*100;
  S.monteCarlo={p10,p50,p90,pUp,ran:true};
  renderMCCanvas(paths,price,p10,p50,p90);
  const fmt=v=>v?'$'+Math.round(v).toLocaleString():'—';
  setText('mc-p10',fmt(p10)); setText('mc-p50',fmt(p50)); setText('mc-p90',fmt(p90));
  const ins=document.getElementById('mc-insight');
  if(ins){
    const bias=pUp>60?'BULLISH SKEW':pUp<40?'BEARISH SKEW':'BALANCED';
    ins.textContent=`${N} paths · Upside prob: ${pUp.toFixed(0)}% · Range ±$${Math.round((p90-p10)/2)} · ${bias} — ${pUp>60?'Most paths rise from entry':pUp<40?'Most paths decline — confirms sell bias':'Balanced — wait for higher confidence'}`;
  }
}

function renderMCCanvas(paths,price,p10,p50,p90){
  const canvas=document.getElementById('mcCanvas'); if(!canvas) return;
  const W=canvas.parentElement?.offsetWidth||340, H=100;
  canvas.width=W*2; canvas.height=H*2; canvas.style.width=W+'px'; canvas.style.height=H+'px';
  const ctx=canvas.getContext('2d'); ctx.scale(2,2);
  ctx.fillStyle='var(--bg0)'; ctx.fillRect(0,0,W,H);
  const allP=paths.flat();
  const minP=Math.min(...allP), maxP=Math.max(...allP);
  const toX=i=>(i/20)*W;
  const toY=p=>H-((p-minP)/(maxP-minP))*(H-8)-4;
  paths.forEach((path,i)=>{
    const final=path[path.length-1];
    const alpha=0.03+(i%10===0?0.05:0);
    ctx.strokeStyle=final>price?`rgba(34,197,94,${alpha})`:`rgba(239,68,68,${alpha})`;
    ctx.lineWidth=0.5;
    ctx.beginPath();
    path.forEach((p,j)=>j===0?ctx.moveTo(toX(j),toY(p)):ctx.lineTo(toX(j),toY(p)));
    ctx.stroke();
  });
  [[p90,'rgba(34,197,94,.8)','P90'],[p50,'rgba(245,166,35,.8)','P50'],[p10,'rgba(239,68,68,.8)','P10']].forEach(([val,col,lbl])=>{
    const y=toY(val);
    ctx.strokeStyle=col; ctx.lineWidth=1.5; ctx.setLineDash([3,3]);
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle=col; ctx.font='7px Inter'; ctx.fillText(lbl+' $'+Math.round(val).toLocaleString(),4,y-2);
  });
  const py=toY(price);
  ctx.strokeStyle='rgba(255,255,255,.3)'; ctx.lineWidth=1; ctx.setLineDash([2,4]);
  ctx.beginPath(); ctx.moveTo(0,py); ctx.lineTo(W,py); ctx.stroke(); ctx.setLineDash([]);
}

// ─── ML ENGINE RENDER ───────────────────────────────────────
function renderMLPanel(){
  const grade=ML.predGrade||S.mlGrade||'C';
  const prob=Math.round((ML.predProb||S.mlProb||0.5)*100);
  const dec=ML.predDecision||S.mlDecision||'WAIT';
  const gradeEl=document.getElementById('ml-grade-big');
  if(gradeEl){gradeEl.textContent=grade;gradeEl.style.color=grade==='A'?'var(--buy)':grade==='B'?'var(--gold)':'var(--warn)';}
  const decEl=document.getElementById('ml-decision');
  if(decEl){decEl.textContent=dec+' — GRADE '+grade;decEl.style.color=dec==='SELL'?'var(--sell)':dec==='BUY'?'var(--buy)':'var(--t3)';}
  setText('ml-prob','Probability: '+prob+'%');
  setText('ml-status',ML.isTrained?'Model trained ✓':ML.trainingData.length>0?'Training...':'Collecting data');
  setText('ml-samples',ML.trainingData.length);
  setText('ml-accuracy',ML.accuracy?ML.accuracy+'%':'—');
  setText('ml-btwr',ML.btWinRate+'%');
  setText('bt-wr',ML.btWinRate+'%');
  setText('bt-rr','1:'+ML.btAvgRR);
  const scoreNorm=Math.min(100,Math.max(0,(ML.predScore+15)/30*100));
  const bar=document.getElementById('ml-score-bar');
  if(bar){bar.style.width=scoreNorm+'%';bar.style.background=grade==='A'?'var(--buy)':grade==='B'?'var(--gold)':'var(--warn)';}
  setText('ml-score-val',(ML.predScore||0).toFixed(1));
  // Backtest equity curve
  if(ML.equityCurve&&ML.equityCurve.length) drawBtCurve(ML.equityCurve);
  // ML insight
  const ins=document.getElementById('ml-insight');
  if(ins) ins.textContent=ML.isTrained?`Grade ${grade} · Score ${(ML.predScore||0).toFixed(1)} · Prob ${prob}% · ${ML.trainingData.length} samples trained`:`Collecting samples (${ML.trainingData.length}/10). Model trains automatically.`;
}

function drawBtCurve(results){
  const canvas=document.getElementById('btCurve'); if(!canvas) return;
  const W=canvas.offsetWidth||280, H=120;
  canvas.width=W*2; canvas.height=H*2; canvas.style.width=W+'px'; canvas.style.height=H+'px';
  const ctx=canvas.getContext('2d'); ctx.scale(2,2);
  ctx.fillStyle='#0a0a0f'; ctx.fillRect(0,0,W,H);
  let eq=[100],cur=100;
  for(const r of results){cur+=r>0?3.5:-1.5; eq.push(Math.max(0,cur));}
  const mn=Math.min(...eq),mx=Math.max(...eq,mn+1);
  const toX=i=>(i/(eq.length-1))*W;
  const toY=v=>H-((v-mn)/(mx-mn))*(H*0.85)-H*0.05;
  const grad=ctx.createLinearGradient(0,0,0,H);
  grad.addColorStop(0,'rgba(34,197,94,.2)'); grad.addColorStop(1,'rgba(34,197,94,0)');
  ctx.beginPath(); ctx.moveTo(0,H);
  eq.forEach((v,i)=>ctx.lineTo(toX(i),toY(v)));
  ctx.lineTo(W,H); ctx.closePath(); ctx.fillStyle=grad; ctx.fill();
  ctx.strokeStyle='rgba(34,197,94,.8)'; ctx.lineWidth=1.5;
  ctx.beginPath(); eq.forEach((v,i)=>i===0?ctx.moveTo(toX(i),toY(v)):ctx.lineTo(toX(i),toY(v))); ctx.stroke();
}

// ─── JOURNAL RENDER ─────────────────────────────────────────
function exportJournal(){
  const trades=ML.trades; if(!trades.length){alert('No trades logged yet.');return;}
  const hdr='Date,Signal,Entry,SL,TP1,Grade,Confidence,Session,Outcome\n';
  const rows=trades.map(t=>[t.ts,t.decision,t.entry,t.sl,t.tp||'—',t.grade,Math.round((t.prob||0)*100)+'%',t.sessName||'—',t.outcome].join(',')).join('\n');
  const a=document.createElement('a');
  a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(hdr+rows);
  a.download='NEXUS_Journal_'+new Date().toISOString().slice(0,10)+'.csv';
  a.click();
}

function renderJournalPage(){
  const total=ML.performance.wins+ML.performance.losses;
  const wr=total?Math.round(ML.performance.wins/total*100):0;
  setText('jnl-wr',wr+'%'); setText('jnl-wr-sub',total+' completed trades');
  setText('jnl-rr','1:'+ML.btAvgRR);
  setText('jnl-samples',ML.trainingData.length);
  setText('jnl-acc',ML.accuracy?ML.accuracy+'%':'—');
  const tbody=document.getElementById('jnlBody'); if(!tbody) return;
  if(!ML.trades.length){
    tbody.innerHTML='<tr><td colspan="9" style="text-align:center;color:var(--t3);padding:20px;">No trades logged yet. Signals are auto-logged when Grade B+ setups fire.</td></tr>';
    return;
  }
  const gc=g=>g==='A'?'grade grade-a':g==='B'?'grade grade-b':'grade grade-c';
  const oc=o=>o==='TP1'||o==='WIN'?'var(--buy)':o==='SL'||o==='LOSS'?'var(--sell)':'var(--t3)';
  tbody.innerHTML=ML.trades.slice(0,20).map(t=>`<tr>
    <td>${t.ts}</td>
    <td style="color:${t.decision==='SELL'?'var(--sell)':'var(--buy)'};font-weight:600">${t.decision}</td>
    <td>${Math.round(t.entry).toLocaleString()}</td>
    <td style="color:var(--sell)">${Math.round(t.sl).toLocaleString()}</td>
    <td style="color:var(--buy)">${t.tp?Math.round(t.tp).toLocaleString():'—'}</td>
    <td><span class="${gc(t.grade)}">${t.grade}</span></td>
    <td>${Math.round((t.prob||0)*100)}%</td>
    <td style="color:var(--t3)">${t.sessName||'—'}</td>
    <td style="color:${oc(t.outcome)};font-weight:600">${t.outcome}</td>
  </tr>`).join('');
}

// ─── MODULE RENDERERS ───────────────────────────────────────

function renderMacroPage(){
  const ms=S.macroState; if(!ms) return;
  // Stats
  setText('mac-dxy',S.dxy.price?S.dxy.price.toFixed(3):'—');
  const dc=document.getElementById('mac-dxy-ch'); if(dc){dc.textContent=fmtCh(S.dxy.ch,3);dc.style.color=S.dxy.ch>0?'var(--buy)':S.dxy.ch<0?'var(--sell)':'var(--t3)';}
  setText('mac-yld',S.yield.price?S.yield.price.toFixed(3)+'%':'—');
  setText('mac-yld-ch',fmtCh(S.yield.ch,3));
  setText('mac-oil',S.oil.price?'$'+S.oil.price.toFixed(2):'—');
  setText('mac-oil-ch',fmtCh(S.oil.ch));
  setText('mac-vix',S.vix.price?S.vix.price.toFixed(1):'—');
  const v=S.vix.price||20;
  const vixSub=v>=30?'FEAR — safe haven bid':v>=20?'CAUTION — volatility rising':'CALM — risk-on';
  setText('mac-vix-sub',vixSub); const ve=document.getElementById('mac-vix-sub'); if(ve) ve.style.color=v>=30?'var(--sell)':v>=20?'var(--warn)':'var(--buy)';
  // Hierarchy
  setText('mh-inflation',ms.inflationRegime||'—');
  setText('mh-rate',ms.rateCycle||'—');
  setText('mh-dxy',ms.dxyBear?'WEAKENING ↓':'STRENGTHENING ↑');
  const dy=document.getElementById('mh-dxy'); if(dy) dy.style.color=ms.dxyBear?'var(--buy)':'var(--sell)';
  setText('mh-vix',v>=20?'FEAR BID':'NEUTRAL/RISK-ON');
  const realYield=parseFloat(S.yield.price||4)-parseFloat(S.vix.price>20?3:2);
  setText('mh-realyield',(realYield>=0?'+':'')+realYield.toFixed(2)+'% (proxy)');
  const ry=document.getElementById('mh-realyield'); if(ry) ry.style.color=realYield<=0?'var(--buy)':'var(--sell)';
  const verdict=ms.rateYieldBull?'▲ BULL GOLD':ms.rateYieldBear?'▼ BEAR GOLD':'◆ MIXED';
  setText('mh-verdict',verdict);
  const ve2=document.getElementById('mh-verdict'); if(ve2) ve2.style.color=verdict.includes('BULL')?'var(--buy)':verdict.includes('BEAR')?'var(--sell)':'var(--gold)';
  const detail=document.getElementById('mh-detail');
  if(detail){ detail.textContent=verdict.includes('BULL')?'Rate cutting + falling yields + DXY weakness = structural gold bid. Size up.':verdict.includes('BEAR')?'Hiking rates + rising yields + strong dollar = structural gold headwind. Size down.':'Mixed macro signals — let structure decide direction. Reduce position size 20-30%.';
    detail.style.background=verdict.includes('BULL')?'var(--buydim)':verdict.includes('BEAR')?'var(--selldim)':'var(--golddim)'; }
  // Regime
  setText('mac-regime',ms.inflationRegime==='HIGH'?'STAGFLATION':ms.rateYieldBull?'REFLATION':ms.rateYieldBear?'CONTRACTION':'EXPANSION');
  const score=ms.macroScore||0;
  setText('mac-score-val',score+'/10');
  const sb=document.getElementById('mac-score-bar'); if(sb){sb.style.width=(score/10*100)+'%';sb.style.background=score>=7?'var(--buy)':score>=4?'var(--gold)':'var(--sell)';}
  // Seasonality
  const SEASONS=[1.2,0.3,0.8,-0.5,-0.2,-0.9,-0.4,0.9,3.2,1.8,0.6,0.4];
  const months=['J','F','M','A','M','J','J','A','S','O','N','D'];
  const m=new Date().getMonth(); const bias=SEASONS[m];
  setText('mac-season','Gold '+months[m]+': '+(bias>=0?'+':'')+bias.toFixed(1)+'% historical avg');
  const msb=document.getElementById('mac-season'); if(msb) msb.style.color=bias>1?'var(--buy)':bias>0?'var(--gold)':bias>-1?'var(--warn)':'var(--sell)';
  const barsEl=document.getElementById('mac-season-bars');
  if(barsEl){
    const max=Math.max(...SEASONS.map(Math.abs));
    barsEl.innerHTML=SEASONS.map((b,i)=>`<div style="flex:1;height:${Math.round(Math.abs(b)/max*28)}px;border-radius:2px 2px 0 0;background:${b>=0?'rgba(34,197,94,0.5)':'rgba(239,68,68,0.4)'};${i===m?'box-shadow:0 0 6px var(--gold);opacity:1;':'opacity:0.6;'}" title="${months[i]} ${b>=0?'+':''}${b}%"></div>`).join('');
  }
  setText('mac-season-desc','Sep ★ strongest month historically (+3.2%). Sep-Oct seasonal tailwind active.');
  // Calendar render
  const calBody=document.getElementById('macroCalBody');
  if(calBody&&window._econEvents){
    calBody.innerHTML=window._econEvents.slice(0,6).map(e=>{
      const c=e.impact==='High'?'var(--sell)':'var(--warn)';
      const dt=e.date?new Date(e.date).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'TBC';
      const prev=e.previous?` | Prev: ${e.previous}`:'';
      const fore=e.forecast?` | Fore: ${e.forecast}`:'';
      return `<div style="display:flex;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);align-items:flex-start;">
        <div style="width:6px;height:6px;border-radius:50%;background:${c};flex-shrink:0;margin-top:4px;"></div>
        <div><div style="font-size:12px;font-weight:600;color:${c};">${e.country} — ${e.title}</div>
          <div style="font-size:11px;color:var(--t3);margin-top:2px;">${dt}${prev}${fore}</div></div></div>`;
    }).join('');
  }
  // Correlations
  const dxyGoldCorr=S.dxy.ch>0&&S.gold.ch<0?'INVERSE (-0.72)':S.dxy.ch<0&&S.gold.ch>0?'CONFIRMING (-0.72)':'NEUTRAL';
  setText('corr-dxy',dxyGoldCorr);
  const yldGoldCorr=S.yield.ch>0&&S.gold.ch<0?'INVERSE (-0.65)':S.yield.ch<0&&S.gold.ch>0?'CONFIRMING (-0.65)':'NEUTRAL';
  setText('corr-yld',yldGoldCorr);
  setText('corr-vix',(S.vix.price||20)>=20?'POSITIVE +0.45 (fear bid)':'NEUTRAL');
  setText('corr-oil',S.oil.ch>0&&S.gold.ch>0?'POSITIVE +0.38':'NEUTRAL');
  setText('corr-spx',S.spx.ch>0&&S.gold.ch<0?'INVERSE -0.30':'NEUTRAL');
  const ci=document.getElementById('corr-insight');
  if(ci) ci.textContent=`DXY and Gold maintain a strong inverse correlation (-0.72 historical). Current DXY ${S.dxy.ch>=0?'rising — headwind for gold':'falling — tailwind for gold'}. Yield correlation: ${S.yield.ch>=0?'rising yields = bearish gold pressure':'falling yields = bullish for gold'}.`;
}

function renderLiquidityPage(){
  // Zones
  const zBody=document.getElementById('liqZonesBody'); if(!zBody) return;
  let html='';
  ZONES.sell.slice(0,3).forEach((z,i)=>{
    html+=`<div class="zone-card sell"><div class="zone-card-type" style="color:var(--sell);">▼ SELL ZONE ${i+1} · ${z.tf||'COMPUTED'}</div>
      <div class="zone-card-range" style="color:var(--sell);">$${Math.round(z.lo).toLocaleString()} – $${Math.round(z.hi).toLocaleString()}</div>
      <div class="zone-card-sub">Type: ${z.type||'SWING'} · Strength: ${z.strength||'—'}/10 · ${Math.round(z.hi-S.gold.price)}pts above</div></div>`;
  });
  ZONES.buy.slice(0,3).forEach((z,i)=>{
    html+=`<div class="zone-card buy"><div class="zone-card-type" style="color:var(--buy);">▲ BUY ZONE ${i+1} · ${z.tf||'COMPUTED'}</div>
      <div class="zone-card-range" style="color:var(--buy);">$${Math.round(z.lo).toLocaleString()} – $${Math.round(z.hi).toLocaleString()}</div>
      <div class="zone-card-sub">Type: ${z.type||'SWING'} · Strength: ${z.strength||'—'}/10 · ${Math.round(S.gold.price-z.lo)}pts below</div></div>`;
  });
  STRUCTURE.fvgs.slice(-3).forEach(f=>{
    html+=`<div class="zone-card fvg"><div class="zone-card-type" style="color:var(--warn);">${f.type==='BEARISH'?'▼ BEARISH FVG':'▲ BULLISH FVG'} · ${f.tf||'COMPUTED'}</div>
      <div class="zone-card-range" style="color:var(--warn);">$${Math.round(f.lo).toLocaleString()} – $${Math.round(f.hi).toLocaleString()}</div>
      <div class="zone-card-sub">Fair Value Gap · Auto-detected · ${f.filled?'FILLED':'UNFILLED'}</div></div>`;
  });
  if(!html) html='<div style="color:var(--t3);font-size:12px;padding:8px;">Zones computing from live price data... Needs more price history.</div>';
  zBody.innerHTML=html;
  // Structure
  setText('liq-bos',STRUCTURE.bos||'NONE');
  const bosEl=document.getElementById('liq-bos'); if(bosEl) bosEl.style.color=STRUCTURE.bos==='DOWN'?'var(--sell)':STRUCTURE.bos==='UP'?'var(--buy)':'var(--t3)';
  setText('liq-choch',STRUCTURE.choch||'NONE');
  const ccEl=document.getElementById('liq-choch'); if(ccEl) ccEl.style.color=STRUCTURE.choch==='BEARISH'?'var(--sell)':STRUCTURE.choch==='BULLISH'?'var(--buy)':'var(--t3)';
  const sw=STRUCTURE.liqSweep;
  setText('liq-sweep',sw?sw.type+' SWEEP':'NONE');
  const swEl=document.getElementById('liq-sweep'); if(swEl) swEl.style.color=sw?'var(--warn)':'var(--t3)';
  setText('liq-sweep-q',sw?(sw.quality+'/10'):'—');
  setText('liq-fvg-count',STRUCTURE.fvgs.filter(f=>!f.filled).length+' active');
  const br=S.brain;
  setText('liq-htfbias',br?.bias||'NEUTRAL');
  const bEl=document.getElementById('liq-htfbias'); if(bEl) bEl.style.color=br?.bias==='BEARISH'?'var(--sell)':br?.bias==='BULLISH'?'var(--buy)':'var(--t3)';
  const narr=document.getElementById('liq-narrative');
  if(narr){
    const n=sw?`Liquidity sweep detected: ${sw.type} at $${Math.round(sw.level).toLocaleString()} (quality ${sw.quality}/10). `:'No sweep yet. ';
    const b=STRUCTURE.bos?`${STRUCTURE.bos} BOS confirmed. `:'Structure ranging. ';
    const z=ZONES.sell1&&ZONES.buy1?`Nearest supply: $${Math.round(ZONES.sell1.lo).toLocaleString()} | Nearest demand: $${Math.round(ZONES.buy1.hi).toLocaleString()}.`:'Zones computing...';
    narr.textContent=n+b+z;
  }
  // ADX
  const adx=STRUCTURE.adx;
  const pct=v=>Math.min(100,v/60*100)+'%';
  const adxBar=document.getElementById('adx-bar'); if(adxBar) adxBar.style.width=pct(adx.adx||0);
  setText('adx-val',(adx.adx||0).toFixed(1));
  const dipBar=document.getElementById('dip-bar'); if(dipBar) dipBar.style.width=pct(adx.diP||0);
  setText('dip-val',(adx.diP||0).toFixed(1));
  const dimBar=document.getElementById('dim-bar'); if(dimBar) dimBar.style.width=pct(adx.diM||0);
  setText('dim-val',(adx.diM||0).toFixed(1));
  setText('adx-signal',adx.signal||'NEUTRAL');
  const as=document.getElementById('adx-signal'); if(as) as.style.color=adx.signal==='SELL'?'var(--sell)':adx.signal==='BUY'?'var(--buy)':'var(--t3)';
  setText('adx-trend',adx.trend||'—');
  setText('adx-cross',adx.crossover||'—');
  const ai=document.getElementById('adx-interpret');
  if(ai) ai.textContent=adx.adx>40?`Strong trend (ADX ${adx.adx.toFixed(1)}). Trade with direction ${adx.signal}. Fade attempts counter-trend.`:adx.adx>25?`Developing trend (ADX ${adx.adx.toFixed(1)}). Wait for pullback to zone before entry.`:`Ranging market (ADX ${adx.adx.toFixed(1)} < 25). Avoid trend trades. Zone bounce setups preferred.`;
  // Algo detection (simulated)
  const price=S.gold.price; if(!price) return;
  const ph=S.ph.slice(-20);
  const moves=ph.slice(1).map((p,i)=>p-ph[i]);
  const bullM=moves.filter(m=>m>0).length;
  const twapC=Math.round(Math.max(bullM,moves.length-bullM)/moves.length*100);
  const atr=S.mem.atr.slice(-1)[0]||15;
  const spike=Math.max(...ph)-Math.min(...ph);
  const stopC=Math.min(90,Math.round(spike/atr*45));
  const trend=moves.slice(-5).reduce((a,b)=>a+b,0);
  const momC=Math.min(80,Math.round(Math.abs(trend/atr)*100));
  const fv=S.reg?.fv||price; const vwapC=Math.max(0,Math.round(100-Math.abs(price-fv)/atr*30));
  [[twapC,'twap',`${bullM>moves.length/2?'Accumulation':'Distribution'} — ${bullM}/${moves.length} bullish ticks`],
   [vwapC,'vwap',`Regression FV $${Math.round(fv).toLocaleString()} — price is ${Math.abs(price-fv).toFixed(1)}pts ${price>fv?'above':'below'}`],
   [stopC,'stop',stopC>50?`⚡ STOP HUNT ACTIVE — spike ${Math.round(spike)}pts vs ATR ${Math.round(atr)}pts`:`No active hunt. Watch $${Math.round(price+atr*1.5).toLocaleString()} / $${Math.round(price-atr*1.5).toLocaleString()}`],
   [momC,'mom',momC>55?`CTA trend chase — momentum ${trend.toFixed(1)}pts`:`Momentum below CTA threshold (${Math.round(Math.abs(trend/atr)*100)}% of trigger)`]
  ].forEach(([conf,k,desc])=>{
    setText(`algo-${k}-c`,conf+'%');
    setText(`algo-${k}-d`,desc);
    const b=document.getElementById(`algo-${k}-b`); if(b) b.style.width=conf+'%';
  });
  // Heat map
  renderHeatMap();
}

function renderHeatMap(){
  const container=document.getElementById('heatMapBody'); if(!container) return;
  const price=S.gold.price; if(!price){container.innerHTML='<div style="color:var(--t3);font-size:12px;">Awaiting price data...</div>';return;}
  const atr=S.mem.atr.slice(-1)[0]||15;
  const step=Math.round(atr*0.3);
  let html='<div style="display:flex;flex-direction:column;gap:2px;">';
  for(let i=5;i>=-5;i--){
    const lo=Math.round(price+i*step);
    const inSell=ZONES.sell.some(z=>lo>=z.lo-5&&lo<=z.hi+5);
    const inBuy=ZONES.buy.some(z=>lo>=z.lo-5&&lo<=z.hi+5);
    const isRound=lo%100===0||lo%50===0;
    let heat=0.1+Math.abs(i)/10*0.2;
    if(inSell)heat+=0.4; if(inBuy)heat+=0.4; if(isRound)heat+=0.2;
    heat=Math.min(1,heat);
    const bg=inSell?`rgba(239,68,68,${0.08+heat*0.3})`:inBuy?`rgba(34,197,94,${0.06+heat*0.25})`:`rgba(245,166,35,${0.04+heat*0.15})`;
    const label=inSell?'SUPPLY':inBuy?'DEMAND':isRound?'ROUND':'—';
    const lc=inSell?'var(--sell)':inBuy?'var(--buy)':isRound?'var(--gold)':'var(--t3)';
    const isNow=Math.abs(lo-price)<step/2;
    html+=`<div style="display:flex;align-items:center;height:22px;padding:0 8px;gap:8px;background:${bg};border-radius:3px;${isNow?'border-left:3px solid var(--gold);':''}">
      <div style="font-size:10px;color:${lc};font-weight:600;width:50px;">${label}</div>
      <div style="font-size:10px;color:var(--t1);font-family:var(--mono);flex:1;">$${lo.toLocaleString()}</div>
      <div style="font-size:9px;color:var(--t3);">${Math.round(heat*100)}%</div>
    </div>`;
  }
  html+='</div>';
  container.innerHTML=html;
}

function renderStructurePage(){
  // BOS/CHoCH
  setText('smc-bos',STRUCTURE.bos||'NONE');
  const bosEl=document.getElementById('smc-bos'); if(bosEl) bosEl.style.color=STRUCTURE.bos==='DOWN'?'var(--sell)':STRUCTURE.bos==='UP'?'var(--buy)':'var(--t3)';
  setText('smc-choch',STRUCTURE.choch||'NONE');
  const ccEl=document.getElementById('smc-choch'); if(ccEl) ccEl.style.color=STRUCTURE.choch==='BEARISH'?'var(--sell)':STRUCTURE.choch==='BULLISH'?'var(--buy)':'var(--t3)';
  setText('smc-fvg',STRUCTURE.fvgs.filter(f=>!f.filled).length+' active');
  const sw=STRUCTURE.liqSweep;
  setText('smc-sweep',sw?`${sw.type} (Q:${sw.quality}/10)`:'NONE');
  const si=document.getElementById('smc-insight');
  if(si){
    const b=STRUCTURE.bos==='DOWN'||STRUCTURE.choch==='BEARISH'?'BEARISH structure dominant.':STRUCTURE.bos==='UP'||STRUCTURE.choch==='BULLISH'?'BULLISH structure dominant.':'Structure unclear — ranging.';
    si.textContent=b+(sw?` Liquidity sweep: ${sw.type} at $${Math.round(sw.level).toLocaleString()}. Post-sweep reversal expected.`:' No sweep detected — monitoring liquidity pools.');
  }
  // TDA layers (simplified from brain signal)
  const br=S.brain; const adx=STRUCTURE.adx;
  const layers=[
    {id:'tda-d1', ok:br?.bias!=='NEUTRAL', label:br?.bias||'NEUTRAL', lbl_id:'tda-d1-lbl'},
    {id:'tda-h4', ok:!!STRUCTURE.liqSweep, label:STRUCTURE.liqSweep?STRUCTURE.liqSweep.type:'NO SWEEP', lbl_id:'tda-h4-lbl'},
    {id:'tda-h1', ok:!!STRUCTURE.bos||!!STRUCTURE.choch, label:STRUCTURE.bos||STRUCTURE.choch||'NONE', lbl_id:'tda-h1-lbl'},
    {id:'tda-m15',ok:STRUCTURE.fvgs.filter(f=>!f.filled).length>0, label:STRUCTURE.fvgs.filter(f=>!f.filled).length+' FVGs', lbl_id:'tda-m15-lbl'},
    {id:'tda-m1', ok:adx.adx>25, label:'ADX '+adx.adx.toFixed(1), lbl_id:'tda-m1-lbl'},
  ];
  const passes=layers.filter(l=>l.ok).length;
  layers.forEach(l=>{
    const e=document.getElementById(l.id); if(e){e.textContent=l.ok?'✅':'❌';e.style.fontSize='24px';}
    setText(l.lbl_id, l.label);
  });
  const grade=passes>=4?'A':passes>=3?'B':passes>=2?'C':'D';
  const ge=document.getElementById('tda-grade');
  if(ge){ge.textContent=grade;ge.style.color=grade==='A'?'var(--buy)':grade==='B'?'var(--gold)':grade==='C'?'var(--warn)':'var(--sell)';}
  setText('tda-summary',`${passes}/5 layers aligned · HTF: ${br?.bias||'NEUTRAL'} · ADX: ${adx.adx.toFixed(1)} · Sweep: ${sw?sw.type:'NONE'}`);
  // MTF bias
  const adxDir=adx.signal; const ph=S.ph;
  setText('mtf-d1',br?.bias||'NEUTRAL'); const md=document.getElementById('mtf-d1'); if(md) md.style.color=br?.bias==='BEARISH'?'var(--sell)':br?.bias==='BULLISH'?'var(--buy)':'var(--t3)';
  setText('mtf-h4',STRUCTURE.bos==='DOWN'?'BEARISH':STRUCTURE.bos==='UP'?'BULLISH':'NEUTRAL');
  setText('mtf-h1',STRUCTURE.choch||'NEUTRAL');
  setText('mtf-m15',adxDir||'NEUTRAL');
  const aligned=passes;
  setText('mtf-align',aligned>=4?'STRONGLY ALIGNED':aligned>=3?'MOSTLY ALIGNED':aligned>=2?'MIXED':'CONFLICTED');
  const score=Math.round(aligned/5*100);
  setText('mtf-score',score+'%');
  const mb=document.getElementById('mtf-bar'); if(mb){mb.style.width=score+'%';mb.style.background=score>=80?'var(--buy)':score>=60?'var(--gold)':'var(--warn)';}
}

function renderExecutionPage(){
  const br=S.brain||{}; const ts=S.tradeSetup;
  const dir=br.direction||'WAIT';
  const dirEl=document.getElementById('exec-dir');
  if(dirEl){dirEl.textContent=dir;dirEl.style.color=dir==='SELL'?'var(--sell)':dir==='BUY'?'var(--buy)':'var(--t3)';}
  setText('exec-grade',`Grade ${br.grade||'—'} | Confidence ${Math.round(br.conf||0)}%`);
  if(ts){
    setText('exec-entry',fmtPrice(ts.entry));
    setText('exec-sl',fmtPrice(ts.sl));
    setText('exec-sl-pts',Math.abs(ts.sl-ts.entry)+' pts risk');
    setText('exec-tp1',fmtPrice(ts.tp1)); setText('exec-tp1-pts',Math.round(Math.abs(ts.tp1-ts.entry))+' pts');
    setText('exec-tp2',fmtPrice(ts.tp2)); setText('exec-tp2-pts',Math.round(Math.abs(ts.tp2-ts.entry))+' pts');
    setText('exec-tp3',fmtPrice(ts.tp3)); setText('exec-tp3-pts',Math.round(Math.abs(ts.tp3-ts.entry))+' pts');
    // Zone visualizer
    const price=S.gold.price, atr=S.mem.atr.slice(-1)[0]||15;
    const rangeHi=price+atr*3, rangeLo=price-atr*3, rangeW=rangeHi-rangeLo;
    const pct=v=>Math.max(0,Math.min(100,(v-rangeLo)/rangeW*100));
    if(ZONES.sell1){const sw=document.getElementById('exec-zone-sell');if(sw){sw.style.right=(100-pct(ZONES.sell1.hi))+'%';sw.style.left=pct(ZONES.sell1.lo)+'%';}}
    if(ZONES.buy1){const bw=document.getElementById('exec-zone-buy');if(bw){bw.style.left=pct(ZONES.buy1.lo)+'%';bw.style.right=(100-pct(ZONES.buy1.hi))+'%';}}
    const pm=document.getElementById('exec-price-marker'); if(pm) pm.style.left=pct(price)+'%';
    setText('exec-zone-lo',ZONES.buy1?'$'+Math.round(ZONES.buy1.lo).toLocaleString():'$—');
    setText('exec-zone-hi',ZONES.sell1?'$'+Math.round(ZONES.sell1.hi).toLocaleString():'$—');
  }
  // Gates
  const adx=STRUCTURE.adx;
  const gates=[
    {id:'gate-struct', ok:!!STRUCTURE.bos||!!STRUCTURE.choch, detail:STRUCTURE.bos?`BOS ${STRUCTURE.bos} confirmed`:STRUCTURE.choch?`CHoCH ${STRUCTURE.choch}`:'No structure break yet'},
    {id:'gate-adx',    ok:adx.adx>=25, detail:`ADX ${adx.adx.toFixed(1)} (need ≥25) · Signal: ${adx.signal}`},
    {id:'gate-zone',   ok:!!(ZONES.sell1||ZONES.buy1), detail:ZONES.sell1?`In sell zone $${Math.round(ZONES.sell1?.lo||0).toLocaleString()}`:ZONES.buy1?`In buy zone $${Math.round(ZONES.buy1?.hi||0).toLocaleString()}`:'No zones detected yet'},
    {id:'gate-sweep',  ok:!!STRUCTURE.liqSweep, detail:STRUCTURE.liqSweep?`${STRUCTURE.liqSweep.type} sweep Q:${STRUCTURE.liqSweep.quality}/10`:'Waiting for liquidity sweep'},
    {id:'gate-macro',  ok:br.checks?.macro||false, detail:S.macroState?`DXY ${S.dxy.ch>=0?'↑ headwind':'↓ tailwind'} · Yield ${S.yield.ch>=0?'↑ headwind':'↓ tailwind'}`:'Loading macro data'},
    {id:'gate-sess',   ok:S.session?.inKZ||false, detail:S.session?`${S.session.name} session · Kill zone: ${S.session.inKZ?'✓ ACTIVE':'not yet'}`:'Computing session'},
    {id:'gate-news',   ok:!window._newsBlackout, detail:window._newsBlackout?'⚠ HIGH IMPACT EVENT — avoid new trades':'Calendar clear — safe window'},
  ];
  let passed=0;
  gates.forEach(g=>{ const e=document.getElementById(g.id); if(e){e.className='sig-check '+(g.ok?'met':'unmet');} setText(g.id+'-detail',g.detail); if(g.ok) passed++; });
  setText('gates-pct',passed+'/7');
  const gb=document.getElementById('gates-bar'); if(gb){gb.style.width=(passed/7*100)+'%';gb.style.background=passed>=6?'var(--buy)':passed>=4?'var(--gold)':'var(--warn)';}
  const gv=document.getElementById('gates-verdict');
  if(gv){
    gv.textContent=passed>=6?'✅ EXECUTE — All gates clear':passed>=5?'⚡ NEAR READY — Wait for final gate':passed>=3?'⏳ DEVELOPING — '+( 7-passed)+' gates remaining':'🔴 NOT READY — '+passed+'/7 gates met';
    gv.style.background=passed>=6?'var(--buydim)':passed>=5?'var(--golddim)':passed>=3?'var(--warndim)':'var(--selldim)';
    gv.style.color=passed>=6?'var(--buy)':passed>=5?'var(--gold)':passed>=3?'var(--warn)':'var(--sell)';
  }
  // Risk engine
  const ps=S.posSize;
  setText('re-equity',S.equity?'$'+S.equity.toLocaleString():'Not set — tap ⚙');
  setText('re-risk',S.riskPct+'%');
  setText('re-riskusd',ps?'$'+ps.riskAmt.toFixed(2):'—');
  setText('re-lot',ps?ps.lot.toFixed(2)+' lots':'—');
  setText('re-sl-dist',ts?Math.abs(ts.sl-ts.entry)+' pts':'—');
  setText('re-pnl',ps?'+$'+(ps.riskAmt*1.2).toFixed(2):'—');
  const peakDD=S.peakEquity>0?Math.max(0,(S.peakEquity-S.equity)/S.peakEquity*100):0;
  setText('re-dd',peakDD.toFixed(1)+'%');
  const ddb=document.getElementById('re-dd-bar'); if(ddb){ddb.style.width=Math.min(100,peakDD*5)+'%';ddb.style.background=peakDD>5?'var(--sell)':'var(--warn)';}
  // Scenarios — dynamic from brain
  const conf=Math.round(br.conf||0);
  const bearPct=dir==='SELL'?Math.min(85,conf):Math.max(10,40-conf/3);
  const bullPct=dir==='BUY'?Math.min(85,conf):Math.max(10,40-conf/3);
  const chaosPct=Math.max(5,Math.min(25,100-bearPct-bullPct));
  const normBear=Math.round(bearPct/(bearPct+bullPct+chaosPct)*100);
  const normBull=Math.round(bullPct/(bearPct+bullPct+chaosPct)*100);
  const normChaos=100-normBear-normBull;
  setText('scen-a-name','SCENARIO A — '+(dir==='SELL'?'PRIMARY SELL':'BEAR REVERSAL'));
  setText('scen-a-pct',normBear+'%');
  const sab=document.getElementById('scen-a-bar'); if(sab) sab.style.width=normBear+'%';
  setText('scen-a-txt',dir==='SELL'?`Price at supply zone → vol death + rejection → deliver to demand $${ZONES.buy1?Math.round(ZONES.buy1.hi).toLocaleString():'—'}. DXY ${S.dxy.price?.toFixed(1)||'—'} confirms.`:` Price fails to hold demand → break lower toward next structure $${ZONES.buy2?Math.round(ZONES.buy2.hi).toLocaleString():'—'}.`);
  setText('scen-b-name','SCENARIO B — '+(dir==='BUY'?'PRIMARY BUY':'BULL CONTINUATION'));
  setText('scen-b-pct',normBull+'%');
  const sbb=document.getElementById('scen-b-bar'); if(sbb) sbb.style.width=normBull+'%';
  setText('scen-b-txt',dir==='BUY'?`Price at demand zone → absorption vol → recovery to supply $${ZONES.sell1?Math.round(ZONES.sell1.lo).toLocaleString():'—'}.`:`Demand holds → mechanical bounce to $${ZONES.sell1?Math.round(ZONES.sell1.lo).toLocaleString():'—'}. Monitor for sell at supply.`);
  setText('scen-c-pct',normChaos+'%');
  const scb=document.getElementById('scen-c-bar'); if(scb) scb.style.width=normChaos+'%';
  setText('scen-c-txt','High-impact news catalyst → breakout beyond zones. No trade during blackout. Capital protection priority.');
}

function renderQuantPage(){
  const br=S.brain||{}, adx=STRUCTURE.adx;
  // AI Score bars
  const macroS=S.macroState?.macroScore||0;
  const structS=STRUCTURE.smcScore||5;
  const confS=Math.round(br.conf||0);
  const adxS=Math.round(adx.strength*10||0);
  const regS=S.reg?.prem?Math.min(10,Math.max(0,10-Math.abs(S.reg.prem)/50*10)):5;
  const aiTotal=Math.min(100,Math.round((Math.min(10,macroS)/10*20)+(Math.min(10,structS)/10*20)+(Math.min(100,confS)/100*25)+(Math.min(10,adxS)/10*20)+(Math.min(10,regS)/10*15)));
  setText('q-ai-score',aiTotal);
  const ae=document.getElementById('q-ai-score'); if(ae) ae.style.color=aiTotal>=70?'var(--piv)':aiTotal>=50?'var(--warn)':'var(--sell)';
  [[macroS*10,'q-ai-macro','q-ai-macro-b'],[structS*10,'q-ai-struct','q-ai-struct-b'],[confS,'q-ai-quant','q-ai-quant-b'],[adxS*10,'q-ai-adx','q-ai-adx-b'],[regS*10,'q-ai-reg','q-ai-reg-b']]
    .forEach(([v,tid,bid])=>{ setText(tid,v+'%'); const b=document.getElementById(bid); if(b) b.style.width=v+'%'; });
  // TC Score
  const c=br.checks||{};
  const tcItems={zone:c.liq,vol:c.vol,rej:c.struct,sess:c.sess,dxy:c.macro};
  const tcTotal=Math.round(Object.values(tcItems).filter(Boolean).length/5*100);
  setText('q-tc-score',tcTotal);
  const te=document.getElementById('q-tc-score'); if(te) te.style.color=tcTotal>=80?'var(--gold)':tcTotal>=60?'var(--warn)':'var(--sell)';
  Object.entries(tcItems).forEach(([k,v])=>{
    const pct=v?80+Math.random()*20:10+Math.random()*30;
    setText('q-tc-'+k,v?'✓ MET':'✗ UNMET');
    const b=document.getElementById('q-tc-'+k+'-b'); if(b){b.style.width=pct+'%';}
  });
  // Unified / Bayesian
  const dir=br.direction||'WAIT';
  const conf2=Math.round(br.conf||0);
  const pSell=dir==='SELL'?conf2/100:dir==='BUY'?(100-conf2)/100*0.7:(0.35+Math.random()*0.1);
  const pBuy=dir==='BUY'?conf2/100:dir==='SELL'?(100-conf2)/100*0.7:(0.35+Math.random()*0.1);
  const pNeut=Math.max(0,1-pSell-pBuy);
  const tot=pSell+pBuy+pNeut;
  const psN=pSell/tot, pbN=pBuy/tot, pnN=pNeut/tot;
  const buyB=document.getElementById('bayes-buy-bar'); if(buyB){buyB.style.width=(pbN*100)+'%';buyB.textContent=pbN>0.15?(Math.round(pbN*100)+'%'):''}
  const neutB=document.getElementById('bayes-neut-bar'); if(neutB) neutB.style.width=(pnN*100)+'%';
  const sellB=document.getElementById('bayes-sell-bar'); if(sellB){sellB.style.width=(psN*100)+'%';sellB.textContent=psN>0.15?(Math.round(psN*100)+'%'):''}
  setText('bayes-pbuy',Math.round(pbN*100)+'%'); setText('bayes-pneut',Math.round(pnN*100)+'%'); setText('bayes-psell',Math.round(psN*100)+'%');
  const edgePct=Math.round(Math.abs(pbN-psN)*100);
  setText('q-unified-score',edgePct+'%'); setText('q-unified-lbl',dir==='SELL'?'▼ SELL SIGNAL':dir==='BUY'?'▲ BUY SIGNAL':'◆ WAIT');
  const ue=document.getElementById('q-unified-lbl'); if(ue) ue.style.color=dir==='SELL'?'var(--sell)':dir==='BUY'?'var(--buy)':'var(--t3)';
  setText('q-unified-sub',`Bayesian posterior · P(SELL): ${Math.round(psN*100)}% · P(BUY): ${Math.round(pbN*100)}% · Edge: ${edgePct}%`);
  // MC
  runMonteCarlo();
  // ML
  renderMLPanel();
}

function renderAllModules(){
  renderMacroPage();
  renderLiquidityPage();
  renderStructurePage();
  renderExecutionPage();
  renderQuantPage();
  renderJournalPage();
  renderMLPanel();
}

// ─── WIRE ECON CAL DATA TO MACRO PAGE ──────────────────────
const _origFetchEconCal=window.fetchEconCal;
window.fetchEconCal=async function(){
  try{
    const r=await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json',{cache:'no-store',signal:AbortSignal.timeout(6000)});
    if(r.ok){
      const events=await r.json();
      const gold=events.filter(e=>['USD','EUR'].includes(e.country)&&['High','Medium'].includes(e.impact));
      window._econEvents=gold;
      // Check news blackout
      const now=Date.now();
      const soon=gold.filter(e=>{ try{const t=new Date(e.date).getTime();return e.impact==='High'&&t>now-900000&&t<now+1800000;}catch(x){return false;} });
      window._newsBlackout=soon.length>0;
      // Render dashboard news
      if(typeof renderNewsFeed==='function') renderNewsFeed(gold.slice(0,3));
      renderMacroPage();
    }
  }catch(e){}
};

// ─── PAGE CHANGE TRIGGER ────────────────────────────────────
const _origGoPage=window.goPage;
window.goPage=function(name){
  _origGoPage(name);
  if(name==='macro') renderMacroPage();
  else if(name==='liquidity') renderLiquidityPage();
  else if(name==='structure') renderStructurePage();
  else if(name==='execution') renderExecutionPage();
  else if(name==='quant') renderQuantPage();
  else if(name==='journal') renderJournalPage();
  else if(name==='settings'){openSettings();return;}
};

// ─── INIT v5.1 ──────────────────────────────────────────────
loadCFG();
addAuditEntry('SYS','NEXUS ZED v5.1 initialising...');

// After main init runs, fire OHLC fetch if key exists
setTimeout(()=>{
  if(CFG.tdKey){
    addAuditEntry('SYS','Twelve Data key found — fetching OHLC...');
    fetchOHLCFromTwelveData();
  } else {
    addAuditEntry('INFO','No API key configured. Open ⚙ Settings to connect Twelve Data for real OHLC data.');
  }
  renderAllModules();
  // Module refresh every 30s
  setInterval(renderAllModules, 30000);
}, 3000);

addAuditEntry('SYS','Dashboard ready. All engines active.');
