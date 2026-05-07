/* ===========================================================================
   ERP CONSOLE — UNIFIED FRONTEND
   Merges: ZKTeco Attendance Dashboard + AD Console (Google Apps Script)
   Backend A: Local Python/Flask ZKTeco server (http://HOST:5000)
   Backend B: Google Apps Script Web App
   Auth: ZK server primary (badge = username, badge = default password)
         GAS secondary (admin accounts), Demo mode fallback
=========================================================================== */

// -- CONFIG & STATE ----------------------------------------------------------
const CFG = {
  get zkUrl(){
    const sv=ls('zkUrl')||'';
    const bad=sv.includes('localhost')||sv.includes('127.0.0.1');
    const real=!window.location.hostname.includes('localhost')&&!window.location.hostname.includes('127.0.0.1');
    if(!sv||(bad&&real))return window.location.origin;
    return sv.replace(/\/$/,'');
  },
  get gasUrl(){ return ls('gasUrl')||''; },
  get gasEmail(){ return ls('gasEmail')||''; },
  get gasPass(){ return ls('gasPass')||''; },
  get termWsUrl(){ return ls('termWsUrl')||''; },
  get company(){ return ls('company')||'ERP Console'; },
  get domain(){ return ls('domain')||'company.local'; },
  get logoEmoji(){ return ls('logoEmoji')||'🏢'; },
  get theme(){ return ls('theme')||'dark'; },
  get layout(){ return ls('layout')||'default'; },
  get font(){ return ls('font')||'default'; },
  get glass(){ return ls('glass')==='true'; },
};

(function initAesthetics(){
  document.body.setAttribute('data-layout', CFG.layout);
  document.body.setAttribute('data-font', CFG.font);
  document.body.setAttribute('data-glass', CFG.glass);
})();

let STATE = {
  user: null,          // {username, name, role, badge, permissions, theme}
  token: null,         // GAS session token
  isDemo: false,
  isAdmin: false,
  todayData: null,
  empList: [],
  adUsers: [],
  tickets: [],
  counters: [],
  allAudit: [],
  calData: null,
  roles: [],
  currentPage: 'dashboard',

  driveFolderId: null,
  selectedEmp: null,
  selectedUser: null,
  selectedTicket: null,
  deletingUser: null,
};

const PERM_DEFS = [
  {id:'attendance',label:'Attendance & History',icon:'📅',group:'Core'},
  {id:'people',label:'Employees & Departments',icon:'👥',group:'Core'},
  {id:'devices',label:'Devices & Hardware',icon:'📡',group:'Infrastructure'},
  {id:'reports',label:'Export Reports',icon:'⬇',group:'Reports'},
  {id:'users',label:'System Users',icon:'🔐',group:'Admin'},
  {id:'audit',label:'Audit Log',icon:'📋',group:'Admin'},
  {id:'storage',label:'Drive Storage',icon:'🖴',group:'Admin'},
  {id:'tokens',label:'Token Counters',icon:'🎟',group:'Services'},
  {id:'tickets',label:'Helpdesk Tickets',icon:'🎫',group:'Services'},
];

const DEMO_EMPLOYEES = [
  {code:'1001',name:'Ahmed Al Rashid',dept:'ADMIN',active:1},
  {code:'1002',name:'Priya Nair',dept:'ADMIN',active:1},
  {code:'1003',name:'Mohammed Hassan',dept:'SUPPORT',active:1},
  {code:'1004',name:'Sarah Johnson',dept:'TEACHING',active:1},
  {code:'1005',name:'Rajan Patel',dept:'TEACHING',active:1},
  {code:'1006',name:'Fatima Al Zahra',dept:'TEACHING',active:1},
  {code:'1007',name:'Ali Hassan',dept:'DRIVER',active:1},
  {code:'1008',name:'Suresh Kumar',dept:'CLEANING STAFF',active:1},
  {code:'1673',name:'Aman P Faizal',dept:'ADMIN',active:1},
];
const DEMO_ABSENT = ['1003','1005','1008'];
const DEMO_PRESENT = ['1001','1002','1004','1006','1007','1673'];
const DEMO_TICKETS = [
  {id:'TCK-2026-0001',title:'Printer offline in Admin block',priority:'High',status:'Open',requesterName:'Ahmed Al Rashid',assignedTo:'Unassigned',dueTime:new Date(Date.now()-3600000).toISOString(),desc:'Canon printer not responding.'},
  {id:'TCK-2026-0002',title:'Email password reset required',priority:'Medium',status:'Resolved',requesterName:'Sarah Johnson',assignedTo:'admin',dueTime:new Date(Date.now()+3600000).toISOString(),desc:'Cannot login to email.'},
  {id:'TCK-2026-0003',title:'New laptop setup needed',priority:'Low',status:'Open',requesterName:'Mohammed Hassan',assignedTo:'Unassigned',dueTime:new Date(Date.now()+86400000).toISOString(),desc:'New hire needs laptop configured.'},
];
const DEMO_COUNTERS = [
  {id:'demo-c1',name:'Registration',value:14,prefix:'A',key:''},
  {id:'demo-c2',name:'Medical',value:7,prefix:'B',key:''},
  {id:'demo-c3',name:'Finance',value:3,prefix:'C',key:''},
];
const DEMO_DEVICES = [
  {ip:'10.20.141.21',name:'Main Gate',online:true,punches_today:45,serialno:'ABC123',platform:'ZK-K40',user_count:210},
  {ip:'10.20.141.22',name:'Admin Block',online:true,punches_today:28,serialno:'ABC124',platform:'ZK-F18',user_count:198},
  {ip:'10.20.141.23',name:'Teaching Block',online:false,punches_today:0,error:'Connection refused',serialno:'—',platform:'—',user_count:0},
];

// -- HELPERS -----------------------------------------------------------------
function ls(k){return localStorage.getItem('erp_'+k)}
// Auto-clear stale localhost URL if we're on a real IP
(function(){
  const saved = localStorage.getItem('erp_zkUrl')||'';
  const onReal = !window.location.hostname.includes('localhost') && !window.location.hostname.includes('127.0.0.1');
  if(saved && (saved.includes('localhost')||saved.includes('127.0.0.1')) && onReal){
    localStorage.removeItem('erp_zkUrl');
  }
})();
function lset(k,v){localStorage.setItem('erp_'+k,v)}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function fmtTime(v){if(!v)return'—';const s=String(v);if(/^\d{1,2}:\d{2}(:\d{2})?$/.test(s.trim()))return s.trim();try{const d=new Date(s);if(isNaN(d.getTime()))return s;return d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}catch{return s}}
function fmtDate(iso){if(!iso)return'—';try{return new Date(iso).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}catch{return iso}}
function fmtDateTime(iso){if(!iso)return'—';try{return new Date(iso).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}catch{return iso}}
function spin(on){document.getElementById('spinner').classList.toggle('on',on)}
function toast(msg,dur=2800){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('visible');clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('visible'),dur)}
function openModal(id){document.getElementById(id).classList.add('open')}
function closeModal(id){document.getElementById(id).classList.remove('open')}
function tryJ(s){try{return JSON.parse(s)}catch{return null}}
function can(perm){
  if(!STATE.user)return false;
  if(STATE.user.role==='admin')return true;
  if(STATE.isDemo)return true;
  const p=STATE.user.permissions||{};
  return p[perm]===true||Array.isArray(p)&&p.includes(perm);
}
function el(id){return document.getElementById(id)}

// -- SETTINGS ----------------------------------------------------------------
function applyBranding(){
  const co=CFG.company,em=CFG.logoEmoji,dom=CFG.domain;
  document.title=co+' — ERP';
  if(el('loginLogoIcon'))el('loginLogoIcon').textContent=em;
  if(el('loginCompanyName'))el('loginCompanyName').textContent=co;
  if(el('loginDomainLabel'))el('loginDomainLabel').textContent=dom;
  if(el('loginServerUrl'))el('loginServerUrl').textContent=CFG.zkUrl||'';
  el('hLogoIcon').textContent=em;
  el('hCompanyName').textContent=co;
  el('hDomain').textContent=dom;
  el('sCompanyName').value=co;
  el('sDomain').value=dom;
  el('sLogoEmoji').value=em;
  el('sZkUrl').value=CFG.zkUrl;
  el('sGasUrl').value=CFG.gasUrl||'';
  if(el('sGasEmail'))el('sGasEmail').value=CFG.gasEmail||'';
  if(el('sGasPass')&&CFG.gasPass)el('sGasPass').value='••••••••';
  if(el('sTermWsUrl'))el('sTermWsUrl').value=CFG.termWsUrl||'';

  if(el('sLayoutStyle'))el('sLayoutStyle').value=CFG.layout;
  if(el('sFontFamily'))el('sFontFamily').value=CFG.font;
  if(el('sGlass'))el('sGlass').checked=CFG.glass;
  el('qsCompany').value=co;
  el('qsDomain').value=dom;
  el('qsZkUrl').value=CFG.zkUrl;
  el('qsGasUrl').value=CFG.gasUrl||'';
  if(el('qsGasEmail'))el('qsGasEmail').value=CFG.gasEmail||'';
  if(el('qsGasPass'))el('qsGasPass').value=CFG.gasPass||'';
}
async function saveSettings(){
  const co=el('sCompanyName').value||'ERP Console';
  const dom=el('sDomain').value||'company.local';
  let logoStr=el('sLogoEmoji').value||'🏢';
  const logoFile=el('sLogoFile') ? el('sLogoFile').files[0] : null;

  const zkUrl = el('sZkUrl').value || 'http://localhost:5000';
  const gasUrl = el('sGasUrl').value || '';
  const gasEmail = el('sGasEmail') ? el('sGasEmail').value.trim() : '';
  const termWsUrl = el('sTermWsUrl') ? el('sTermWsUrl').value.trim() : '';

  lset('zkUrl', zkUrl);
  lset('gasUrl', gasUrl);
  if(el('sGasEmail') && el('sGasEmail').value) lset('gasEmail', el('sGasEmail').value.trim());
  if(el('sGasPass') && el('sGasPass').value && el('sGasPass').value !== '••••••••') lset('gasPass', el('sGasPass').value);
  if(el('sTermWsUrl') && el('sTermWsUrl').value) lset('termWsUrl', el('sTermWsUrl').value.trim());

  if (logoFile) {
    logoStr = await new Promise(r => {
      const rd = new FileReader();
      rd.onload = e => r(e.target.result);
      rd.readAsDataURL(logoFile);
    });
  }

  const payload = {
    company_name: co,
    email_domain: dom,
    company_logo: logoStr,
    gas_url:      gasUrl,
    gas_email:    gasEmail,
    zk_url:       zkUrl,
    term_ws_url:  termWsUrl,
  };
  // Only include GAS password if a real value is typed (not placeholder)
  const gasPass = el('sGasPass') ? el('sGasPass').value : '';
  if (gasPass && gasPass !== '••••••••') payload.gas_pass = gasPass;

  try {
    const res = await zkAPI('/api/settings/system', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    // zkAPI returns parsed JSON body; treat any successful response (no throw) as saved
    lset('company',co);
    lset('domain',dom);
    lset('logoEmoji',logoStr);
    applyBranding();
    toast('✅ Settings saved to server');
  } catch(e) {
    // Fallback
    lset('company',co);
    lset('domain',dom);
    lset('logoEmoji',logoStr);
    applyBranding();
    toast('⚠ Saved locally: ' + e.message);
  }
}

async function loadSystemSettings() {
  try {
    const sys = await zkAPI('/api/settings/system');
    if (sys.company_name) lset('company', sys.company_name);
    if (sys.email_domain) lset('domain', sys.email_domain);
    if (sys.company_logo) lset('logoEmoji', sys.company_logo);
    // Restore GAS credentials from server-side backup
    if (sys.gas_url)   lset('gasUrl',   sys.gas_url);
    if (sys.gas_email) lset('gasEmail', sys.gas_email);
    if (sys.gas_pass)  lset('gasPass',  sys.gas_pass);
    if (sys.zk_url)    lset('zkUrl',    sys.zk_url);
    if (sys.term_ws_url) lset('termWsUrl', sys.term_ws_url);
    applyBranding();
  } catch(e) {}
}

async function saveEmailSettings() {
  const pass = el('ePass').value.trim();
  const payload = {
    enabled:     el('eEnabled').checked,
    smtp_host:   el('eSmtp').value.trim() || 'smtp.gmail.com',
    smtp_port:   parseInt(el('ePort').value) || 465,
    sender:      el('eFrom').value.trim().replace(/[\[\]'"]/g, ''),
    sender_name: el('eSenderName').value.trim(),
    send_hour:   parseInt(el('eHour').value) || 9,
    send_minute: parseInt(el('eMin').value) || 30,
    recipients:  el('eRecips').value.replace(/[\[\]'"]/g, '').trim()
  };
  // Only send password if it's a real new value (not blank or masked)
  if (pass && pass !== '********' && !pass.includes('•')) {
    payload.app_password = pass;
  }
  try {
    const res = await zkAPI('/api/settings/email', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    // zkAPI returns parsed JSON; treat any non-throwing response as saved
    toast('✅ Email settings saved!');
    el('emailTestResult').textContent = '✅ Saved successfully';
    el('emailTestResult').style.color = 'var(--green)';
  } catch (e) {
    el('emailTestResult').textContent = '❌ Save failed: ' + e.message;
    el('emailTestResult').style.color = 'var(--red)';
  }
}

async function loadEmailSettings() {
  try {
    const d = await zkAPI('/api/settings/email');
    if (d) {
      el('eEnabled').checked = !!d.enabled;
      el('eSmtp').value = d.smtp_host || 'smtp.gmail.com';
      el('ePort').value = d.smtp_port || 465;
      el('eFrom').value = d.sender || '';
      el('eSenderName').value = d.sender_name || '';
      if(d.app_password) el('ePass').value = '********';
      el('eHour').value = d.send_hour ?? '';
      el('eMin').value = d.send_minute ?? '';
      el('eRecips').value = d.recipients || '';
    }
  } catch(e) {}
}

async function testEmailConfig() {
  const d = el('eTestDate').value;
  el('emailTestResult').textContent = 'Sending...';
  el('emailTestResult').style.color = 'var(--text2)';
  try {
    const res = await zkAPI('/api/settings/email/test', {
      method: 'POST', body: JSON.stringify(d ? { date: d } : {})
    });
    el('emailTestResult').textContent = '✅ ' + (res.message || 'Success');
    el('emailTestResult').style.color = 'var(--green)';
  } catch(e) {
    el('emailTestResult').textContent = '❌ Failed: ' + e.message;
    el('emailTestResult').style.color = 'var(--red)';
  }
}
function quickSaveSettings(){
  if(el('qsGasEmail')&&el('qsGasEmail').value)lset('gasEmail',el('qsGasEmail').value.trim());
  const qsRawPass=(el('qsGasPass')&&el('qsGasPass').value||'').trim();
  if(qsRawPass)lset('gasPass',qsRawPass);
  lset('company',el('qsCompany').value||'ERP Console');
  lset('domain',el('qsDomain').value||'company.local');
  lset('zkUrl',el('qsZkUrl').value||'http://localhost:5000');
  lset('gasUrl',el('qsGasUrl').value||'');
  // Also persist GAS credentials and URLs to server so they survive browser/session resets
  const qsPayload={
    company_name:el('qsCompany').value||'ERP Console',
    email_domain:el('qsDomain').value||'company.local',
    gas_url:el('qsGasUrl').value||'',
    zk_url:el('qsZkUrl').value||'',
  };
  const qsEmail=(el('qsGasEmail')?.value||'').trim();
  if(qsEmail)qsPayload.gas_email=qsEmail;
  if(qsRawPass)qsPayload.gas_pass=qsRawPass;
  zkAPI('/api/settings/system',{method:'POST',body:JSON.stringify(qsPayload)}).catch(e=>console.warn('[Settings] Server persist failed:',e.message));
  applyBranding();
  closeModal('settingsModal');
  toast('✅ Settings saved');
}
function openSettings(){openModal('settingsModal')}
async function testZkServer(){
  const url=el('sZkUrl').value||CFG.zkUrl;
  el('zkTestResult').textContent='Testing...';
  try{
    const r=await fetch(url+'/api/auth/me',{credentials:'include'});
    el('zkTestResult').textContent=r.ok?'✅ Connected to ZKTeco server':'⚠ Server reachable but returned '+r.status;
    el('zkTestResult').style.color=r.ok?'var(--green)':'var(--yellow)';
  }catch(e){
    el('zkTestResult').textContent='❌ Cannot reach server: '+e.message;
    el('zkTestResult').style.color='var(--red)';
  }
}
async function testGasServer(){
  const url=el('sGasUrl').value||CFG.gasUrl;
  if(!url){el('gasTestResult').textContent='⚠ No GAS URL configured';return}
  el('gasTestResult').textContent='Testing...';
  try{
    const r=await fetch(url,{method:'POST',body:new URLSearchParams({action:'login',email:'test',password:'test'})});
    const t=await r.text();
    const gasOk=t.includes('Invalid')||t.includes('credentials')||t.includes('error')||t.includes('token');
    el('gasTestResult').textContent=gasOk?'✅ GAS reachable (server responding)':'⚠ Unexpected response: '+t.substring(0,40);
    el('gasTestResult').style.color=gasOk?'var(--green)':'var(--yellow)';
  }catch(e){
    el('gasTestResult').textContent='❌ Cannot reach GAS: '+e.message;
    el('gasTestResult').style.color='var(--red)';
  }
}
function valLayout(v){ lset('layout', v); document.body.setAttribute('data-layout', v); }
function valFont(v){ lset('font', v); document.body.setAttribute('data-font', v); }
function valGlass(v){ lset('glass', !!v); document.body.setAttribute('data-glass', !!v); }

// Themes that map to a light background (used for syncing embedded AD app)
const LIGHT_THEMES = ['light', 'cream', 'grey', 'rose', 'slate'];

function setTheme(t){
  lset('theme',t);
  document.documentElement.setAttribute('data-theme',t);
  document.querySelectorAll('.theme-btn').forEach(b=>b.classList.remove('active'));
  // Mark active in settings palette
  const btn = document.getElementById(t+'ThemeBtn');
  if(btn) btn.classList.add('active');
  // Mark active in header picker
  const pbtn = document.getElementById('tp-'+t+'ThemeBtn');
  if(pbtn) pbtn.classList.add('active');
  // Sync the embedded AD app's data-theme so it matches the global theme
  const adApp = document.getElementById('ad-app');
  if(adApp) adApp.setAttribute('data-theme', LIGHT_THEMES.includes(t) ? 'light' : 'dark');
}
function toggleTheme(){setTheme(document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark')}
function toggleThemePicker(){
  const p=document.getElementById('themePicker');
  if(!p) return;
  p.style.display=p.style.display==='none'?'block':'none';
}
document.addEventListener('click',function(e){
  const p=document.getElementById('themePicker');
  const btn=document.getElementById('themeBtn');
  if(p&&btn&&!p.contains(e.target)&&e.target!==btn) p.style.display='none';
});

window.termIframeLoaded = function() { console.log('Terminal iframe loaded'); };
window.termIframeError = function() { console.warn('Terminal iframe error'); };

// -- ZK API ------------------------------------------------------------------
async function zkAPI(path,opts={}){
  const url=CFG.zkUrl+path;
  const method=(opts.method||'GET').toUpperCase();
  const isWrite=['POST','PUT','PATCH','DELETE'].includes(method);
  const hasBody='body' in opts && opts.body!=null;
  const hdrs=(isWrite&&hasBody)?{'Content-Type':'application/json',...(opts.headers||{})}:(opts.headers||{});
  const r=await fetch(url,{credentials:'include',...opts,headers:hdrs});
  if(!r.ok){
    let msg='ZK API '+r.status+' on '+path;
    try{const j=await r.clone().json();msg=j.error||j.message||msg;}catch{}
    throw new Error(msg);
  }
  return r.json();
}
async function zkAPIRaw(path,opts={}){
  return fetch(CFG.zkUrl+path,{credentials:'include',...opts});
}

// -- GAS API -----------------------------------------------------------------
const _gasCache = new Map();

async function gasAPI(params){
  const url=CFG.gasUrl;
  if(!url)throw new Error('GAS URL not configured. Go to Settings and enter your Apps Script URL.');

  // Cache GET-like requests (compute key before adding token so cache is token-agnostic)
  const cacheKey = JSON.stringify(params);
  const isCacheable = ['getTickets', 'getCounters', 'getFiles', 'getUsers'].includes(params.action);
  if (isCacheable && _gasCache.has(cacheKey)) {
     const cached = _gasCache.get(cacheKey);
     if (Date.now() - cached.ts < 300000) return cached.data; // 5 min cache
  }

  // Build payload without mutating the original params object
  const payload = STATE.token ? {...params, token: STATE.token} : {...params};
  const r=await fetch(url,{
    method:'POST',
    redirect:'follow',
    body:new URLSearchParams(payload)
  });
  const txt=await r.text();
  const parsed=tryJ(txt);
  // Surface errors clearly
  if(parsed===null&&txt)throw new Error('GAS response not JSON: '+txt.substring(0,80));
  if(typeof parsed==='string'){
    if(parsed==='Unauthorized') {
      // Stale token — clear it so subsequent calls don't keep sending it
      STATE.token=null; lset('gasToken','');
      console.warn('GAS: Not authenticated. Re-login or check GAS URL.');
      return {error: 'Unauthorized'};
    }
    if(parsed.includes('Invalid')) { console.warn('GAS: Invalid credentials'); return {error: 'Invalid credentials'}; }
    if(parsed.includes('Error')) { console.warn('GAS: '+parsed.substring(0,100)); return {error: parsed}; }
  }

  if (isCacheable) _gasCache.set(cacheKey, { ts: Date.now(), data: parsed });
  return parsed;
}

// Try GAS login silently in background (called after ZK login succeeds)

// Auto-fill employee info from ZK database when badge is typed
let _empBadgeTimer=null;
let _msgPollTimer=null;
function autoFillFromBadge(val){
  const hint=el('uBadgeLookupResult');
  if(!val||val.length<1){if(hint)hint.textContent='';return}
  const v=val.trim();
  // Exact match first
  const emp=STATE.empList.find(e=>(e.code||e.badge||'')==v||(e.name||'').toLowerCase()===v.toLowerCase());
  if(emp){
    if(el('uName'))el('uName').value=emp.name||'';
    if(el('uDept'))el('uDept').value=emp.dept||'';
    if(el('uRole')&&!el('uRole').value)el('uRole').value='employee';
    if(hint){hint.textContent='✔ Linked: '+emp.name+' · '+emp.dept;hint.style.color='var(--green)';}
    return;
  }
  // Fuzzy: starts with badge code OR name contains
  const fuzzy=STATE.empList.filter(e=>{
    const code=(e.code||e.badge||'');
    return code.startsWith(v)||(e.name||'').toLowerCase().includes(v.toLowerCase());
  });
  // Always refresh datalist with fuzzy results
  const dl=el('empBadgeSuggest');
  if(dl)dl.innerHTML=fuzzy.slice(0,15).map(e=>`<option value="${esc(e.code||e.badge)}">${esc(e.name)} (${esc(e.dept)})</option>`).join('');
  if(hint){
    hint.textContent=fuzzy.length?fuzzy.length+' match(es) — select from dropdown':'Not found in ZK database';
    hint.style.color=fuzzy.length?'var(--text2)':'var(--yellow)';
  }
}
// Populate datalist on modal open
function populateEmpSuggest(){
  const dl=el('empBadgeSuggest');
  if(!dl)return;
  dl.innerHTML=STATE.empList.map(e=>`<option value="${esc(e.code||e.badge)}">${esc(e.name)} (${esc(e.dept)})</option>`).join('');
}

async function connectGAS(){
  const res=el('gasConnectResult');
  const email=(el('sGasEmail')&&el('sGasEmail').value||'').trim();
  const rawPass=(el('sGasPass')&&el('sGasPass').value||'').trim();
  // If the field shows the masked placeholder, use the stored real pass instead
  const isMasked=(rawPass==='\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022'||rawPass==='********');
  const pass=isMasked?CFG.gasPass:rawPass;

  // Save URL to localStorage immediately; CFG.gasUrl is a getter on localStorage so it reflects this at once
  const gasUrlVal=(el('sGasUrl').value||'').trim();
  if(gasUrlVal)lset('gasUrl',gasUrlVal);

  if(!CFG.gasUrl){if(res){res.textContent='Enter GAS URL first';res.style.color='var(--red)'}return}
  if(res){res.textContent='Connecting...';res.style.color='var(--text2)'}

  if(!email){
    try{
      const d=await gasAPI({action:'getDashboard'});
      if(d&&(d.users||d.tickets)){if(res){res.textContent='Connected (no auth)';res.style.color='var(--green)';}loadTickets();loadCounters();return}
    }catch(e){}
    if(res){res.textContent='Enter email + password';res.style.color='var(--yellow)'}return;
  }

  // Guard: password must be resolved before attempting login
  if(!pass){
    if(res){
      res.textContent=isMasked?'Stored password missing — re-enter your GAS password and try again':'Enter your GAS password';
      res.style.color='var(--yellow)';
    }
    // Clear any stale stored password so the user can type a fresh one
    if(isMasked){lset('gasPass','');if(el('sGasPass'))el('sGasPass').value='';}
    return;
  }

  // Clear any stale session token before a fresh login
  STATE.token=null;

  // Persist credentials up-front so tryGASLogin can use them after ZK auth
  lset('gasEmail',email);
  lset('gasPass',pass);

  try{
    const d=await gasAPI({action:'login',email,password:pass});
    if(d&&d.token){
      STATE.token=d.token;
      lset('gasToken', d.token);
      // Persist credentials to server DB so they survive page refreshes and session loss
      zkAPI('/api/settings/system',{method:'POST',body:JSON.stringify({gas_email:email,gas_pass:pass})}).catch(e=>console.warn('[GAS] Credential persist failed:',e.message));
      if(res){res.textContent='Connected as '+email+' ['+d.role+']';res.style.color='var(--green)';}
      if(el('gasStatusDot'))el('gasStatusDot').className='sb-dot green';
      if(el('gasStatusText'))el('gasStatusText').textContent='GAS: '+d.role;
      loadTickets();loadCounters();
      if(can('storage'))loadDrive();
      toast('GAS connected');
    }else{
      // Show specific error if available, otherwise generic message
      const errMsg=d&&d.error?d.error:'check credentials';
      if(res){res.textContent='Login failed: '+errMsg+' — verify credentials in your GAS Users sheet';res.style.color='var(--red)';}
      // If the password we tried was the masked/stored one, it's wrong — clear it
      if(isMasked){
        lset('gasPass','');
        if(el('sGasPass'))el('sGasPass').value='';
        if(res){res.textContent+=' (stored password cleared, please re-enter)';res.style.color='var(--red)';}
        // Also clear from server DB to break the restoration loop on next page reload
        _clearGASPass();
      }else{
        // Fresh-typed password was wrong — clear it from localStorage so it doesn't
        // get used by tryGASLogin on the next page load
        lset('gasPass','');
      }
    }
  }catch(e){if(res){res.textContent=e.message;res.style.color='var(--red)';}}
}

/** Clear stored GAS password from localStorage and server DB (invalid credentials). */
function _clearGASPass(){
  lset('gasPass','');
  zkAPI('/api/settings/system',{method:'POST',body:JSON.stringify({gas_pass:''})})
    .catch(e=>console.warn('[GAS] DB password clear failed:',e.message));
}

async function tryGASLogin(){
  // Always re-authenticate with stored admin GAS credentials on every page load.
  // GAS tokens expire, so restoring a stale token from localStorage causes Drive 401.
  const savedEmail = ls('gasEmail') || '';
  const savedPass  = ls('gasPass')  || '';
  if(!CFG.gasUrl || !savedEmail || !savedPass) {
    if(el('gasStatusDot'))el('gasStatusDot').className='sb-dot muted';
    if(el('gasStatusText'))el('gasStatusText').textContent='GAS: No creds';
    return;
  }
  // Always start with a clean token so the login request is not polluted by an expired one
  STATE.token=null;
  try{
    const d = await gasAPI({action:'login', email:savedEmail, password:savedPass});
    if(d && d.token){
      STATE.token = d.token;
      lset('gasToken', d.token);
      if(el('gasStatusDot'))el('gasStatusDot').className='sb-dot green';
      if(el('gasStatusText'))el('gasStatusText').textContent='GAS: '+(d.role||'Admin');
      if(can('storage'))loadDrive();
      loadTickets(); loadCounters();
      // Update the Connect GAS result display if visible
      const res=el('gasConnectResult');
      if(res){res.textContent='✅ GAS connected (auto)';res.style.color='var(--green)';}
      console.log('[GAS] Auto-login OK as', savedEmail);
    } else {
      // Token is already null; clear persisted token too
      lset('gasToken','');
      const reason = d?.error ?? 'check credentials';
      console.warn('[GAS] Login returned no token:', d);
      // If credentials are definitively wrong, clear stored password from both
      // localStorage and server DB to prevent the endless restoration loop
      if(reason && reason.includes('Invalid')){
        _clearGASPass();
        console.warn('[GAS] Cleared stored GAS password (invalid credentials)');
      }
      if(el('gasStatusDot'))el('gasStatusDot').className='sb-dot yellow';
      if(el('gasStatusText'))el('gasStatusText').textContent='GAS: '+reason;
    }
  } catch(e) {
    lset('gasToken','');
    console.warn('[GAS] Auto-login failed:', e.message);
    if(el('gasStatusDot'))el('gasStatusDot').className='sb-dot muted';
    if(el('gasStatusText'))el('gasStatusText').textContent='GAS: Offline';
  }
}

// ===========================================================================
//  AUTHENTICATION
// ===========================================================================
async function doLogin(){
  const username=(el('loginUser').value||'').trim();
  const password=el('loginPass').value||'';
  const errEl=el('loginErr');
  errEl.style.display='none';
  if(!username){errEl.textContent='Enter your Employee ID or username.';errEl.style.display='block';return}
  spin(true);

  // 1. Try ZKTeco local server
  let serverOffline = false;
  if(STATE.serverStatus === 'offline') serverOffline = true;
  if(!serverOffline){
    try{
      const r=await fetch(CFG.zkUrl+'/api/auth/login',{
        method:'POST',credentials:'include',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({username,password:password||username})
      });
      if(r.ok){
        const d=await r.json();
        if(d.ok){
          if(el('rememberMe') && el('rememberMe').checked) localStorage.setItem('rememberedUser', username);
          else localStorage.removeItem('rememberedUser');
          await onLoginSuccess({
            username:d.username,name:d.name||d.username,role:d.role||'employee',
            badge:d.badge||username,permissions:d.permissions||{},
            theme:d.theme||'dark',source:'zk'
          });
          spin(false);
          // Auto-connect to GAS
          await tryGASLogin();
          return;
        }
      }
    }catch(e){console.warn('ZK login failed:',e.message)}
  }

  // 2. Try GAS (admin accounts)
  if(CFG.gasUrl){
    try{
      const d=await gasAPI({action:'login',email:username,password:password||username});
      if(d&&d.token){
        STATE.token=d.token;
        await onLoginSuccess({
          username,name:d.email||username,role:d.role||'User',
          badge:username,permissions:d.perms||[],
          theme:'dark',source:'gas'
        });
        spin(false); return;
      }
      if(typeof d==='string'&&(d.includes('Invalid')||d.includes('disabled'))){
        errEl.textContent=d.includes('disabled')?'Account is disabled.':'Invalid credentials.';
        errEl.style.display='block';spin(false);return;
      }
    }catch(e){console.warn('GAS login failed:',e.message)}
  }

  // 3. Admin offline fallback (only if both ZK and GAS failed/unavailable)
  if (username === 'admin' && (password === 'admin' || password === 'Gaesous180')) {
     await onLoginSuccess({
        username:'admin',name:'System Admin (Offline)',role:'admin',
        badge:'admin',permissions:{},theme:CFG.theme||'dark',source:'offline'
     });
     spin(false);
     return;
  }

  errEl.textContent='Login failed. Check credentials or server connection.';
  errEl.style.display='block';
  spin(false);
}

function doDemo(){
  onLoginSuccess({
    username:'demo',name:'Demo User',role:'admin',badge:'DEMO',
    permissions:{},theme:'dark',source:'demo'
  });
  STATE.isDemo=true;
  el('demoIndicator').style.display='';
}

async function onLoginSuccess(user){
  STATE.user=user;
  STATE.isAdmin=user.role==='admin';
  STATE.isDemo=user.source==='demo';
  document.documentElement.setAttribute('data-theme',user.theme||CFG.theme);

  // Update header
  if(el('loginScreen'))el('loginScreen').style.display='none';
  el('appShell').style.display='';
  el('appShell').classList.add('visible');

  const avatars = ['👨‍💼','👩‍💼','👨‍💻','👩‍💻','🦸‍♂️','🦸‍♀️','🧙‍♂️','🧙‍♀️','🥷','🤖'];
  if(user.avatar_id) {
    el('userAvatarHdr').textContent = avatars[user.avatar_id-1] || '👨‍💼';
    el('userAvatarHdr').style.fontSize = '14px';
  } else {
    const initials=(user.name||'?').split(' ').map(w=>w[0]).join('').substring(0,2).toUpperCase();
    el('userAvatarHdr').textContent=initials;
    el('userAvatarHdr').style.fontSize = '10px';
  }
  el('userNameHdr').textContent=user.name;
  el('userRoleHdr').textContent=user.role.toUpperCase();
  el('sbUserInfo').textContent=user.role.toUpperCase()+' · '+(user.name||user.username);

  // Admin visual indicator
  if(STATE.isAdmin) {
    if(el('adminCrown')) el('adminCrown').style.display = 'inline';
    if(el('udropAdminEntry')) el('udropAdminEntry').style.display = 'block';
    el('userAvatarHdr').style.background = 'linear-gradient(135deg,var(--purple),var(--accent))';
    el('userAvatarHdr').title = 'System Admin';
  }

  applyPermissions();
  startClock();
  startCachePoll();

  // Kick off VoIP connection right after login (STATE.user is now set).
  // Small delay lets the login UI settle before the socket.io handshake begins.
  if(typeof voipInit==='function') setTimeout(voipInit, 500);

  // Load initial data based on server status
  if(STATE.serverStatus === 'offline' || user.source === 'gas') {
    let offlineBanner = document.createElement('div');
    offlineBanner.className = 'offline-banner';
    offlineBanner.style = "background:var(--red);color:#fff;padding:8px;text-align:center;font-size:12px;font-weight:bold;z-index:9999;";
    offlineBanner.innerHTML = '⚠ SERVER OFFLINE MODE — displaying GAS Helpdesk and Drive only. Database and attendance features are disabled.';
    el('appShell').insertBefore(offlineBanner, el('appShell').firstChild);
    
    ['sb-dashboard','sb-calendar','sb-history','sb-employees','sb-messages','sb-notes','sb-sql','sb-attlogs'].forEach(id=>{
      if(el(id)) el(id).style.display='none';
    });
    showPage('tickets');
    if(can('tickets'))loadTickets();
    if(can('storage'))loadDrive();
    toast('Logged in via Offline Fallback (GAS Only)', 5000);
  } else {
    // Attempt background sync of system settings over previous localStorage
    await loadSystemSettings();
    if(STATE.isAdmin) await loadEmailSettings();
    if(STATE.isAdmin) loadTelegramSettings();
    await loadDashboard();
    loadEmployees();
    if(can('tickets'))loadTickets();
    if(can('tokens'))loadCounters();
    if(typeof loadAnnouncements==='function') loadAnnouncements();
  }
}

function applyPermissions(){
  // Sidebar visibility based on role/perms
  const rules={
    'sb-employees':'users','sb-audit':'audit','sb-drive':'storage','sb-admin':'admin',
  };
  Object.entries(rules).forEach(([sid,perm])=>{
    const el2=el(sid);
    if(el2)el2.style.display=(STATE.isAdmin||can(perm))?'':'none';
  });
  if(!STATE.isAdmin){
    el('sb-admin').style.display='none';
    if(!can('audit'))el('sb-audit').style.display='none';
    if(!can('storage'))el('sb-drive').style.display='none';
    if(!can('users')){
      const sbEmp=el('sb-employees');
      if(sbEmp)sbEmp.style.display='none';
    }
    if(!can('tokens'))el('sb-counters').style.display='none';
    if(!can('tickets'))el('sb-tickets').style.display='none';
  }
  // Admin-only buttons
  document.querySelectorAll('[data-admin]').forEach(b=>{b.style.display=STATE.isAdmin?'':'none'});
}

function doLogout(){
  if(STATE.user&&STATE.user.source==='zk'){
    fetch(CFG.zkUrl+'/api/auth/logout',{method:'POST',credentials:'include'}).catch(()=>{});
  }
  STATE={...STATE,user:null,token:null,isDemo:false};
  el('appShell').classList.remove('visible');
  el('appShell').style.display='none';
  if(el('loginScreen'))el('loginScreen').style.display='flex';
  if(el('loginPass'))el('loginPass').value='';
  if(el('loginErr'))el('loginErr').style.display='none';
  el('demoIndicator').style.display='none';
  clearInterval(STATE._clockTimer);
  clearInterval(STATE._pollTimer);
  clearInterval(STATE._msgPollTimer);
  clearInterval(_msgPollTimer);
  _msgPollTimer = null;
}

// ===========================================================================
//  NAVIGATION
// ===========================================================================
function showPage(page){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.sb-item').forEach(s=>s.classList.remove('active'));
  const pg=el('page-'+page),sb=el('sb-'+page);
  if(pg)pg.classList.add('active');
  if(sb)sb.classList.add('active');
  STATE.currentPage=page;
  el('breadcrumb').innerHTML='<span>'+page.charAt(0).toUpperCase()+page.slice(1)+'</span>';
  // Lazy load
  if(page==='tickets')loadTickets();
  if(page==='counters')loadCounters();
  if(page==='today'&&!STATE.todayLoaded)loadToday();
  if(page==='employees')loadEmployees();
  if(page==='devices')loadDevices();
  if(page==='audit')loadAudit();
  if(page==='drive')loadDrive();
  if(page==='punch'){loadPunchStatus();if(STATE.isAdmin){loadApprovals();loadDeviceQueue()}}
  if(page==='admin'){loadDBStats();loadUnmapped();loadShifts();loadWorkdays();loadHolidays();loadRoles();loadSessions()}
  if(page==='history'){const now=new Date();el('histTo').valueAsDate=now;const f=new Date(now);f.setDate(f.getDate()-7);el('histFrom').valueAsDate=f;}
  if(page==='attlogs'){const now=new Date();if(el('logsTo'))el('logsTo').valueAsDate=now;const f=new Date(now);f.setDate(f.getDate()-1);if(el('logsFrom'))el('logsFrom').valueAsDate=f;loadAttLogs();}
  if(page==='terminal'){const url=_termUrl();if(url)loadTerminalFrame();else showTermSetup();}
  if(page==='sql'){/* ready */}
  if(page==='settings'){applyBranding();setTheme(CFG.theme);loadEmailSettings();loadTelegramSettings();if(typeof loadVoipSettings!=='undefined')loadVoipSettings();}
  if(page==='messages')loadMessages();
  if(page==='notes')loadNotes();
  if(page==='voip'){
    if(typeof voipInit!=='undefined')voipInit();
    if(typeof voipLoadContacts!=='undefined')voipLoadContacts();
  }
  if(_msgPollTimer){ clearInterval(_msgPollTimer); _msgPollTimer=null; }
  if(page==='messages'){
    _msgPollTimer = setInterval(()=>{ if(STATE.currentPage==='messages') loadMessages(); }, 15000);
  }
}

function userTab(idx,el2){
  document.querySelectorAll('#userModal .mtab').forEach((t,i)=>{t.classList.toggle('active',i===idx)});
  document.querySelectorAll('#userModal .mtab-pane').forEach((p,i)=>{p.classList.toggle('active',i===idx)});
}
function adminTab(tab,el2){
  document.querySelectorAll('.admin-pane').forEach(p=>p.style.display='none');
  document.querySelectorAll('.mtab').forEach(t=>t.classList.remove('active'));
  el('admin-'+tab).style.display='block';
  el2.classList.add('active');
  if(tab==='shifts')loadShifts();
  if(tab==='workdays')loadWorkdays();
  if(tab==='holidays')loadHolidays();
  if(tab==='roles')loadRoles();
  if(tab==='sessions')loadSessions();
  if(tab==='notices')loadAdminAnnouncements();
}
function toggleUserMenu(){el('userDropdown').classList.toggle('open')}
document.addEventListener('click',e=>{if(!e.target.closest('.user-pill'))el('userDropdown').classList.remove('open')});

// ===========================================================================
//  CLOCK & POLLING
// ===========================================================================
function startClock(){
  function tick(){
    const now=new Date();
    const ts=now.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    el('sbClock').textContent=ts;
    el('punchClock').textContent=ts;
    el('punchDateLabel').textContent=now.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  }
  tick();STATE._clockTimer=setInterval(tick,1000);
}
function startCachePoll(){
  STATE._pollTimer=setInterval(()=>{
    if(STATE.currentPage==='dashboard'||STATE.currentPage==='today')loadDashboard();
  },5*60*1000);
}

