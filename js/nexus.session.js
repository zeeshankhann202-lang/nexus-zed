// NEXUS ZED — Session Engine (PKT base, extended by v5.6)

function getPKT(){ return new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Karachi'})); }
function pktStr(){ return getPKT().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'}); }

// ═══════════════════════════════════════════════════════════
// SESSION ENGINE
// ═══════════════════════════════════════════════════════════
function computeSession(){
  const pkt=getPKT();
  const h=pkt.getHours(), m=pkt.getMinutes();
  const mins=h*60+m;
  let name,quality,color;
  if(mins>=0&&mins<540){name='Tokyo';quality=0.7;color='var(--blue)';}
  else if(mins>=720&&mins<900){name='London';quality=1.2;color='var(--gold)';}
  else if(mins>=900&&mins<960){name='Overlap';quality:1.5;color='var(--piv)';}
  else if(mins>=1050&&mins<1260){name='New York';quality=1.3;color='var(--gold2)';}
  else{name='Off-hours';quality:0.5;color='var(--t3)';}
  const inKZ=(mins>=780&&mins<=960)||(mins>=1110&&mins<=1290);
  S.session={...S.session,name,quality,inKZ,color,pkt};
  return S.session;
}

// ═══════════════════════════════════════════════════════════
// DATA FEEDS — FULL WATERFALL (ported from v4)
// ═══════════════════════════════════════════════════════════
