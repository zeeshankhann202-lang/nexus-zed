// NEXUS ZED — Analytical Engines

// ═══════════════════════════════════════════════════════════
// REGRESSION ENGINE
// ═══════════════════════════════════════════════════════════
function runRegression(){
  const ph=S.ph; if(ph.length<10) return;
  const n=ph.length;
  const xs=[...Array(n)].map((_,i)=>i);
  const mx=xs.reduce((a,b)=>a+b,0)/n, my=ph.reduce((a,b)=>a+b,0)/n;
  const num=xs.reduce((s,x,i)=>s+(x-mx)*(ph[i]-my),0);
  const den=xs.reduce((s,x)=>s+(x-mx)**2,0);
  const slope=den?num/den:0, intercept=my-slope*mx;
  const fv=slope*n+intercept;
  const sigma=Math.sqrt(ph.reduce((s,p)=>s+(p-fv)**2,0)/n);
  S.reg={fv:+fv.toFixed(2),prem:+(S.gold.price-fv).toFixed(2),sigma:+sigma.toFixed(2)};
}

// ═══════════════════════════════════════════════════════════
// ADX ENGINE (Wilder)
// ═══════════════════════════════════════════════════════════
function computeADX(prices,period=14){
  if(prices.length<period+2) return {adx:0,diP:0,diM:0};
  const H=prices.map((p,i)=>i===0?p:Math.max(p,prices[i-1]));
  const L=prices.map((p,i)=>i===0?p:Math.min(p,prices[i-1]));
  const trArr=[],dmP=[],dmM=[];
  for(let i=1;i<prices.length;i++){
    const tr=Math.max(H[i]-L[i],Math.abs(H[i]-prices[i-1]),Math.abs(L[i]-prices[i-1]));
    trArr.push(tr);
    const up=H[i]-H[i-1], dn=L[i-1]-L[i];
    dmP.push(up>dn&&up>0?up:0);
    dmM.push(dn>up&&dn>0?dn:0);
  }
  const w=(arr,p)=>{ let s=arr.slice(0,p).reduce((a,b)=>a+b,0);
    for(let i=p;i<arr.length;i++) s=s-(s/p)+arr[i]; return s; };
  const sTR=w(trArr,period),sDMP=w(dmP,period),sDMM=w(dmM,period);
  const diP=sTR>0?sDMP/sTR*100:0, diM=sTR>0?sDMM/sTR*100:0;
  const dx=(diP+diM)>0?Math.abs(diP-diM)/(diP+diM)*100:0;
  return {adx:+dx.toFixed(1),diP:+diP.toFixed(1),diM:+diM.toFixed(1)};
}

function runADX(){
  const ph=S.ph; if(ph.length<20) return;
  const res=computeADX(ph.slice(-60),14);
  const signal=res.diP>res.diM?'BUY':'SELL';
  const trend=res.adx>40?'STRONG_'+(signal==='BUY'?'BULL':'BEAR'):res.adx>25?signal==='BUY'?'BULL':'BEAR':'RANGE';
  STRUCTURE.adx={...res,signal,trend,strength:Math.min(10,res.adx/10)};
}

// ═══════════════════════════════════════════════════════════
// STRUCTURE ENGINE — Zero hardcoded levels
// BOS/CHoCH/FVG/OB computed from live price history
// ═══════════════════════════════════════════════════════════
function runStructureEngine(){
  const ph=S.ph; if(ph.length<20) return;
  const atr=computeATR(ph);
  if(atr>0) S.mem.atr.push(atr);
  if(S.mem.atr.length>50) S.mem.atr.shift();

  // BOS: has price broken a recent swing high or low?
  const recent=ph.slice(-20);
  const prevHigh=Math.max(...ph.slice(-40,-20));
  const prevLow=Math.min(...ph.slice(-40,-20));
  const currHigh=Math.max(...recent);
  const currLow=Math.min(...recent);
  STRUCTURE.bos=currHigh>prevHigh+atr*0.3?'UP':currLow<prevLow-atr*0.3?'DOWN':null;

  // CHoCH: prior trend broken
  const h1=Math.max(...ph.slice(-60,-30)), l1=Math.min(...ph.slice(-60,-30));
  const h2=Math.max(...ph.slice(-30)), l2=Math.min(...ph.slice(-30));
  STRUCTURE.choch=(h2<h1-atr&&l2<l1)?'BEARISH':(h2>h1+atr&&l2>l1)?'BULLISH':null;

  // Liquidity sweep: sharp wick beyond recent level then reversal
  const last5=ph.slice(-5);
  const swing5H=Math.max(...ph.slice(-25,-5));
  const swing5L=Math.min(...ph.slice(-25,-5));
  const lastPr=ph[ph.length-1];
  let sweep=null;
  if(Math.max(...last5)>swing5H+atr*0.2&&lastPr<swing5H) sweep={type:'BSL',level:swing5H,quality:7,anatomy:'COMPLETE'};
  else if(Math.min(...last5)<swing5L-atr*0.2&&lastPr>swing5L) sweep={type:'SSL',level:swing5L,quality:7,anatomy:'COMPLETE'};
  STRUCTURE.liqSweep=sweep;

  // Auto-detect FVGs from price history (3-bar gaps)
  STRUCTURE.fvgs=[];
  for(let i=2;i<ph.length-1;i++){
    const p1=ph[i-2],p2=ph[i-1],p3=ph[i];
    if(p3>p1&&(p3-p1)>atr*0.3) STRUCTURE.fvgs.push({type:'BULLISH',hi:p3,lo:p1,filled:false,tf:'computed'});
    else if(p3<p1&&(p1-p3)>atr*0.3) STRUCTURE.fvgs.push({type:'BEARISH',hi:p1,lo:p3,filled:false,tf:'computed'});
  }
  // Keep most recent 5 unfilled
  STRUCTURE.fvgs=STRUCTURE.fvgs.filter(f=>!f.filled).slice(-5);

  // SMC score
  const bosScore=STRUCTURE.bos==='DOWN'?8:STRUCTURE.bos==='UP'?2:5;
  const adxScore=STRUCTURE.adx.signal==='SELL'?7:STRUCTURE.adx.signal==='BUY'?3:5;
  const sweepScore=sweep?.type==='BSL'?7:sweep?.type==='SSL'?3:5;
  STRUCTURE.smcScore=Math.round((bosScore+adxScore+sweepScore)/3);
  STRUCTURE.smcRaw=STRUCTURE.smcScore-5; // -5 to +5 (pos=bear)
}

function computeATR(prices,period=14){
  if(prices.length<period) return 15;
  const trs=[];
  for(let i=1;i<Math.min(prices.length,period*2);i++){
    const h=Math.max(prices[i],prices[i-1]),l=Math.min(prices[i],prices[i-1]);
    trs.push(h-l);
  }
  return trs.reduce((a,b)=>a+b,0)/trs.length||15;
}

// ═══════════════════════════════════════════════════════════
// ZONE ENGINE — Auto-computed from live price + structure
// ZERO hardcoded levels. All relative to current price.
// ═══════════════════════════════════════════════════════════
function runZoneEngine(){
  const price=S.gold.price; if(!price) return;
  const atr=S.mem.atr.length?S.mem.atr[S.mem.atr.length-1]:computeATR(S.ph);
  const ph=S.ph;

  // Identify recent swing highs/lows from price history
  const swingHighs=[], swingLows=[];
  const window=Math.max(30,ph.length);
  for(let i=3;i<ph.length-3;i++){
    const seg=ph.slice(i-3,i+4);
    if(ph[i]===Math.max(...seg)&&ph[i]>price+atr*0.3) swingHighs.push(ph[i]);
    if(ph[i]===Math.min(...seg)&&ph[i]<price-atr*0.3) swingLows.push(ph[i]);
  }

  // Cluster nearby levels
  function cluster(levels,radius){
    const sorted=[...new Set(levels.map(l=>Math.round(l)))].sort((a,b)=>a-b);
    const out=[];
    let group=[sorted[0]];
    for(let i=1;i<sorted.length;i++){
      if(sorted[i]-sorted[i-1]<radius) group.push(sorted[i]);
      else{ out.push(Math.round(group.reduce((a,b)=>a+b)/group.length)); group=[sorted[i]]; }
    }
    if(group.length) out.push(Math.round(group.reduce((a,b)=>a+b)/group.length));
    return out;
  }

  const sellLevels=cluster(swingHighs,atr*0.5).filter(l=>l>price).sort((a,b)=>a-b);
  const buyLevels=cluster(swingLows,atr*0.5).filter(l=>l<price).sort((a,b)=>b-a);

  // Build zones from swing levels (±ATR*0.3 around each swing)
  ZONES.sell=sellLevels.slice(0,4).map((l,i)=>({
    lo:l,hi:l+atr*0.3,mid:l,strength:10-i*2,type:'SWING_HIGH',tf:i===0?'H4':'H1',idx:i
  }));
  ZONES.buy=buyLevels.slice(0,4).map((l,i)=>({
    lo:l-atr*0.3,hi:l,mid:l,strength:10-i*2,type:'SWING_LOW',tf:i===0?'H4':'H1',idx:i
  }));

  // Add FVG zones from structure
  STRUCTURE.fvgs.forEach(f=>{
    if(f.type==='BEARISH'&&f.hi>price) ZONES.sell.push({lo:f.lo,hi:f.hi,mid:(f.lo+f.hi)/2,strength:8,type:'FVG',tf:f.tf});
    if(f.type==='BULLISH'&&f.lo<price) ZONES.buy.push({lo:f.lo,hi:f.hi,mid:(f.lo+f.hi)/2,strength:8,type:'FVG',tf:f.tf});
  });

  // Sort and pick primaries
  ZONES.sell.sort((a,b)=>a.lo-b.lo);
  ZONES.buy.sort((a,b)=>b.hi-a.hi);
  ZONES.sell1=ZONES.sell[0]||null;
  ZONES.sell2=ZONES.sell[1]||null;
  ZONES.buy1=ZONES.buy[0]||null;
  ZONES.buy2=ZONES.buy[1]||null;
}

// ═══════════════════════════════════════════════════════════
// MACRO STATE
// ═══════════════════════════════════════════════════════════
function computeMacroState(){
  const dxy=S.dxy.price,yld=S.yield.price,vix=S.vix.price||20;
  const dxyBear=S.dxy.ch<0, yldFall=S.yield.ch<0;
  const rateYieldBull=yldFall&&dxyBear, rateYieldBear=!yldFall&&!dxyBear;
  const vixBull=vix>=20;
  const macroScore=(rateYieldBull?3:0)+(vixBull?2:0)+(dxyBear?2:0)+(yldFall?2:0)+(S.oil.ch>0?1:0);
  S.macroState={dxyBear,yldFall,vixBull,rateYieldBull,rateYieldBear,macroScore,
    inflationRegime:vix>25?'HIGH':'MODERATE',rateCycle:yldFall?'CUTTING':'HOLDING'};
  return S.macroState;
}

// ═══════════════════════════════════════════════════════════
// BRAIN SIGNAL — Unified decision engine
// ═══════════════════════════════════════════════════════════
function runBrainSignal(){
  const price=S.gold.price; if(!price) return;
  computeMacroState();

  const ms=S.macroState;
  const adx=STRUCTURE.adx;
  const smc=STRUCTURE.smcScore; // 0-10, high = bearish
  const atr=S.mem.atr.length?S.mem.atr[S.mem.atr.length-1]:15;
  const vol=S.vh.length>1?S.vh[S.vh.length-1]/(S.vh.reduce((a,b)=>a+b)/S.vh.length):1;

  // Macro alignment
  const macroSell=ms.macroScore<=4&&!ms.rateYieldBull;
  const macroBuy=ms.macroScore>=7&&ms.rateYieldBull;

  // Structure alignment
  const structSell=STRUCTURE.bos==='DOWN'||adx.signal==='SELL';
  const structBuy=STRUCTURE.bos==='UP'||adx.signal==='BUY';

  // Zone proximity
  const nearSell=ZONES.sell1&&Math.abs(price-ZONES.sell1.lo)<atr*1.5;
  const nearBuy=ZONES.buy1&&Math.abs(price-ZONES.buy1.hi)<atr*1.5;

  // Sweep confirmation
  const sweepSell=STRUCTURE.liqSweep?.type==='BSL';
  const sweepBuy=STRUCTURE.liqSweep?.type==='SSL';

  // Check scores
  let sellScore=0, buyScore=0;
  if(macroSell) sellScore+=2;
  if(structSell) sellScore+=2;
  if(nearSell) sellScore+=2;
  if(sweepSell) sellScore+=2;
  if(adx.adx>25) sellScore+=1;
  if(vol<0.8) sellScore+=1;

  if(macroBuy) buyScore+=2;
  if(structBuy) buyScore+=2;
  if(nearBuy) buyScore+=2;
  if(sweepBuy) buyScore+=2;
  if(adx.adx>25) buyScore+=1;
  if(vol>1.3) buyScore+=1;

  const direction=sellScore>buyScore&&sellScore>=4?'SELL':buyScore>sellScore&&buyScore>=4?'BUY':'WAIT';
  const rawConf=direction==='SELL'?sellScore:direction==='BUY'?buyScore:0;
  const conf=Math.min(98,Math.max(30,rawConf*10+(adx.strength*2)));

  // Checks
  const checks={
    macro:macroSell||macroBuy,
    liq:nearSell||nearBuy||!!STRUCTURE.liqSweep,
    struct:!!STRUCTURE.bos||!!STRUCTURE.choch,
    sess:S.session.inKZ,
    ai:conf>60,
    vol:vol>1.2||vol<0.8,
  };

  // Grade
  const grade=conf>80?'A':conf>65?'B':'C';
  const state=adx.adx>30?'TRENDING':adx.adx>20?'DEVELOPING':'RANGING';
  const bias=direction==='SELL'||STRUCTURE.choch==='BEARISH'||STRUCTURE.bos==='DOWN'?'BEARISH':
              direction==='BUY'||STRUCTURE.choch==='BULLISH'||STRUCTURE.bos==='UP'?'BULLISH':'NEUTRAL';

  S.brain={direction,conf,grade,state,bias,checks,sellScore,buyScore};

  // Compute TP/SL from live zones
  if(direction==='SELL'&&ZONES.sell1){
    const entry=Math.round(price);
    const sl=Math.round(ZONES.sell1.hi+atr*0.3);
    const risk=sl-entry;
    S.tradeSetup={entry,sl,tp1:Math.round(entry-risk*1.2),tp2:Math.round(entry-risk*2),tp3:Math.round(entry-risk*3.2),direction};
  } else if(direction==='BUY'&&ZONES.buy1){
    const entry=Math.round(price);
    const sl=Math.round(ZONES.buy1.lo-atr*0.3);
    const risk=entry-sl;
    S.tradeSetup={entry,sl,tp1:Math.round(entry+risk*1.2),tp2:Math.round(entry+risk*2),tp3:Math.round(entry+risk*3.2),direction};
  } else {
    S.tradeSetup=null;
  }
}

// ═══════════════════════════════════════════════════════════
// POSITION SIZING
// ═══════════════════════════════════════════════════════════
function runPositionSize(){
  const acct=S.equity; if(!acct||!S.tradeSetup) return;
  const ts=S.tradeSetup;
  const riskAmt=acct*(S.riskPct/100);
  const slPts=Math.abs(ts.sl-ts.entry);
  const pipVal=0.054;
  const lot=slPts>0?Math.max(0.01,Math.round(riskAmt/(slPts*pipVal*100)*100)/100):0;
  S.posSize={lot,riskAmt,slPts,maxLoss:riskAmt};
}
function onAccountChange(v){
  const a=parseFloat(v)||0;
  S.equity=a; if(a>S.peakEquity) S.peakEquity=a;
  runPositionSize(); renderTradeCard();
  try{ localStorage.setItem('nexus_equity',a); }catch(e){}
}

// ═══════════════════════════════════════════════════════════
// SENTIMENT GAUGE (canvas)
// ═══════════════════════════════════════════════════════════
function renderSentGauge(score){
  const canvas=el('sentCanvas'); if(!canvas) return;
  const W=160,H=90;
  canvas.width=W*2; canvas.height=H*2; canvas.style.width=W+'px'; canvas.style.height=H+'px';
  const ctx=canvas.getContext('2d'); ctx.scale(2,2);
  ctx.clearRect(0,0,W,H);
  const cx=W/2, cy=H-10, r=70;

  // Background arc (rainbow gradient)
  const grad=ctx.createLinearGradient(0,0,W,0);
  grad.addColorStop(0,'#ef4444'); grad.addColorStop(0.3,'#f59e0b');
  grad.addColorStop(0.5,'#6b7280'); grad.addColorStop(0.7,'#22c55e'); grad.addColorStop(1,'#22c55e');
  ctx.beginPath(); ctx.arc(cx,cy,r,Math.PI,0,false);
  ctx.lineWidth=14; ctx.strokeStyle=grad; ctx.stroke();

  // Needle
  const norm=(score+100)/200; // 0-1
  const angle=Math.PI*(1-norm);
  const nx=cx+Math.cos(angle)*(r-8), ny=cy-Math.sin(angle)*(r-8);
  ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(nx,ny);
  ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.lineCap='round'; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx,cy,5,0,Math.PI*2);
  ctx.fillStyle='#fff'; ctx.fill();
}

// ═══════════════════════════════════════════════════════════
