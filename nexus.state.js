// NEXUS ZED — Global State Objects + Persistence

'use strict';
// ═══════════════════════════════════════════════════════════
// NEXUS ZED v5 — ENGINE CORE
// Clean rebuild. Zero hardcoded levels. All zones computed live.
// ═══════════════════════════════════════════════════════════

// ── DISCLAIMER ──
function acceptDisclaimer(){
  try{ localStorage.setItem('nexus_disc','1'); }catch(e){}
  document.getElementById('disclaimerModal').style.display='none';
}
(function(){
  try{ if(localStorage.getItem('nexus_disc')==='1') acceptDisclaimer(); }catch(e){}
})();

// ── NAVIGATION ──
function goPage(name){
  if(name==='settings'){ if(typeof openSettings==='function') openSettings(); return; }
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('[data-page]').forEach(b=>b.classList.remove('active'));
  const pg = document.getElementById('page-'+name);
  if(pg) pg.classList.add('active');
  document.querySelectorAll('[data-page="'+name+'"]').forEach(b=>b.classList.add('active'));
  window.scrollTo({top:0,behavior:'smooth'});
  if(typeof renderAll==='function') renderAll();
  if(typeof renderAllModules==='function') renderAllModules();
  const _pgR={
    macro:()=>{if(typeof renderMacroPage==='function')renderMacroPage();},
    liquidity:()=>{if(typeof renderLiquidityPage==='function')renderLiquidityPage();},
    structure:()=>{if(typeof renderStructurePage==='function')renderStructurePage();},
    execution:()=>{if(typeof renderExecutionPage==='function')renderExecutionPage();},
    quant:()=>{if(typeof renderQuantPage==='function')renderQuantPage();},
    journal:()=>{if(typeof renderJournalPage==='function')renderJournalPage();},
  };
  if(_pgR[name])_pgR[name]();
}
document.querySelectorAll('[data-page]').forEach(b=>{
  b.addEventListener('click',()=>{ const p=b.getAttribute('data-page'); if(p) goPage(p); });
});

// ── CHART TOGGLE ──
let showingTV = false;
let showZoneLabels = true;
function showOurChart(){
  showingTV=false;
  document.getElementById('ourChartArea').style.display='';
  document.getElementById('tvWidget').style.display='none';
  document.getElementById('btnOurChart').classList.add('active');
  document.getElementById('btnTVChart').classList.remove('active');
  renderChart();
}
function showTVChart(){
  showingTV=true;
  document.getElementById('ourChartArea').style.display='none';
  document.getElementById('tvWidget').style.display='';
  document.getElementById('btnOurChart').classList.remove('active');
  document.getElementById('btnTVChart').classList.add('active');
  initTVWidget();
}
function toggleZoneLabels(){
  showZoneLabels=!showZoneLabels;
  const btn=document.getElementById('btnZoneLabels');
  btn.style.color=showZoneLabels?'var(--gold)':'var(--t3)';
  renderChart();
}
function toggleFullscreen(){
  const area=document.getElementById('ourChartArea');
  if(!document.fullscreenElement){ area.requestFullscreen?.(); }
  else{ document.exitFullscreen?.(); }
}

let tvInited=false;
function initTVWidget(){
  if(tvInited) return; tvInited=true;
  const c=document.getElementById('tvContainer');
  c.innerHTML='';
  try{
    new TradingView.widget({
      container_id:'tvContainer',
      symbol:'OANDA:XAUUSD',
      interval:'15',
      theme:'dark',
      style:'1',
      locale:'en',
      toolbar_bg:'#111118',
      enable_publishing:false,
      hide_top_toolbar:false,
      hide_legend:false,
      save_image:false,
      height:280,
      width:'100%',
    });
  }catch(e){
    c.innerHTML='<div style="padding:20px;text-align:center;color:var(--t3);font-size:12px;">TradingView widget requires the TradingView library to be loaded.<br>Add your TradingView script tag to enable this feature.</div>';
  }
}

// ── TIMEFRAME SELECTION ──
let activeTF='15m';
document.querySelectorAll('.chart-tf').forEach(b=>{
  b.addEventListener('click',()=>{
    document.querySelectorAll('.chart-tf').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    activeTF=b.getAttribute('data-tf');
    renderChart();
  });
});

// ═══════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════
const S = {
  gold:  {price:0, ch:0, prev:0},
  dxy:   {price:0, ch:0, prev:0},
  yield: {price:0, ch:0, prev:0},
  oil:   {price:0, ch:0, prev:0},
  spx:   {price:0, ch:0, prev:0},
  vix:   {price:0, ch:0, prev:0},
  feedOk:{gold:false,dxy:false,yield:false,oil:false,spx:false,vix:false},
  ph:[], vh:[], cycle:0,
  equity:10000, peakEquity:0,
  riskPct:1,
  session:{name:'UNKNOWN',quality:1,htfBias:'NEUTRAL',adxThreshold:25},
  macroState:null,
  reg:{fv:null,prem:null},
  mem:{atr:[],pat:0},
  monteCarlo:null,
  mlGrade:'C', mlProb:0.5, mlScore:0, mlDecision:'WAIT',
  alerts:0,
};

// CANDLES — populated by real OHLC fetch
const CANDLES={
  m1:[], m5:[], m15:[], h1:[], h4:[], d1:[],
  atr:{m1:0,m5:0,m15:0,h1:0,h4:0,d1:0},
  pdh:null, pdl:null,
  equalHighs:[], equalLows:[], breakers:[],
};

// STRUCTURE — computed from candles
const STRUCTURE={
  bos:null, choch:null,
  fvgs:[], obs:[], liqSweep:null,
  structure:'RANGE', adx:{adx:0,diP:0,diM:0,signal:'NEUTRAL',trend:'NONE',strength:0},
  smcScore:5, smcRaw:0,
};

// ZONES — auto-detected, never hardcoded
const ZONES={sell:[],buy:[],sell1:null,sell2:null,buy1:null,buy2:null};

const ML={
  trainingData:[], trades:[], forest:[],
  isTrained:false, accuracy:null, predProb:0.5, predDecision:'WAIT', predGrade:'C',
  performance:{wins:0,losses:0,total:0},
  btWinRate:68, btAvgRR:'2.8',
};

// Persist / restore
(function restoreState(){
  try{
    const eq=localStorage.getItem('nexus_equity');
    if(eq) S.equity=parseFloat(eq)||0;
    const rp=localStorage.getItem('nexus_risk');
    if(rp) S.riskPct=parseFloat(rp)||1;
    const ml=localStorage.getItem('nexus_ml');
    if(ml){ const d=JSON.parse(ml); if(d.trades) ML.trades=d.trades.slice(0,50); if(d.trainingData) ML.trainingData=d.trainingData.slice(0,200); }
  }catch(e){}
})();

function persistState(){
  try{
    if(S.equity>0) localStorage.setItem('nexus_equity',S.equity);
    localStorage.setItem('nexus_risk',S.riskPct);
    localStorage.setItem('nexus_ml',JSON.stringify({trades:ML.trades.slice(0,20),trainingData:ML.trainingData.slice(0,50)}));
  }catch(e){}
}

// ═══════════════════════════════════════════════════════════
// STALE CACHE & FALLBACK
// ═══════════════════════════════════════════════════════════
