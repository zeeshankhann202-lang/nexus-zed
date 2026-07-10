// NEXUS ZED — UI Renderers + Init

// ═══════════════════════════════════════════════════════════
// RENDER — ALL UI ELEMENTS
// ═══════════════════════════════════════════════════════════
function renderAll(){
  renderPriceBar();
  renderSignalCard();
  renderTradeCard();
  renderMarketSummary();
  renderSentiment();
  renderChart();
}

function renderPriceBar(){
  const g=S.gold;
  setText('pbPrice',g.price?fmtPrice(g.price):'—');
  const ch=g.ch||0;
  const col=ch>0?'var(--buy)':ch<0?'var(--sell)':'var(--t3)';
  const chEl=el('pbChange'); if(chEl){ chEl.textContent=fmtCh(ch); chEl.style.color=col; }
  const pEl=el('pbChangePct'); if(pEl){ pEl.textContent=g.price?fmtPct(ch,g.price-ch):'—'; pEl.style.color=col; }
  // Session
  const sess=S.session;
  setText('pbSessName',(sess.name||'—')+' Session');
  setText('pbSessTime',pktStr());
}

function renderSignalCard(){
  const br=S.brain; if(!br) return;
  const dir=el('sigDir');
  if(dir){
    dir.textContent=br.direction;
    dir.style.color=br.direction==='SELL'?'var(--sell)':br.direction==='BUY'?'var(--buy)':'var(--t3)';
  }
  const conf=Math.round(br.conf||0);
  const confEl=el('sigConf');
  if(confEl){ confEl.textContent=conf+'%'; confEl.style.color=conf>=80?'var(--buy)':conf>=60?'var(--warn)':'var(--t3)'; }
  const bar=el('sigConfBar');
  if(bar){ bar.style.width=conf+'%';
    bar.style.background=br.direction==='SELL'?'var(--sell)':br.direction==='BUY'?'var(--buy)':'var(--t3)'; }

  setText('sigState',br.state||'SCANNING');
  const sv=el('sigState'); if(sv) sv.style.color=br.state==='TRENDING'?'var(--sell)':br.state==='DEVELOPING'?'var(--warn)':'var(--t3)';

  // Chips
  const word=br.bias||'NEUTRAL';
  const chips=el('sigChips');
  if(chips){
    const col=word==='BEARISH'?'var(--sell)':word==='BULLISH'?'var(--buy)':'var(--t3)';
    const bg=word==='BEARISH'?'var(--selldim)':word==='BULLISH'?'var(--buydim)':'var(--bg3)';
    chips.innerHTML=[...word].map(ch=>`<span class="sig-chip" style="background:${bg};color:${col};">${ch}</span>`).join('');
  }

  // Reason checks
  const c=br.checks||{};
  Object.entries({macro:c.macro,liq:c.liq,struct:c.struct,sess:c.sess,ai:c.ai,vol:c.vol}).forEach(([k,v])=>{
    const el2=el('chk-'+k); if(el2) el2.className='sig-check '+(v?'met':'unmet');
  });

  // Stats
  const bos=STRUCTURE.bos,adx=STRUCTURE.adx;
  const trend=adx.signal==='SELL'?'BEARISH':adx.signal==='BUY'?'BULLISH':'NEUTRAL';
  setText('statTrend',trend);
  const te=el('statTrend'); if(te) te.style.color=trend==='BEARISH'?'var(--sell)':trend==='BULLISH'?'var(--buy)':'var(--t3)';
  setText('trendIcon',adx.signal==='SELL'?'↓':adx.signal==='BUY'?'↑':'→');

  const atr=S.mem.atr.length?S.mem.atr[S.mem.atr.length-1]:0;
  const volReg=atr>25?'HIGH':atr>15?'MEDIUM':'LOW';
  setText('statVol',volReg);
  const ve=el('statVol'); if(ve) ve.style.color=atr>25?'var(--sell)':atr>15?'var(--warn)':'var(--buy)';

  const liqLabel=ZONES.sell1&&ZONES.buy1?'HIGH':'MEDIUM';
  setText('statLiq',liqLabel);
  const le=el('statLiq'); if(le) le.style.color=liqLabel==='HIGH'?'var(--buy)':'var(--warn)';
  setText('statAI',conf+'%');

  // Alert count
  const alerts=Object.values(br.checks||{}).filter(Boolean).length;
  S.alerts=alerts;
  setText('alertCount',alerts);
}

function renderTradeCard(){
  const ts=S.tradeSetup;
  if(!ts){ ['tsEntry','tsSL','tsTP1','tsTP2','tsTP3'].forEach(id=>setText(id,'—'));
    ['tsSLpts','tsTP1pts','tsTP2pts','tsTP3pts'].forEach(id=>setText(id,'—')); return; }
  setText('tsEntry',fmtPrice(ts.entry));
  setText('tsSL',fmtPrice(ts.sl));
  const slPts=Math.abs(ts.sl-ts.entry);
  setText('tsSLpts',Math.round(slPts)+' pts');
  ['tp1','tp2','tp3'].forEach((k,i)=>{
    setText('tsTP'+(i+1),fmtPrice(ts[k]));
    const pts=Math.round(Math.abs(ts[k]-ts.entry));
    setText('tsTP'+(i+1)+'pts',pts+' pts');
  });
  // Risk management
  const ps=S.posSize;
  setText('rmRisk',(S.riskPct||1).toFixed(1)+'%');
  setText('rmLot',ps?ps.lot.toFixed(2)+' Lots':'—');
  setText('rmAcct',S.equity?'$'+S.equity.toLocaleString():'Not set');
  setText('rmMaxLoss',ps?'$'+ps.maxLoss.toFixed(0):'—');
  if(el('acctInput')&&!el('acctInput').value&&S.equity) el('acctInput').value=S.equity;
}

function renderMarketSummary(){
  setText('msDXY',S.dxy.price?fmtPrice(S.dxy.price,3):'—');
  const dc=el('msDXYch'); if(dc){ dc.textContent=fmtCh(S.dxy.ch,3); dc.style.color=S.dxy.ch>0?'var(--buy)':S.dxy.ch<0?'var(--sell)':'var(--t3)'; }
  setText('msYield',S.yield.price?fmtPrice(S.yield.price,2)+'%':'—');
  const yc=el('msYieldch'); if(yc){ yc.textContent=fmtCh(S.yield.ch,3); yc.style.color=S.yield.ch>0?'var(--sell)':S.yield.ch<0?'var(--buy)':'var(--t3)'; } // yield up = gold bearish
  setText('msOil',S.oil.price?'$'+fmtPrice(S.oil.price):'—');
  const oc=el('msOilch'); if(oc){ oc.textContent=fmtCh(S.oil.ch); oc.style.color=S.oil.ch>0?'var(--buy)':S.oil.ch<0?'var(--sell)':'var(--t3)'; }
  setText('msSPX',S.spx.price?fmtPrice(S.spx.price):'—');
  const sc=el('msSPXch'); if(sc){ sc.textContent=fmtCh(S.spx.ch); sc.style.color=S.spx.ch>0?'var(--buy)':S.spx.ch<0?'var(--sell)':'var(--t3)'; }
}

function renderSentiment(){
  // Score: composite of macro, structure, ADX
  const br=S.brain;
  let score=0;
  if(br){
    score=br.direction==='SELL'?-Math.round(br.conf):br.direction==='BUY'?Math.round(br.conf):0;
    // Weight with ADX
    score=Math.round(score*(1+STRUCTURE.adx.strength*0.05));
    score=Math.max(-100,Math.min(100,score));
  }
  renderSentGauge(score);
  const se=el('sentVal'); if(se){ se.textContent=score; se.style.color=score<-30?'var(--sell)':score>30?'var(--buy)':'var(--warn)'; }
  const sl=el('sentLabel');
  if(sl){
    const lbl=score<-60?'STRONGLY BEARISH':score<-20?'BEARISH':score>60?'STRONGLY BULLISH':score>20?'BULLISH':'NEUTRAL';
    sl.textContent=lbl; sl.style.color=score<-20?'var(--sell)':score>20?'var(--buy)':'var(--warn)';
  }
}

// ═══════════════════════════════════════════════════════════
// CLOCK
// ═══════════════════════════════════════════════════════════
function updateClock(){
  const sess=computeSession();
  setText('pbSessTime',pktStr());
  setText('pbSessName',(sess.name||'—')+' Session');
}

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
async function init(){
  // Pre-load FALLBACK prices immediately so dashboard never shows blank
  if(!S.gold.price && typeof FALLBACK !== 'undefined') {
    S.gold  = {...FALLBACK.gold,  prev: FALLBACK.gold.price};
    S.dxy   = {...FALLBACK.dxy,   prev: FALLBACK.dxy.price};
    S.yield = {...FALLBACK.yield, prev: FALLBACK.yield.price};
    S.oil   = {...FALLBACK.oil,   prev: FALLBACK.oil.price};
    S.spx   = {...FALLBACK.spx,   prev: FALLBACK.spx.price};
    S.vix   = {...FALLBACK.vix,   prev: FALLBACK.vix.price};
    renderAll();
  }
  // Load persisted equity
  if(S.equity&&el('acctInput')) el('acctInput').value=S.equity;

  // Load saved settings before first render
  if(typeof loadCFG === 'function') loadCFG();
  if(S.equity && typeof runPositionSize === 'function') runPositionSize();
  // First fetch
  await fetchAll();
  await fetchEconCal();

  // Gold micro-refresh every 5s
  setInterval(async()=>{
    if(await fetchGold()){
      S.ph.push(S.gold.price); if(S.ph.length>200) S.ph.shift();
      S.vh.push(Math.random()*500+100); if(S.vh.length>200) S.vh.shift(); // Volume simulated until WebSocket
      runStructureEngine(); runZoneEngine(); runRegression(); runADX(); runBrainSignal(); runPositionSize();
      renderAll();
    }
  },5000);

  // Full refresh every 10s
  setInterval(fetchAll, 10000);
  // Calendar every 5min
  setInterval(fetchEconCal, 300000);
  // Clock every second
  setInterval(updateClock, 1000);
  // Chart resize
  window.addEventListener('resize', ()=>{ renderChart(); });
}

// Seed initial price history on first gold load
fetchGold().then(()=>{
  if(S.gold.price){
    // Seed price history with simulated walk around current price (replaced by real OHLC later)
    const base=S.gold.price;
    for(let i=0;i<80;i++){
      const prev=S.ph.length?S.ph[S.ph.length-1]:base;
      S.ph.push(+(prev+(Math.random()-0.5)*4).toFixed(2));
      S.vh.push(Math.random()*500+100);
    }
    runStructureEngine(); runZoneEngine(); runRegression(); runADX(); runBrainSignal();
    renderAll();
  }
  init();
});
