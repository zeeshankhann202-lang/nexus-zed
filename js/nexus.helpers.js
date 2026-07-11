// NEXUS ZED — Core Helpers + Fallback Prices

const STALE_CACHE={};
const FALLBACK={
  gold:{price:3382,ch:0,prev:3382},
  dxy:{price:105,ch:0,prev:105},
  yield:{price:4.28,ch:0,prev:4.28},
  oil:{price:78,ch:0,prev:78},
  spx:{price:5348,ch:0,prev:5348},
  vix:{price:20,ch:0,prev:20},
};

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
const el=id=>document.getElementById(id);
const setText=(id,v)=>{ const e=el(id); if(e) e.textContent=v; };
const setStyle=(id,prop,val)=>{ const e=el(id); if(e) e.style[prop]=val; };
function setFeed(id,txt,cls){
  const e=el(id); if(!e) return;
  e.className='fs '+cls;
  e.querySelector('.fs-dot').nextSibling.textContent=' '+txt.split(':')[0];
}
function fmtPrice(p,dp=2){ return p?p.toLocaleString('en-US',{minimumFractionDigits:dp,maximumFractionDigits:dp}):'—'; }
function fmtCh(ch,dp=2){ if(ch===undefined||ch===null) return '—'; return (ch>=0?'+':'')+parseFloat(ch).toFixed(dp); }
function fmtPct(ch,base){ if(!ch||!base) return '—'; const p=(ch/base*100); return (p>=0?'+':'')+p.toFixed(2)+'%'; }


// ─── AUDIT LOG (defined early so all modules can call it) ───
const AUDIT = [];
function addAuditEntry(level, msg) {
  const ts = new Date().toLocaleTimeString('en-US', {hour:'2-digit', minute:'2-digit', second:'2-digit'});
  AUDIT.unshift({ ts, level, msg });
  if (AUDIT.length > 200) AUDIT.pop();
  // renderAuditLog called from nexus.ui.js after DOM is ready
  if (typeof renderAuditLog === "function") renderAuditLog();
}

// Flush boot audit queue
setTimeout(() => {
  if (window._auditQueue && window._auditQueue.length) {
    const q = window._auditQueue; window._auditQueue = [];
    q.forEach(e => addAuditEntry(e.level, e.msg));
  }
}, 0);


// ── renderNewsFeed alias ──────────────────────────────────
// Called by nexus.feeds.js and nexus.ui.js when calendar data arrives.
// renderDashboardNewsCard is the real implementation (defined in nexus.bayes.js).
// This alias bridges the gap so calls before bayes.js loads are safe.
function renderNewsFeed(events) {
  // Queue if bayes.js not yet loaded
  if (typeof renderDashboardNewsCard === 'function') {
    renderDashboardNewsCard();
  } else if (typeof processEconEvents === 'function' && events) {
    processEconEvents(events);
  } else if (events && events.length) {
    // Minimal fallback: populate newsDetail directly
    const det = document.getElementById('newsDetail');
    if (det) det.textContent = events[0].title + ' — ' + events[0].impact + ' impact';
    const st  = document.getElementById('newsStatus');
    if (st)  st.textContent = '📅 ' + events.length + ' events this week';
  }
}

// ── addAuditEntry boot stub ───────────────────────────────
// Queues calls made before nexus.ui.js defines the real function.
// Flushed when the real addAuditEntry is defined.
if (typeof addAuditEntry === 'undefined') {
  window._auditQueue = window._auditQueue || [];
  window.addAuditEntry = function(level, msg) {
    window._auditQueue.push({ level, msg, ts: new Date().toLocaleTimeString() });
  };
}
