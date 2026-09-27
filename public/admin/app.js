/* HALCYON 홈 서버 콘솔 — 관리자 SPA (의존성 없는 바닐라 JS) */
(() => {
'use strict';

// ------------------------------------------------------------ 유틸
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const attr = (s) => esc(s).replace(/`/g, '&#96;');
const fmtBytes = (n, d = 1) => { n = Number(n) || 0; if (n < 1024) return n + ' B'; const u = ['KB', 'MB', 'GB', 'TB', 'PB']; let i = -1; do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1); return n.toFixed(d) + ' ' + u[i]; };
const fmtRate = (n) => fmtBytes(n) + '/s';
const fmtDate = (ts) => ts ? new Date(ts).toLocaleString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const fmtTime = (ts) => ts ? new Date(ts).toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
const fmtDur = (sec) => { sec = Math.max(0, Math.floor(sec)); const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return d ? `${d}일 ${h}시간` : h ? `${h}시간 ${m}분` : m ? `${m}분 ${s}초` : `${s}초`; };
const ago = (ts) => { if (!ts) return '—'; const d = (Date.now() - ts) / 1000; if (d < 5) return '방금'; if (d < 60) return `${Math.floor(d)}초 전`; if (d < 3600) return `${Math.floor(d / 60)}분 전`; if (d < 86400) return `${Math.floor(d / 3600)}시간 전`; return `${Math.floor(d / 86400)}일 전`; };
const until = (ts) => { if (!ts) return '—'; const d = (ts - Date.now()) / 1000; if (d < 0) return '지남'; if (d < 60) return `${Math.floor(d)}초 후`; if (d < 3600) return `${Math.floor(d / 60)}분 후`; if (d < 86400) return `${Math.floor(d / 3600)}시간 ${Math.floor(d % 3600 / 60)}분 후`; return `${Math.floor(d / 86400)}일 후`; };
const pct = (a, b) => b ? Math.min(100, Math.round(a / b * 100)) : 0;
const dtLocal = (ts) => { if (!ts) return ''; const d = new Date(ts); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const barClass = (p) => p >= 90 ? 'bar danger' : p >= 75 ? 'bar warn' : 'bar';

function toast(msg, type = 'info', ms = 3200) {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = '.3s'; setTimeout(() => el.remove(), 300); }, ms);
}

async function copy(text, label = '복사됨') {
  try { await navigator.clipboard.writeText(text); toast(label, 'ok', 1500); }
  catch { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast(label, 'ok', 1500); } catch { toast('복사 실패', 'error'); } ta.remove(); }
}

function spark(values, { max, color = 'var(--accent)', w = 200, h = 46 } = {}) {
  if (!values || values.length < 2) return '';
  const mx = max || Math.max(1, ...values);
  const pts = values.map((v, i) => [i / (values.length - 1) * w, h - (Math.min(v, mx) / mx) * (h - 4) - 2]);
  const line = pts.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ');
  const area = `0,${h} ${line} ${w},${h}`;
  const gid = 'g' + Math.random().toString(36).slice(2, 8);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><polygon points="${area}" fill="url(#${gid})"/><polyline points="${line}" fill="none" stroke="${color}" stroke-width="2"/></svg>`;
}

const ICONS = {
  dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
  maintenance: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
  announcements: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 18-5v12L3 13v-2z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>',
  games: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="12" x2="10" y2="12"/><line x1="8" y1="10" x2="8" y2="14"/><line x1="15" y1="13" x2="15.01" y2="13"/><line x1="18" y1="11" x2="18.01" y2="11"/><rect x="2" y="6" width="20" height="12" rx="4"/></svg>',
  vpn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>',
  storage: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>',
  vms: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2M9 2v2M15 20v2M9 20v2M2 15h2M2 9h2M20 15h2M20 9h2"/></svg>',
  tasks: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  network: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>',
  processes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
  backups: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>',
  logs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
};

// ------------------------------------------------------------ API
const api = {
  async call(method, url, body, opts = {}) {
    const init = { method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined && !(body instanceof FormData) && !(body instanceof Blob)) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    else if (body !== undefined) init.body = body;
    const res = await fetch(url, init);
    if (res.status === 401 && !opts.noAuthRedirect) { state.auth = { ...(state.auth || {}), authed: false }; renderShell(); throw new Error('로그인이 필요합니다'); }
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.text();
    if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
    return data;
  },
  get: (u, o) => api.call('GET', u, undefined, o), post: (u, b, o) => api.call('POST', u, b ?? {}, o), put: (u, b) => api.call('PUT', u, b ?? {}), del: (u) => api.call('DELETE', u),
};

// ------------------------------------------------------------ 모달
function formValues(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'number') out[el.name] = el.value === '' ? '' : Number(el.value);
    else out[el.name] = el.value;
  }
  return out;
}
function modal({ title, body, submit = '확인', cancel = '취소', danger = false, wide = false, onSubmit, onOpen }) {
  return new Promise((resolve) => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<form class="modal ${wide ? 'wide' : ''}"><div class="modal-head"><h3>${esc(title)}</h3><button type="button" class="btn ghost sm" data-close>✕</button></div><div class="modal-body">${body}</div><div class="modal-foot">${cancel ? `<button type="button" class="btn" data-close>${esc(cancel)}</button>` : ''}${submit ? `<button type="submit" class="btn ${danger ? 'danger' : 'primary'}">${esc(submit)}</button>` : ''}</div></form>`;
    const form = $('form', bg);
    const close = (v) => { bg.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);
    bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-close]')) close(null); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const values = formValues(form);
      const btn = $('button[type=submit]', form);
      if (onSubmit) {
        btn.disabled = true;
        try { const r = await onSubmit(values, form); if (r === false) { btn.disabled = false; return; } close(r === undefined ? values : r); }
        catch (err) { toast(err.message, 'error'); btn.disabled = false; }
      } else close(values);
    });
    $('#modals').appendChild(bg);
    if (onOpen) onOpen(form);
    const first = $('input:not([type=hidden]):not([type=checkbox]), select, textarea', form);
    if (first) setTimeout(() => first.focus(), 30);
  });
}
const confirmDlg = (title, text, { danger = true, submit = '삭제' } = {}) => modal({ title, body: `<p>${esc(text)}</p>`, submit, danger }).then((v) => !!v);

// 필드 정의로 폼 HTML 생성
function fields(defs) {
  return `<div class="form-grid">${defs.map((f) => {
    const cls = f.full ? 'field full' : 'field';
    const help = f.help ? `<span class="help">${esc(f.help)}</span>` : '';
    if (f.type === 'checkbox') return `<div class="${cls}"><label class="check" style="margin-top:22px"><input type="checkbox" name="${attr(f.name)}" ${f.value ? 'checked' : ''}> ${esc(f.label)}</label>${help}</div>`;
    if (f.type === 'select') return `<div class="${cls}"><label>${esc(f.label)}</label><select class="select" name="${attr(f.name)}">${(f.options || []).map((o) => `<option value="${attr(o.value)}" ${String(o.value) === String(f.value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>${help}</div>`;
    if (f.type === 'textarea') return `<div class="${cls}"><label>${esc(f.label)}</label><textarea class="textarea" name="${attr(f.name)}" placeholder="${attr(f.placeholder || '')}" ${f.rows ? `rows="${f.rows}"` : ''}>${esc(f.value ?? '')}</textarea>${help}</div>`;
    return `<div class="${cls}"><label>${esc(f.label)}</label><input class="input ${f.mono ? 'mono' : ''}" type="${f.type || 'text'}" name="${attr(f.name)}" value="${attr(f.value ?? '')}" placeholder="${attr(f.placeholder || '')}" ${f.required ? 'required' : ''} ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''} ${f.step ? `step="${f.step}"` : ''} ${f.readonly ? 'readonly' : ''} autocomplete="off">${help}</div>`;
  }).join('')}</div>`;
}

// ------------------------------------------------------------ 상태 & 셸
const state = { auth: null, route: '', param: '', timers: [], storagePath: '/', mobileNav: false };
const NAV = [
  { sep: '운영' },
  { id: 'dashboard', label: '대시보드' }, { id: 'maintenance', label: '점검 모드' }, { id: 'announcements', label: '공지사항' }, { id: 'games', label: '게임 연동' },
  { sep: '서버 기능' },
  { id: 'vpn', label: 'VPN (WireGuard)' }, { id: 'storage', label: '가상 저장소' }, { id: 'vms', label: '가상 머신' }, { id: 'tasks', label: '예약 작업' },
  { sep: '시스템' },
  { id: 'network', label: '네트워크 도구' }, { id: 'processes', label: '프로세스' }, { id: 'backups', label: '백업' }, { id: 'logs', label: '로그' }, { id: 'settings', label: '설정' },
];
const views = {};
const every = (ms, fn) => { const t = setInterval(() => { fn().catch?.(() => {}); }, ms); state.timers.push(t); return t; };
const clearTimers = () => { state.timers.forEach(clearInterval); state.timers = []; };

function renderShell() {
  const app = $('#app');
  const a = state.auth;
  if (!a || !a.setup) return renderSetup(app);
  if (!a.authed) return renderLogin(app);
  app.innerHTML = `
  <div class="layout">
    <aside class="sidebar" id="sidebar">
      <div class="brand"><div class="logo"><svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="14" r="6" fill="#fff"/><path d="M6 20h20M8 24h16" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg></div><div><b id="brandName">${esc(a.siteName || 'HALCYON')}</b><span>홈 서버 콘솔 · v${esc(a.version || '')}</span></div></div>
      <nav class="nav">${NAV.map((n) => n.sep ? `<div class="sep">${esc(n.sep)}</div>` : `<a href="#/${n.id}" data-nav="${n.id}">${ICONS[n.id] || ''}<span>${esc(n.label)}</span></a>`).join('')}</nav>
      <div class="sidefoot"><span>${esc(a.username || '')}</span><div class="row"><a href="/" target="_blank" class="btn ghost xs">사이트</a><button class="btn ghost xs" id="logoutBtn">로그아웃</button></div></div>
    </aside>
    <div class="main">
      <div class="topbar"><div class="row"><button class="burger" id="burger">${ICONS.menu}</button><h2 id="pageTitle">대시보드</h2></div><div class="row" id="topStatus"></div></div>
      <div class="content" id="view"></div>
    </div>
  </div>`;
  $('#logoutBtn').onclick = async () => { await api.post('/api/auth/logout'); state.auth.authed = false; location.hash = '#/login'; renderShell(); };
  $('#burger').onclick = () => $('#sidebar').classList.toggle('open');
  $('#sidebar').addEventListener('click', (e) => { if (e.target.closest('a')) $('#sidebar').classList.remove('open'); });
  refreshTopStatus();
  every(10000, refreshTopStatus);
  route();
}

async function refreshTopStatus() {
  try {
    const s = await api.get('/api/public/status');
    const el = $('#topStatus'); if (!el) return;
    el.innerHTML = `<span class="badge ${s.maintenance.enabled ? 'warn live' : 'ok live'}"><span class="dot"></span>${s.maintenance.enabled ? '점검 중' : '정상 운영'}</span><span class="badge accent">접속 ${s.online}명</span><button class="btn sm ${s.maintenance.enabled ? 'ok' : 'warn'}" id="quickMaint">${s.maintenance.enabled ? '점검 종료' : '점검 시작'}</button>`;
    $('#quickMaint').onclick = async () => {
      if (s.maintenance.enabled) { await api.post('/api/admin/maintenance/toggle'); toast('점검 모드를 종료했습니다', 'ok'); }
      else {
        const v = await modal({ title: '점검 모드 시작', body: fields([{ name: 'durationMin', label: '예상 소요 시간 (분, 비우면 무제한)', type: 'number', min: 1, value: 30 }]), submit: '점검 시작', danger: true });
        if (!v) return;
        await api.post('/api/admin/maintenance/toggle', { durationMin: v.durationMin || undefined });
        toast('점검 모드를 시작했습니다', 'warn');
      }
      refreshTopStatus();
      if (state.route === 'maintenance' || state.route === 'dashboard') route();
    };
  } catch { /* ignore */ }
}

function renderSetup(app) {
  app.innerHTML = `<div class="auth"><div class="card"><div class="brand"><div class="logo"><svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="14" r="6" fill="#fff"/><path d="M6 20h20M8 24h16" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg></div><div><b>HALCYON 초기 설정</b><span>홈 서버 콘솔 · 관리자 계정을 만들어 시작하세요</span></div></div>
    <form id="setupForm" class="col">${fields([{ name: 'siteName', label: '사이트 이름', value: 'HALCYON', full: true }, { name: 'username', label: '관리자 아이디', required: true, full: true }, { name: 'password', label: '비밀번호 (6자 이상)', type: 'password', required: true, full: true }, { name: 'password2', label: '비밀번호 확인', type: 'password', required: true, full: true }])}
    <button class="btn primary mt" type="submit">설정 완료</button></form></div></div>`;
  $('#setupForm').onsubmit = async (e) => {
    e.preventDefault();
    const v = formValues(e.target);
    if (v.password !== v.password2) return toast('비밀번호가 일치하지 않습니다', 'error');
    try { await api.post('/api/auth/setup', v, { noAuthRedirect: true }); state.auth = await api.get('/api/auth/state'); location.hash = '#/dashboard'; renderShell(); toast('환영합니다! 초기 설정이 완료되었습니다', 'ok'); }
    catch (err) { toast(err.message, 'error'); }
  };
}
function renderLogin(app) {
  app.innerHTML = `<div class="auth"><div class="card"><div class="brand"><div class="logo"><svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="14" r="6" fill="#fff"/><path d="M6 20h20M8 24h16" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg></div><div><b>${esc(state.auth.siteName || 'HALCYON')}</b><span>HALCYON 홈 서버 콘솔 · 로그인</span></div></div>
    <form id="loginForm" class="col">${fields([{ name: 'username', label: '아이디', required: true, full: true }, { name: 'password', label: '비밀번호', type: 'password', required: true, full: true }])}
    <button class="btn primary mt" type="submit">로그인</button><a href="/" class="small dim" style="text-align:center">← 공개 사이트로</a></form></div></div>`;
  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    try { await api.post('/api/auth/login', formValues(e.target), { noAuthRedirect: true }); state.auth = await api.get('/api/auth/state'); if (location.hash === '#/login' || !location.hash) location.hash = '#/dashboard'; renderShell(); }
    catch (err) { toast(err.message, 'error'); }
  };
}

async function route() {
  if (!state.auth || !state.auth.authed) { if (state.auth && state.auth.setup && location.hash !== '#/login') { /* stay */ } return; }
  const [id, ...rest] = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('/');
  const view = views[id] || views.dashboard;
  state.route = views[id] ? id : 'dashboard';
  state.param = rest.join('/');
  clearTimers();
  every(10000, refreshTopStatus);
  $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === state.route));
  const nav = NAV.find((n) => n.id === state.route);
  $('#pageTitle').textContent = view.title || (nav && nav.label) || '';
  const el = $('#view');
  el.innerHTML = '<div class="muted">불러오는 중…</div>';
  try { await view.render(el, state.param); }
  catch (e) { el.innerHTML = `<div class="card"><h3 class="danger">오류</h3><p class="muted mt-s">${esc(e.message)}</p></div>`; }
}

// ------------------------------------------------------------ 대시보드
views.dashboard = {
  title: '대시보드',
  async render(el) {
    const draw = async () => {
      const d = await api.get('/api/admin/overview');
      const m = d.monitor, mem = m.mem, st = d.storage;
      const memP = pct(mem.used, mem.total), stP = st.quota ? pct(st.used, st.quota) : 0;
      const root = d.disks.find((x) => x.mount === '/') || d.disks[0];
      el.innerHTML = `
      <div class="grid stats mb">
        <div class="stat"><div class="k"><span>CPU</span><span>${m.cpu.cores} 코어</span></div><div class="v">${m.cpu.usage.toFixed(0)}%</div><div class="s">load ${m.loadavg.map((x) => x.toFixed(2)).join(' / ')}</div>${spark(m.history.cpu, { max: 100 })}</div>
        <div class="stat"><div class="k"><span>메모리</span><span>${fmtBytes(mem.total, 0)}</span></div><div class="v">${memP}%</div><div class="s">${fmtBytes(mem.used)} 사용 중</div>${spark(m.history.mem, { max: 100, color: '#8f6bff' })}</div>
        <div class="stat"><div class="k"><span>네트워크</span><span>↓ / ↑</span></div><div class="v" style="font-size:20px">${fmtRate(m.net.rxRate)}</div><div class="s">↑ ${fmtRate(m.net.txRate)}</div>${spark(m.history.rx, { color: '#3ddc97' })}</div>
        <div class="stat"><div class="k"><span>디스크 ${root ? esc(root.mount) : ''}</span><span>${root ? fmtBytes(root.total, 0) : ''}</span></div><div class="v">${root ? root.percent : 0}%</div><div class="s">${root ? fmtBytes(root.avail) + ' 남음' : '정보 없음'}</div></div>
        <div class="stat"><div class="k"><span>업타임</span><span>${esc(m.hostname)}</span></div><div class="v" style="font-size:20px">${fmtDur(m.uptime)}</div><div class="s">앱 ${fmtDur(m.appUptime)} · Node ${esc(m.node)}</div></div>
      </div>
      <div class="grid cols-3 mb">
        <div class="card ${d.maintenance.enabled ? '' : ''}"><div class="card-title"><h3>점검 모드</h3><span class="badge ${d.maintenance.enabled ? 'warn live' : 'ok'}"><span class="dot"></span>${d.maintenance.enabled ? '점검 중' : '정상'}</span></div>
          <p class="muted small">${d.maintenance.enabled ? `${esc(d.maintenance.title)}<br>${d.maintenance.until ? '종료 예정 ' + fmtDate(d.maintenance.until) + ' (' + until(d.maintenance.until) + ')' : '종료 시각 미정'}` : '모든 서비스가 정상 운영 중입니다.'}</p>
          <div class="row mt"><a class="btn sm" href="#/maintenance">관리</a><button class="btn sm ${d.maintenance.enabled ? 'ok' : 'warn'}" id="dashMaint">${d.maintenance.enabled ? '점검 종료' : '점검 시작'}</button></div></div>
        <div class="card"><div class="card-title"><h3>게임 연동</h3><span class="badge accent">${d.counts.games}개 게임</span></div>
          <div class="v" style="font-size:26px;font-weight:700">${d.counts.online}<span class="muted small" style="font-weight:400"> 명 접속 중</span></div><p class="muted small">라이선스 키 ${d.counts.keys}개 · 공지 ${d.counts.announcements}개</p><div class="row mt"><a class="btn sm" href="#/games">게임 관리</a><a class="btn sm ghost" href="#/announcements">공지</a></div></div>
        <div class="card"><div class="card-title"><h3>가상 머신 / VPN</h3><span class="badge ${d.counts.vmsRunning ? 'ok' : ''}">${d.counts.vmsRunning}/${d.counts.vms} 실행</span></div>
          <p class="muted small">백엔드: ${d.vmBackends.qemu ? 'QEMU' + (d.vmBackends.kvm ? '+KVM' : '') : ''} ${d.vmBackends.docker ? 'Docker' : ''} ${!d.vmBackends.qemu && !d.vmBackends.docker ? '시뮬레이션' : ''}<br>VPN 피어 ${d.counts.peers}개</p><div class="row mt"><a class="btn sm" href="#/vms">VM</a><a class="btn sm" href="#/vpn">VPN</a></div></div>
      </div>
      <div class="grid cols-2">
        <div class="card"><div class="card-title"><h3>가상 저장소</h3><a class="btn sm ghost" href="#/storage">열기</a></div>
          <div class="row between small muted"><span>${fmtBytes(st.used)} 사용</span><span>${st.quota ? '할당 ' + fmtBytes(st.quota, 0) : '무제한'}</span></div><div class="${barClass(stP)} mt-s"><i style="width:${stP}%"></i></div><p class="dim small mt-s">파일 ${st.files}개 · 폴더 ${st.dirs}개 · 공유 링크 ${d.counts.shares}개</p>
          <h3 class="mt">디스크</h3>${d.disks.slice(0, 4).map((x) => `<div class="row between small mt-s"><span class="mono ellipsis" style="max-width:55%">${esc(x.mount)}</span><span class="muted">${fmtBytes(x.used, 0)} / ${fmtBytes(x.total, 0)}</span></div><div class="${barClass(x.percent)}" style="height:5px"><i style="width:${x.percent}%"></i></div>`).join('') || '<p class="dim small">정보 없음</p>'}
        </div>
        <div class="card"><div class="card-title"><h3>최근 활동</h3><div class="row">${d.nextTask ? `<span class="badge info">다음 작업: ${esc(d.nextTask.name)} · ${until(d.nextTask.nextRun)}</span>` : ''}<a class="btn sm ghost" href="#/logs">전체</a></div></div>
          <div class="log-list">${d.logs.map((l) => `<div class="log-item"><span class="dim">${fmtTime(l.ts)}</span><span class="lv ${l.level === 'error' ? 'danger' : l.level === 'warn' ? 'warn' : 'info'}">${l.level}</span><span class="muted">${esc(l.type)}</span><span>${esc(l.msg)}</span></div>`).join('') || '<div class="empty">기록 없음</div>'}</div></div>
      </div>`;
      $('#dashMaint').onclick = () => $('#quickMaint')?.click();
    };
    await draw();
    every(4000, draw);
  },
};

// ------------------------------------------------------------ 점검 모드
views.maintenance = {
  title: '점검 모드',
  async render(el) {
    const m = await api.get('/api/admin/maintenance');
    const origin = location.origin;
    el.innerHTML = `
    <div class="big-toggle ${m.enabled ? 'on' : ''} mb">
      <label class="switch big warn"><input type="checkbox" id="maintSwitch" ${m.enabled ? 'checked' : ''}><span></span></label>
      <div class="grow"><div class="t">${m.enabled ? '🔧 점검 모드 켜짐' : '✅ 정상 운영 중'}</div><div class="muted">${m.enabled ? `${fmtDate(m.startedAt)} 시작${m.until ? ` · 종료 예정 ${fmtDate(m.until)} (${until(m.until)})` : ' · 종료 시각 미정'}` : '점검 모드를 켜면 공개 페이지 방문자에게 점검 안내가 표시되고(HTTP 503), 게임 API 가 점검 상태를 응답합니다.'}</div></div>
      <a class="btn" href="/maintenance?preview=1" target="_blank">미리보기</a>
    </div>
    <div class="grid cols-2">
      <div class="card"><div class="card-title"><h3>점검 안내 설정</h3></div>
        <form id="maintForm" class="col">${fields([
          { name: 'title', label: '제목', value: m.title, full: true },
          { name: 'message', label: '안내 메시지', type: 'textarea', value: m.message, full: true, rows: 4 },
          { name: 'until', label: '예상 종료 시각 (도달 시 자동 종료)', type: 'datetime-local', value: dtLocal(m.until) },
          { name: 'bypassKey', label: '우회 키', value: m.bypassKey, help: '/?bypass=키 로 접속하면 점검 중에도 사이트를 볼 수 있습니다', mono: true },
          { name: 'allowIps', label: '허용 IP (줄바꿈/쉼표 구분)', type: 'textarea', value: (m.allowIps || []).join('\n'), full: true, rows: 2 },
          { name: 'blockGames', label: '점검 중 게임 접속 차단 (키 인증 거부 + kick 플래그)', type: 'checkbox', value: m.blockGames, full: true },
        ])}<div class="row mt"><button class="btn primary" type="submit">저장</button>${m.bypassKey ? `<button type="button" class="btn ghost sm" id="copyBypass">우회 링크 복사</button>` : ''}</div></form>
      </div>
      <div class="col">
        <div class="card"><div class="card-title"><h3>점검 예약</h3></div>
          <p class="muted small">지정한 시각에 점검을 자동으로 시작하고, 지정 시간 후 자동 종료하는 예약 작업 2개를 만듭니다.</p>
          <form id="schedForm" class="col mt-s">${fields([
            { name: 'startAt', label: '시작 시각', type: 'datetime-local', value: dtLocal(Date.now() + 3600000) },
            { name: 'durationMin', label: '소요 시간 (분)', type: 'number', value: 60, min: 1 },
            { name: 'title', label: '점검 제목', value: m.title, full: true },
            { name: 'message', label: '안내 메시지', type: 'textarea', value: m.message, full: true, rows: 2 },
          ])}<div class="row mt"><button class="btn" type="submit">예약 등록</button><a class="btn ghost sm" href="#/tasks">예약 작업 보기</a></div></form>
        </div>
        <div class="card"><div class="card-title"><h3>동작 방식</h3></div>
          <ul class="muted small" style="margin:0;padding-left:18px;line-height:1.9">
            <li>공개 페이지(<code>/</code>), 공유 링크(<code>/s/…</code>)는 503 + 점검 페이지로 응답 (Retry-After 포함)</li>
            <li>관리자 로그인 세션, 허용 IP, 우회 키 쿠키가 있으면 정상 페이지 표시</li>
            <li>게임 API <code>/api/game/status</code>, <code>/heartbeat</code>, <code>/key/validate</code> 응답에 <code>maintenance</code> 정보가 포함되어 게임 스크립트가 안내를 표시하거나 접속을 막을 수 있음</li>
            <li>예상 종료 시각이 지나면 자동으로 점검 종료 · Discord 웹훅 알림 전송</li>
          </ul></div>
      </div>
    </div>`;
    $('#maintSwitch').onchange = async (e) => {
      const on = e.target.checked;
      if (on) {
        const v = await modal({ title: '점검 모드 시작', body: fields([{ name: 'durationMin', label: '예상 소요 시간 (분, 비우면 무제한)', type: 'number', min: 1, value: 30 }]), submit: '점검 시작', danger: true });
        if (!v) { e.target.checked = false; return; }
        await api.put('/api/admin/maintenance', { enabled: true, until: v.durationMin ? Date.now() + v.durationMin * 60000 : null });
        toast('점검 모드를 시작했습니다', 'warn');
      } else { await api.put('/api/admin/maintenance', { enabled: false }); toast('점검 모드를 종료했습니다', 'ok'); }
      refreshTopStatus(); route();
    };
    $('#maintForm').onsubmit = async (e) => {
      e.preventDefault();
      const v = formValues(e.target);
      await api.put('/api/admin/maintenance', { ...v, until: v.until ? new Date(v.until).getTime() : null });
      toast('저장했습니다', 'ok'); route();
    };
    $('#copyBypass')?.addEventListener('click', () => copy(`${origin}/?bypass=${encodeURIComponent(m.bypassKey)}`, '우회 링크 복사됨'));
    $('#schedForm').onsubmit = async (e) => {
      e.preventDefault();
      const v = formValues(e.target);
      const start = new Date(v.startAt).getTime();
      if (!start || start < Date.now()) return toast('시작 시각은 미래여야 합니다', 'error');
      await api.post('/api/admin/tasks', { name: `점검 시작 (${fmtDate(start)})`, schedule: { type: 'once', at: start }, action: 'maintenance_on', payload: { title: v.title, message: v.message, durationMin: v.durationMin } });
      await api.post('/api/admin/tasks', { name: `점검 종료 (${fmtDate(start + v.durationMin * 60000)})`, schedule: { type: 'once', at: start + v.durationMin * 60000 }, action: 'maintenance_off', payload: {} });
      toast('점검 예약 작업 2개를 등록했습니다', 'ok');
    };
  },
};

// ------------------------------------------------------------ 공지사항
views.announcements = {
  title: '공지사항',
  async render(el) {
    const list = await api.get('/api/admin/announcements');
    const form = (a = {}) => fields([{ name: 'title', label: '제목', value: a.title, required: true, full: true }, { name: 'body', label: '내용', type: 'textarea', value: a.body, full: true, rows: 5 }, { name: 'pinned', label: '상단 고정', type: 'checkbox', value: a.pinned }]);
    el.innerHTML = `<div class="card"><div class="card-title"><h3>공지 ${list.length}개</h3><div class="row"><a class="btn ghost sm" href="/" target="_blank">공개 페이지</a><button class="btn primary sm" id="addAnn">+ 새 공지</button></div></div>
      <div id="annList">${list.map((a) => `<div class="ann-item" data-id="${a.id}"><div class="row between"><div class="row"><b>${esc(a.title)}</b>${a.pinned ? '<span class="badge accent">고정</span>' : ''}</div><div class="row"><span class="dim small">${fmtDate(a.created)}</span><button class="btn xs" data-edit>수정</button><button class="btn xs danger" data-del>삭제</button></div></div><p class="muted small mt-s" style="white-space:pre-wrap">${esc(a.body)}</p></div>`).join('') || '<div class="empty">공지가 없습니다. 게임 API 와 공개 페이지에 표시됩니다.</div>'}</div></div>`;
    $('#addAnn').onclick = async () => { const v = await modal({ title: '새 공지', body: form(), submit: '등록', onSubmit: (v) => api.post('/api/admin/announcements', v) }); if (v) { toast('등록했습니다', 'ok'); route(); } };
    $('#annList').onclick = async (e) => {
      const row = e.target.closest('[data-id]'); if (!row) return;
      const a = list.find((x) => x.id === row.dataset.id);
      if (e.target.closest('[data-edit]')) { const v = await modal({ title: '공지 수정', body: form(a), submit: '저장', onSubmit: (v) => api.put(`/api/admin/announcements/${a.id}`, v) }); if (v) route(); }
      if (e.target.closest('[data-del]')) { if (await confirmDlg('공지 삭제', `"${a.title}" 공지를 삭제할까요?`)) { await api.del(`/api/admin/announcements/${a.id}`); route(); } }
    };
  },
};

// ------------------------------------------------------------ 게임 연동
function luaSnippet(g, origin) {
  return `-- HALCYON 홈 서버 콘솔 연동 (Roblox Luau 예시)
-- 서버 스크립트(HttpService) 또는 실행기 환경(request/game:HttpGet)에서 사용
local HUB_URL = "${origin}"
local GAME_KEY = "${g.apiKey}"

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")

local function request(method, path, body)
    local ok, res = pcall(function()
        return HttpService:RequestAsync({
            Url = HUB_URL .. path,
            Method = method,
            Headers = { ["Content-Type"] = "application/json", ["X-Game-Key"] = GAME_KEY },
            Body = body and HttpService:JSONEncode(body) or nil,
        })
    end)
    if not ok or not res.Success then return nil end
    return HttpService:JSONDecode(res.Body)
end

-- 1) 상태 확인 + 점검 모드
local status = request("GET", "/api/game/status")
if status and status.maintenance.enabled and status.maintenance.blockGames then
    for _, p in ipairs(Players:GetPlayers()) do p:Kick(status.maintenance.title .. "\\n" .. status.maintenance.message) end
end

-- 2) 라이선스 키 검증 (HWID 바인딩)
local function validateKey(key, hwid)
    local r = request("POST", "/api/game/key/validate", { key = key, hwid = hwid })
    return r and r.valid == true, r and r.message or "서버 연결 실패"
end

-- 3) 30초마다 하트비트 → 접속자 수 집계 + 브로드캐스트 수신 + 점검 시 kick
local lastBroadcast = 0
task.spawn(function()
    while true do
        local names = {}
        for _, p in ipairs(Players:GetPlayers()) do table.insert(names, p.Name) end
        local r = request("POST", "/api/game/heartbeat", {
            serverId = game.JobId ~= "" and game.JobId or "studio",
            placeId = tostring(game.PlaceId),
            players = #Players:GetPlayers(),
            maxPlayers = Players.MaxPlayers,
            playerNames = names,
            since = lastBroadcast,
        })
        if r then
            for _, b in ipairs(r.broadcasts or {}) do
                lastBroadcast = math.max(lastBroadcast, b.ts)
                print("[공지]", b.text) -- 원하는 UI 로 표시
            end
            if r.kick then
                for _, p in ipairs(Players:GetPlayers()) do p:Kick(r.maintenance.title) end
            end
        end
        task.wait(30)
    end
end)

-- 4) 로그 전송
request("POST", "/api/game/log", { level = "info", message = "서버 시작", serverId = game.JobId })`;
}

views.games = {
  title: '게임 연동',
  async render(el, param) {
    if (param) return this.detail(el, param);
    const list = await api.get('/api/admin/games');
    const form = (g = {}) => fields([
      { name: 'name', label: '게임 이름', value: g.name, required: true, full: true },
      { name: 'version', label: '스크립트 버전', value: g.version ?? '1.0.0' },
      { name: 'placeId', label: 'Place ID (선택)', value: g.placeId },
      { name: 'scriptUrl', label: '스크립트 URL (선택)', value: g.scriptUrl, full: true, placeholder: 'https://…/loader.lua' },
      { name: 'message', label: '게임 내 표시 메시지', type: 'textarea', value: g.message, full: true, rows: 2 },
      { name: 'keyRequired', label: '라이선스 키 인증 필요', type: 'checkbox', value: g.keyRequired ?? true },
      { name: 'hwidBind', label: '키를 첫 사용 기기(HWID)에 고정', type: 'checkbox', value: g.hwidBind ?? true },
    ]);
    el.innerHTML = `<div class="card-title"><div><h3>등록된 게임 ${list.length}개</h3><p class="muted small">게임 스크립트가 API 키로 이 서버에 접속해 점검 상태·키 인증·접속자 집계·공지 수신을 처리합니다.</p></div><button class="btn primary sm" id="addGame">+ 게임 등록</button></div>
    <div class="grid cols-3 mt">${list.map((g) => `<div class="card vm-card"><div class="head"><div><div class="name">${esc(g.name)}</div><div class="dim small">v${esc(g.version)} · 키 ${g.keyCount}개</div></div><span class="badge ${g.online ? 'ok live' : ''}"><span class="dot"></span>${g.online}명 · 서버 ${g.servers}</span></div>
      <div class="kv small"><dt>API 키</dt><dd class="mono copy" title="클릭하여 복사" data-copy="${attr(g.apiKey)}">${esc(g.apiKey.slice(0, 14))}…</dd><dt>키 인증</dt><dd>${g.keyRequired ? '필요' + (g.hwidBind ? ' · HWID 고정' : '') : '불필요'}</dd></div>
      <div class="row"><a class="btn sm primary" href="#/games/${g.id}">관리</a><button class="btn sm" data-bc="${g.id}">브로드캐스트</button><button class="btn sm ghost danger" data-del="${g.id}">삭제</button></div></div>`).join('') || '<div class="empty" style="grid-column:1/-1">등록된 게임이 없습니다. "게임 등록"으로 시작하세요.</div>'}</div>`;
    $('#addGame').onclick = async () => { const v = await modal({ title: '게임 등록', body: form(), submit: '등록', onSubmit: (v) => api.post('/api/admin/games', v) }); if (v) { toast('등록했습니다', 'ok'); location.hash = `#/games/${v.id}`; } };
    el.onclick = async (e) => {
      const c = e.target.closest('[data-copy]'); if (c) return copy(c.dataset.copy, 'API 키 복사됨');
      const bc = e.target.closest('[data-bc]'); if (bc) return views.games.broadcastDlg(bc.dataset.bc);
      const del = e.target.closest('[data-del]'); if (del) { const g = list.find((x) => x.id === del.dataset.del); if (await confirmDlg('게임 삭제', `"${g.name}" 과 관련 라이선스 키를 모두 삭제할까요?`)) { await api.del(`/api/admin/games/${g.id}`); route(); } }
    };
  },
  async broadcastDlg(gid) {
    const v = await modal({ title: '게임 내 브로드캐스트', body: fields([{ name: 'text', label: '메시지 (다음 하트비트 시 모든 서버에 전달)', type: 'textarea', required: true, full: true, rows: 3 }, { name: 'type', label: '유형', type: 'select', value: 'message', options: [{ value: 'message', label: '일반 메시지' }, { value: 'warning', label: '경고' }, { value: 'maintenance', label: '점검 예고' }] }, { name: 'duration', label: '표시 시간 (초)', type: 'number', value: 10, min: 1 }]), submit: '전송', onSubmit: (v) => api.post(`/api/admin/games/${gid}/broadcast`, v) });
    if (v) toast('브로드캐스트를 등록했습니다', 'ok');
    return v;
  },
  async detail(el, gid) {
    let tab = sessionStorage.getItem('gameTab') || 'overview';
    const draw = async () => {
      const g = await api.get(`/api/admin/games/${gid}`);
      const keys = ['keys'].includes(tab) ? await api.get(`/api/admin/keys?gameId=${gid}`) : [];
      $('#pageTitle').textContent = `게임 연동 · ${g.name}`;
      const tabs = [['overview', '개요'], ['servers', `서버 (${g.servers.length})`], ['keys', `라이선스 키 (${g.keyCount})`], ['broadcast', '브로드캐스트'], ['logs', `로그 (${g.logCount})`], ['code', '연동 코드'], ['settings', '설정']];
      let body = '';
      if (tab === 'overview') body = `<div class="grid stats"><div class="stat"><div class="k">접속 중</div><div class="v">${g.online}</div><div class="s">서버 ${g.servers.length}개 활성</div></div><div class="stat"><div class="k">라이선스 키</div><div class="v">${g.keyCount}</div></div><div class="stat"><div class="k">버전</div><div class="v" style="font-size:20px">v${esc(g.version)}</div></div><div class="stat"><div class="k">API 키</div><div class="v mono copy" style="font-size:14px" data-copy="${attr(g.apiKey)}">${esc(g.apiKey)}</div><div class="s">클릭하여 복사</div></div></div>
        <div class="card mt"><div class="card-title"><h3>최근 브로드캐스트</h3></div>${g.broadcasts.slice(0, 5).map((b) => `<div class="row between small" style="padding:6px 0;border-bottom:1px solid var(--line)"><span>${esc(b.text)}</span><span class="dim">${ago(b.ts)}</span></div>`).join('') || '<p class="dim small">없음</p>'}</div>`;
      else if (tab === 'servers') body = `<div class="card"><div class="table-wrap"><table><thead><tr><th>서버 ID</th><th>플레이어</th><th>Place</th><th>버전</th><th>첫 접속</th><th>마지막 하트비트</th></tr></thead><tbody>${g.servers.map((s) => `<tr><td class="mono small">${esc(s.serverId)}</td><td><b>${s.players}</b>${s.maxPlayers ? ' / ' + s.maxPlayers : ''}${s.playerNames?.length ? `<div class="dim small ellipsis" style="max-width:260px" title="${attr(s.playerNames.join(', '))}">${esc(s.playerNames.join(', '))}</div>` : ''}</td><td class="small">${esc(s.placeId || '—')}</td><td class="small">${esc(s.version || '—')}</td><td class="small dim">${fmtTime(s.firstSeen)}</td><td class="small">${ago(s.lastSeen)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty" style="border:0">활성 서버가 없습니다. 하트비트가 90초 이상 없으면 목록에서 사라집니다.</td></tr>'}</tbody></table></div></div>`;
      else if (tab === 'keys') body = `<div class="card"><div class="card-title"><h3>라이선스 키</h3><div class="row"><input class="input" id="keyFilter" placeholder="검색…" style="width:180px"><button class="btn sm" id="exportKeys">내보내기</button><button class="btn primary sm" id="genKeys">+ 키 생성</button></div></div>
        <div class="table-wrap"><table><thead><tr><th>키</th><th>메모</th><th>상태</th><th>HWID</th><th>사용</th><th>만료</th><th>마지막 사용</th><th></th></tr></thead><tbody id="keyRows">${keys.map((k) => { const expired = k.expires && k.expires < Date.now(); return `<tr data-k="${k.id}" data-search="${attr((k.key + ' ' + k.note + ' ' + (k.hwid || '')).toLowerCase())}"><td class="mono copy" data-copy="${attr(k.key)}">${esc(k.key)}</td><td class="small">${esc(k.note || '')}</td><td>${k.disabled ? '<span class="badge danger">비활성</span>' : expired ? '<span class="badge warn">만료</span>' : k.hwid ? '<span class="badge ok">사용 중</span>' : '<span class="badge">미사용</span>'}</td><td class="mono small ellipsis" style="max-width:120px" title="${attr(k.hwid || '')}">${esc(k.hwid || '—')}</td><td class="small">${k.uses}${k.maxUses ? '/' + k.maxUses : ''}</td><td class="small">${k.expires ? fmtDate(k.expires) : '무제한'}</td><td class="small dim">${k.lastUsed ? ago(k.lastUsed) : '—'}</td><td class="nowrap right"><button class="btn xs" data-act="hwid" title="HWID 초기화">초기화</button><button class="btn xs ${k.disabled ? 'ok' : 'warn'}" data-act="toggle">${k.disabled ? '활성' : '비활성'}</button><button class="btn xs danger" data-act="del">삭제</button></td></tr>`; }).join('') || '<tr><td colspan="8" class="empty" style="border:0">키가 없습니다</td></tr>'}</tbody></table></div></div>`;
      else if (tab === 'broadcast') body = `<div class="card"><div class="card-title"><h3>브로드캐스트</h3><button class="btn primary sm" id="sendBc">+ 새 메시지</button></div><p class="muted small">등록된 메시지는 각 게임 서버가 다음 하트비트(최대 30초) 때 수신합니다. 24시간 후 자동 만료.</p><div class="mt">${g.broadcasts.map((b) => `<div class="row between" style="padding:8px 0;border-bottom:1px solid var(--line)"><div><span class="badge ${b.type === 'warning' ? 'warn' : b.type === 'maintenance' ? 'accent' : 'info'}">${esc(b.type)}</span> ${esc(b.text)}</div><span class="dim small">${fmtDate(b.ts)}</span></div>`).join('') || '<div class="empty">보낸 메시지가 없습니다</div>'}</div></div>`;
      else if (tab === 'logs') body = `<div class="card"><div class="card-title"><h3>게임 로그 (최근 100)</h3><button class="btn sm danger" id="clearGameLogs">비우기</button></div><div class="log-list">${g.logs.map((l) => `<div class="log-item" style="grid-template-columns:130px 56px 110px 1fr"><span class="dim">${fmtDate(l.ts)}</span><span class="lv ${l.level === 'error' ? 'danger' : l.level === 'warn' ? 'warn' : 'info'}">${l.level}</span><span class="muted ellipsis">${esc(l.player || l.serverId || '')}</span><span>${esc(l.message)}</span></div>`).join('') || '<div class="empty">로그가 없습니다. 게임에서 POST /api/game/log 로 전송하세요.</div>'}</div></div>`;
      else if (tab === 'code') body = `<div class="card"><div class="card-title"><h3>Roblox Luau 연동 예시</h3><button class="btn sm" id="copyCode">코드 복사</button></div><p class="muted small">HTTP 요청이 가능한 환경(서버 스크립트의 HttpService, 또는 <code>request</code>/<code>game:HttpGet</code> 을 지원하는 실행기)에서 동작합니다. 서버 주소는 외부에서 접근 가능한 공개 주소여야 합니다.</p><pre class="code mt" id="luaCode">${esc(luaSnippet(g, location.origin))}</pre>
        <h3 class="mt">REST API 요약</h3><div class="table-wrap"><table><thead><tr><th>메서드</th><th>경로</th><th>설명</th></tr></thead><tbody>
        <tr><td>GET</td><td class="mono">/api/game/status</td><td>점검 상태, 버전, 공지, 접속자 수</td></tr>
        <tr><td>POST</td><td class="mono">/api/game/heartbeat</td><td>{serverId, players, maxPlayers, placeId, playerNames[], since} → 브로드캐스트·kick 플래그</td></tr>
        <tr><td>POST</td><td class="mono">/api/game/key/validate</td><td>{key, hwid} → valid, reason, expires</td></tr>
        <tr><td>POST</td><td class="mono">/api/game/log</td><td>{level, message, player, serverId}</td></tr>
        <tr><td>GET</td><td class="mono">/api/game/broadcasts?since=</td><td>브로드캐스트 목록</td></tr></tbody></table></div><p class="dim small mt-s">인증: 헤더 <code>X-Game-Key: ${esc(g.apiKey)}</code> 또는 쿼리 <code>?key=</code></p></div>`;
      else if (tab === 'settings') body = `<div class="card"><form id="gameForm" class="col">${fields([
        { name: 'name', label: '게임 이름', value: g.name, required: true, full: true }, { name: 'version', label: '스크립트 버전', value: g.version, help: '게임 스크립트가 status 로 받아 구버전 알림에 활용' }, { name: 'placeId', label: 'Place ID', value: g.placeId },
        { name: 'scriptUrl', label: '스크립트 URL', value: g.scriptUrl, full: true }, { name: 'message', label: '게임 내 표시 메시지', type: 'textarea', value: g.message, full: true, rows: 2 },
        { name: 'keyRequired', label: '라이선스 키 인증 필요', type: 'checkbox', value: g.keyRequired }, { name: 'hwidBind', label: '키를 첫 사용 기기(HWID)에 고정', type: 'checkbox', value: g.hwidBind },
      ])}<div class="row mt"><button class="btn primary" type="submit">저장</button><button type="button" class="btn warn" id="rotate">API 키 재발급</button><button type="button" class="btn danger" id="delGame">게임 삭제</button></div></form></div>`;

      el.innerHTML = `<div class="row between mb"><a class="btn ghost sm" href="#/games">← 목록</a><div class="row"><span class="badge ${g.online ? 'ok live' : ''}"><span class="dot"></span>${g.online}명 접속</span><button class="btn sm" id="bcQuick">브로드캐스트</button></div></div>
        <div class="tabs">${tabs.map(([id, label]) => `<button class="${tab === id ? 'active' : ''}" data-tab="${id}">${label}</button>`).join('')}</div>${body}`;

      $('.tabs', el).onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) { tab = b.dataset.tab; sessionStorage.setItem('gameTab', tab); draw(); } };
      $('#bcQuick').onclick = async () => { if (await views.games.broadcastDlg(gid)) draw(); };
      el.querySelectorAll('[data-copy]').forEach((c) => c.addEventListener('click', () => copy(c.dataset.copy)));
      $('#sendBc')?.addEventListener('click', async () => { if (await views.games.broadcastDlg(gid)) draw(); });
      $('#copyCode')?.addEventListener('click', () => copy($('#luaCode').textContent, '코드 복사됨'));
      $('#clearGameLogs')?.addEventListener('click', async () => { if (await confirmDlg('로그 비우기', '게임 로그를 모두 삭제할까요?')) { await api.del(`/api/admin/games/${gid}/logs`); draw(); } });
      $('#gameForm')?.addEventListener('submit', async (e) => { e.preventDefault(); await api.put(`/api/admin/games/${gid}`, formValues(e.target)); toast('저장했습니다', 'ok'); draw(); });
      $('#rotate')?.addEventListener('click', async () => { if (await confirmDlg('API 키 재발급', '기존 키를 사용하는 스크립트는 모두 실패합니다. 계속할까요?', { submit: '재발급' })) { await api.post(`/api/admin/games/${gid}/rotate-key`); toast('API 키를 재발급했습니다', 'ok'); draw(); } });
      $('#delGame')?.addEventListener('click', async () => { if (await confirmDlg('게임 삭제', `"${g.name}" 과 관련 키를 모두 삭제할까요?`)) { await api.del(`/api/admin/games/${gid}`); location.hash = '#/games'; } });
      $('#genKeys')?.addEventListener('click', async () => {
        const v = await modal({ title: '라이선스 키 생성', body: fields([{ name: 'count', label: '개수', type: 'number', value: 1, min: 1, max: 200 }, { name: 'prefix', label: '접두어', value: 'KEY' }, { name: 'expiresDays', label: '유효 기간 (일, 비우면 무제한)', type: 'number', min: 1 }, { name: 'maxUses', label: '최대 사용 기기 수 (비우면 무제한)', type: 'number', min: 1 }, { name: 'note', label: '메모 (구매자 등)', full: true }]), submit: '생성', onSubmit: (v) => api.post('/api/admin/keys', { ...v, gameId: gid }) });
        if (v) { toast(`${v.length}개 키를 생성했습니다`, 'ok'); await modal({ title: '생성된 키', body: `<pre class="code">${esc(v.map((k) => k.key).join('\n'))}</pre>`, submit: '복사', cancel: '닫기', onSubmit: () => { copy(v.map((k) => k.key).join('\n')); return true; } }); draw(); }
      });
      $('#exportKeys')?.addEventListener('click', () => { const csv = 'key,note,hwid,uses,maxUses,expires,disabled,created\n' + keys.map((k) => [k.key, JSON.stringify(k.note || ''), k.hwid || '', k.uses, k.maxUses, k.expires ? new Date(k.expires).toISOString() : '', k.disabled, new Date(k.created).toISOString()].join(',')).join('\n'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `${g.name}-keys.csv`; a.click(); });
      $('#keyFilter')?.addEventListener('input', (e) => { const q = e.target.value.toLowerCase(); $$('#keyRows tr[data-k]').forEach((tr) => tr.classList.toggle('hidden', !!q && !tr.dataset.search.includes(q))); });
      $('#keyRows')?.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-act]'); if (!btn) return;
        const tr = e.target.closest('tr'); const k = keys.find((x) => x.id === tr.dataset.k);
        if (btn.dataset.act === 'hwid') { await api.put(`/api/admin/keys/${k.id}`, { resetHwid: true }); toast('HWID 를 초기화했습니다', 'ok'); }
        if (btn.dataset.act === 'toggle') await api.put(`/api/admin/keys/${k.id}`, { disabled: !k.disabled });
        if (btn.dataset.act === 'del') { if (!await confirmDlg('키 삭제', `${k.key} 를 삭제할까요?`)) return; await api.del(`/api/admin/keys/${k.id}`); }
        draw();
      });
    };
    await draw();
    every(15000, async () => { if (tab === 'servers' || tab === 'overview') await draw(); });
  },
};

// ------------------------------------------------------------ VPN
views.vpn = {
  title: 'VPN (WireGuard)',
  async render(el) {
    const d = await api.get('/api/admin/vpn');
    const s = d.settings, st = d.status;
    el.innerHTML = `
    <div class="grid stats mb">
      <div class="stat"><div class="k">WireGuard</div><div class="v" style="font-size:18px">${st.wg ? '<span class="ok">설치됨</span>' : '<span class="warn">미설치</span>'}</div><div class="s">${st.wg ? (st.running ? `${esc(s.interface)} 실행 중` : '인터페이스 중지') : '설정 파일 생성만 가능'}</div></div>
      <div class="stat"><div class="k">인터페이스</div><div class="v" style="font-size:18px" class="mono">${esc(s.interface)}</div><div class="s">${esc(s.address)} · UDP ${s.port}</div></div>
      <div class="stat"><div class="k">피어</div><div class="v">${d.peers.length}</div><div class="s">${d.peers.filter((p) => p.live && p.live.handshake && Date.now() - p.live.handshake < 180000).length}개 최근 핸드셰이크</div></div>
      <div class="stat"><div class="k">서버 공개키</div><div class="v mono copy" style="font-size:12px;word-break:break-all" data-copy="${attr(s.publicKey)}">${esc(s.publicKey)}</div><div class="s">클릭하여 복사</div></div>
    </div>
    ${!st.wg ? `<div class="card mb" style="border-color:rgba(246,184,75,.4)"><b class="warn">WireGuard 가 설치되어 있지 않습니다.</b><p class="muted small mt-s">피어 추가/클라이언트 설정 파일 생성은 그대로 가능하며, 서버 설정은 <code>${esc(d.confPath)}</code> 에 저장됩니다. 실제 터널을 올리려면 서버에 <code>apt install wireguard</code> 후 root 권한으로 실행하세요.${st.root === false ? ' (현재 root 권한 아님)' : ''}</p></div>` : (st.message && !st.running ? `<div class="card mb muted small">${esc(st.message)}</div>` : '')}
    <div class="grid cols-2">
      <div class="card"><div class="card-title"><h3>피어 (클라이언트)</h3><button class="btn primary sm" id="addPeer">+ 피어 추가</button></div>
        <div class="table-wrap"><table><thead><tr><th>이름</th><th>VPN IP</th><th>상태</th><th></th></tr></thead><tbody id="peerRows">${d.peers.map((p) => { const hs = p.live && p.live.handshake; const on = hs && Date.now() - hs < 180000; return `<tr data-p="${p.id}"><td><b>${esc(p.name)}</b><div class="dim small mono ellipsis" style="max-width:140px" title="${attr(p.publicKey)}">${esc(p.publicKey.slice(0, 14))}…</div></td><td class="mono">${esc(p.ip)}</td><td>${!p.enabled ? '<span class="badge">비활성</span>' : on ? `<span class="badge ok live"><span class="dot"></span>연결 (${ago(hs)})` : hs ? `<span class="badge warn">${ago(hs)}</span>` : '<span class="badge">대기</span>'}${p.live ? `<div class="dim small">↓${fmtBytes(p.live.tx)} ↑${fmtBytes(p.live.rx)}</div>` : ''}</td><td class="nowrap right"><button class="btn xs" data-act="conf">설정</button><a class="btn xs" href="/api/admin/vpn/peers/${p.id}/config?download=1" title="클라이언트 .conf 다운로드">↓</a><button class="btn xs ${p.enabled ? 'warn' : 'ok'}" data-act="toggle">${p.enabled ? '끄기' : '켜기'}</button><button class="btn xs danger" data-act="del">삭제</button></td></tr>`; }).join('') || '<tr><td colspan="5" class="empty" style="border:0">피어가 없습니다. 기기별로 하나씩 추가하세요.</td></tr>'}</tbody></table></div></div>
      <div class="col">
        <div class="card"><div class="card-title"><h3>서버 설정</h3><div class="row"><a class="btn sm" href="/api/admin/vpn/server-config">${esc(s.interface)}.conf</a><button class="btn sm ${st.running ? 'danger' : 'ok'}" id="applyBtn">${st.running ? '재적용' : '적용 (wg-quick up)'}</button>${st.running ? '<button class="btn sm" id="downBtn">중지</button>' : ''}</div></div>
          <form id="vpnForm" class="col">${fields([
            { name: 'interface', label: '인터페이스', value: s.interface, mono: true }, { name: 'address', label: '서버 주소/CIDR', value: s.address, mono: true }, { name: 'port', label: '포트 (UDP)', type: 'number', value: s.port },
            { name: 'endpoint', label: '클라이언트가 접속할 주소 (도메인/IP)', value: s.endpoint, placeholder: '비우면 설정의 공개 호스트 사용', full: true },
            { name: 'dns', label: '클라이언트 DNS', value: s.dns }, { name: 'allowedIps', label: '클라이언트 AllowedIPs', value: s.allowedIps, help: '0.0.0.0/0 = 전체 트래픽' }, { name: 'mtu', label: 'MTU (0 = 기본)', type: 'number', value: s.mtu || 0 },
            { name: 'nat', label: 'NAT/포워딩 규칙 자동 추가 (iptables)', type: 'checkbox', value: s.nat }, { name: 'natInterface', label: '외부 인터페이스', value: s.natInterface, mono: true },
          ])}<div class="row mt"><button class="btn primary" type="submit">저장</button><button type="button" class="btn ghost danger sm" id="regen">서버 키 재생성</button></div></form></div>
        <div class="card"><div class="card-title"><h3>생성된 서버 설정 미리보기</h3></div><pre class="code" style="max-height:260px">${esc(d.serverConfig.replace(/PrivateKey = .*/g, 'PrivateKey = (숨김)').replace(/PresharedKey = .*/g, 'PresharedKey = (숨김)'))}</pre></div>
      </div>
    </div>`;
    el.querySelectorAll('[data-copy]').forEach((c) => c.addEventListener('click', () => copy(c.dataset.copy)));
    $('#addPeer').onclick = async () => {
      const v = await modal({ title: '피어 추가', body: fields([{ name: 'name', label: '이름 (예: 노트북, 폰)', required: true, full: true }]), submit: '추가', onSubmit: (v) => api.post('/api/admin/vpn/peers', v) });
      if (v) { toast(`${v.name} (${v.ip}) 추가됨`, 'ok'); await views.vpn.showConf(v.id, v.name, v.config); route(); }
    };
    $('#peerRows').onclick = async (e) => {
      const btn = e.target.closest('[data-act]'); if (!btn) return;
      const p = d.peers.find((x) => x.id === e.target.closest('tr').dataset.p);
      if (btn.dataset.act === 'conf') { const r = await api.get(`/api/admin/vpn/peers/${p.id}/config`); return views.vpn.showConf(p.id, p.name, r.config); }
      if (btn.dataset.act === 'toggle') { await api.put(`/api/admin/vpn/peers/${p.id}`, { enabled: !p.enabled }); return route(); }
      if (btn.dataset.act === 'del') { if (await confirmDlg('피어 삭제', `"${p.name}" 피어를 삭제할까요?`)) { await api.del(`/api/admin/vpn/peers/${p.id}`); route(); } }
    };
    $('#vpnForm').onsubmit = async (e) => { e.preventDefault(); await api.put('/api/admin/vpn/settings', formValues(e.target)); toast('저장했습니다. 변경 사항은 "적용" 후 반영됩니다', 'ok'); route(); };
    $('#applyBtn').onclick = async () => { try { const r = await api.post('/api/admin/vpn/apply'); toast(r.message, r.applied ? 'ok' : 'warn', 5000); } catch (err) { toast(err.message, 'error', 6000); } route(); };
    $('#downBtn')?.addEventListener('click', async () => { const r = await api.post('/api/admin/vpn/down'); toast(r.message, r.ok ? 'ok' : 'error'); route(); });
    $('#regen').onclick = async () => { if (await confirmDlg('서버 키 재생성', '모든 클라이언트 설정을 다시 배포해야 합니다. 계속할까요?', { submit: '재생성' })) { await api.post('/api/admin/vpn/regenerate-keys'); route(); } };
  },
  showConf(id, name, conf) {
    return modal({ title: `${name} 클라이언트 설정`, wide: true, body: `<p class="muted small">이 파일을 WireGuard 앱에서 가져오기(Import) 하세요. 개인키가 포함되어 있으니 안전하게 전달하세요.</p><pre class="code">${esc(conf)}</pre>`, submit: '복사', cancel: '닫기', onSubmit: () => { copy(conf, '설정 복사됨'); return false; }, onOpen: (f) => { const foot = $('.modal-foot', f); const a = document.createElement('a'); a.className = 'btn'; a.href = `/api/admin/vpn/peers/${id}/config?download=1`; a.textContent = '.conf 다운로드'; foot.prepend(a); } });
  },
};

// ------------------------------------------------------------ 가상 저장소
views.storage = {
  title: '가상 저장소',
  async render(el) {
    const draw = async () => {
      const [list, usage, shares] = await Promise.all([api.get(`/api/admin/storage/list?path=${encodeURIComponent(state.storagePath)}`).catch(() => { state.storagePath = '/'; return api.get('/api/admin/storage/list?path=/'); }), api.get('/api/admin/storage/usage'), api.get('/api/admin/storage/shares')]);
      state.storagePath = list.path;
      const parts = list.path.split('/').filter(Boolean);
      const crumbs = [`<a href="#" data-go="/">📁 루트</a>`].concat(parts.map((p, i) => `<span class="sep">/</span><a href="#" data-go="${attr('/' + parts.slice(0, i + 1).join('/'))}">${esc(p)}</a>`)).join('');
      const p = usage.quota ? pct(usage.used, usage.quota) : 0;
      const icon = (it) => it.type === 'dir' ? '📁' : /\.(png|jpe?g|gif|webp|svg)$/i.test(it.name) ? '🖼️' : /\.(mp4|mkv|mov|webm)$/i.test(it.name) ? '🎬' : /\.(mp3|wav|ogg|flac)$/i.test(it.name) ? '🎵' : /\.(zip|tar|gz|7z|rar)$/i.test(it.name) ? '🗜️' : /\.(lua|js|ts|py|sh|json|md|txt|conf|ya?ml|html|css)$/i.test(it.name) ? '📝' : /\.(iso|img|qcow2)$/i.test(it.name) ? '💿' : '📄';
      const isText = (n) => /\.(lua|js|ts|py|sh|json|md|txt|conf|ya?ml|html|css|xml|ini|env|log|csv)$/i.test(n) || !/\./.test(n);
      el.innerHTML = `
      <div class="card mb pad-s"><div class="row between"><div class="row grow"><span class="small muted">${fmtBytes(usage.used)} 사용 / ${usage.quota ? fmtBytes(usage.quota, 0) : '무제한'} · 파일 ${usage.files}개</span><div class="${barClass(p)} grow" style="max-width:260px"><i style="width:${p}%"></i></div></div><button class="btn ghost xs" id="quotaBtn">할당량 변경</button></div></div>
      <div class="card">
        <div class="row between mb"><div class="crumbs" id="crumbs">${crumbs}</div><div class="row"><button class="btn sm" id="mkdirBtn">+ 폴더</button><button class="btn sm" id="newTextBtn">+ 텍스트</button><label class="btn primary sm">업로드<input type="file" id="fileInput" multiple hidden></label><button class="btn ghost sm icon" id="reload" title="새로고침">${ICONS.refresh}</button></div></div>
        <div class="dropzone mb" id="drop">파일을 여기에 끌어다 놓아 업로드 · <span id="upStatus"></span></div>
        <div class="table-wrap"><table><thead><tr><th>이름</th><th class="right">크기</th><th>수정</th><th></th></tr></thead><tbody id="rows">
        ${list.path !== '/' ? `<tr class="file-row"><td data-go="${attr(list.path.replace(/\/[^/]*$/, '') || '/')}"><span class="file-ico">↩</span>..</td><td></td><td></td><td></td></tr>` : ''}
        ${list.items.map((it) => { const full = (list.path === '/' ? '' : list.path) + '/' + it.name; return `<tr class="file-row" data-path="${attr(full)}" data-type="${it.type}" data-name="${attr(it.name)}"><td ${it.type === 'dir' ? `data-go="${attr(full)}"` : isText(it.name) && it.size < 2e6 ? 'data-edit' : ''}><span class="file-ico">${icon(it)}</span>${esc(it.name)}</td><td class="right small muted">${it.type === 'dir' ? '—' : fmtBytes(it.size)}</td><td class="small dim">${fmtDate(it.mtime)}</td><td class="nowrap right"><a class="btn xs" href="/api/admin/storage/download?path=${encodeURIComponent(full)}" title="${it.type === 'dir' ? 'tar.gz 로 다운로드' : '다운로드'}">↓</a><button class="btn xs" data-act="share">공유</button><button class="btn xs" data-act="rename">이름</button><button class="btn xs danger" data-act="del">삭제</button></td></tr>`; }).join('') || '<tr><td colspan="4" class="empty" style="border:0">비어 있습니다</td></tr>'}
        </tbody></table></div>
      </div>
      <div class="card mt"><div class="card-title"><h3>공유 링크 (${shares.length})</h3></div><div class="table-wrap"><table><thead><tr><th>경로</th><th>링크</th><th>만료</th><th>다운로드</th><th></th></tr></thead><tbody id="shareRows">${shares.map((s) => `<tr data-s="${s.id}"><td class="mono small">${esc(s.path)}</td><td><span class="mono small copy" data-copy="${attr(location.origin + '/s/' + s.token)}">${esc(location.origin)}/s/${esc(s.token.slice(0, 10))}…</span></td><td class="small">${s.expires ? fmtDate(s.expires) : '없음'}</td><td class="small">${s.downloads}</td><td class="right"><button class="btn xs danger" data-act="unshare">해제</button></td></tr>`).join('') || '<tr><td colspan="5" class="dim small" style="border:0">공유 링크가 없습니다. 점검 모드 중에는 공유 링크도 차단됩니다.</td></tr>'}</tbody></table></div></div>`;

      const go = (p) => { state.storagePath = p; draw(); };
      $('#crumbs').onclick = (e) => { const a = e.target.closest('[data-go]'); if (a) { e.preventDefault(); go(a.dataset.go); } };
      $('#reload').onclick = draw;
      $('#quotaBtn').onclick = async () => { const v = await modal({ title: '저장소 할당량', body: fields([{ name: 'quotaMB', label: 'MB (0 = 무제한)', type: 'number', value: Math.round(usage.quota / 1048576), min: 0 }]), submit: '저장', onSubmit: (v) => api.put('/api/admin/settings', { storage: { quotaMB: v.quotaMB } }) }); if (v) draw(); };
      $('#mkdirBtn').onclick = async () => { const v = await modal({ title: '새 폴더', body: fields([{ name: 'name', label: '폴더 이름', required: true, full: true }]), submit: '만들기', onSubmit: (v) => api.post('/api/admin/storage/mkdir', { path: (list.path === '/' ? '' : list.path) + '/' + v.name }) }); if (v) draw(); };
      $('#newTextBtn').onclick = async () => { const v = await modal({ title: '새 텍스트 파일', body: fields([{ name: 'name', label: '파일 이름', required: true, full: true, placeholder: 'notes.txt' }]), submit: '만들기', onSubmit: (v) => api.post('/api/admin/storage/text', { path: (list.path === '/' ? '' : list.path) + '/' + v.name, content: '' }) }); if (v) { await views.storage.editText((list.path === '/' ? '' : list.path) + '/' + v.name); draw(); } };
      $('#fileInput').onchange = (e) => views.storage.uploadFiles([...e.target.files], list.path, draw);
      const drop = $('#drop');
      drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
      drop.ondragleave = () => drop.classList.remove('over');
      drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); views.storage.uploadFiles([...e.dataTransfer.files], list.path, draw); };
      $('#rows').onclick = async (e) => {
        const goEl = e.target.closest('[data-go]'); if (goEl) return go(goEl.dataset.go);
        const tr = e.target.closest('tr[data-path]'); if (!tr) return;
        const full = tr.dataset.path, name = tr.dataset.name;
        if (e.target.closest('[data-edit]')) { await views.storage.editText(full); return draw(); }
        const act = e.target.closest('[data-act]')?.dataset.act; if (!act) return;
        if (act === 'del') { if (await confirmDlg('삭제', `"${name}" 을(를) 삭제할까요?${tr.dataset.type === 'dir' ? ' 폴더 안의 모든 내용이 삭제됩니다.' : ''}`)) { await api.post('/api/admin/storage/delete', { paths: [full] }); draw(); } }
        if (act === 'rename') { const v = await modal({ title: '이름 변경 / 이동', body: fields([{ name: 'to', label: '새 경로', value: full, full: true, mono: true, help: '다른 폴더 경로를 입력하면 이동됩니다' }]), submit: '변경', onSubmit: (v) => api.post('/api/admin/storage/rename', { from: full, to: v.to }) }); if (v) draw(); }
        if (act === 'share') { const v = await modal({ title: '공유 링크 만들기', body: `<p class="muted small mono">${esc(full)}</p>` + fields([{ name: 'expiresHours', label: '만료 (시간, 0 = 무기한)', type: 'number', value: 24, min: 0 }]), submit: '만들기', onSubmit: (v) => api.post('/api/admin/storage/shares', { path: full, expiresHours: v.expiresHours }) }); if (v) { copy(`${location.origin}/s/${v.token}`, '공유 링크가 복사되었습니다'); draw(); } }
      };
      $('#shareRows').onclick = async (e) => {
        const c = e.target.closest('[data-copy]'); if (c) return copy(c.dataset.copy, '링크 복사됨');
        if (e.target.closest('[data-act="unshare"]')) { await api.del(`/api/admin/storage/shares/${e.target.closest('tr').dataset.s}`); draw(); }
      };
    };
    await draw();
  },
  uploadFiles(files, dir, done) {
    if (!files.length) return;
    const status = $('#upStatus');
    let i = 0;
    const next = () => {
      if (i >= files.length) { status.textContent = `${files.length}개 업로드 완료`; toast(`${files.length}개 파일 업로드 완료`, 'ok'); return done(); }
      const f = files[i++];
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', `/api/admin/storage/upload?path=${encodeURIComponent(dir)}`);
      xhr.setRequestHeader('X-File-Name', encodeURIComponent(f.name));
      xhr.upload.onprogress = (e) => { status.textContent = `${f.name} 업로드 중 ${e.lengthComputable ? Math.round(e.loaded / e.total * 100) + '%' : ''} (${i}/${files.length})`; };
      xhr.onload = () => { if (xhr.status >= 300) { try { toast(`${f.name}: ${JSON.parse(xhr.responseText).error}`, 'error'); } catch { toast(`${f.name} 업로드 실패`, 'error'); } } next(); };
      xhr.onerror = () => { toast(`${f.name} 업로드 실패`, 'error'); next(); };
      xhr.send(f);
    };
    next();
  },
  async editText(path) {
    let d;
    try { d = await api.get(`/api/admin/storage/text?path=${encodeURIComponent(path)}`); } catch (e) { return toast(e.message, 'error'); }
    return modal({ title: `편집: ${d.name}`, wide: true, body: `<textarea class="textarea mono" name="content" style="min-height:420px;font-size:12.5px;white-space:pre">${esc(d.content)}</textarea>`, submit: '저장', onSubmit: async (v) => { await api.post('/api/admin/storage/text', { path, content: v.content }); toast('저장했습니다', 'ok'); } });
  },
};

// ------------------------------------------------------------ 가상 머신
views.vms = {
  title: '가상 머신',
  async render(el) {
    const draw = async () => {
      const d = await api.get('/api/admin/vms');
      const b = d.backends;
      const backendOpts = [{ value: 'auto', label: '자동 선택' }, { value: 'qemu', label: 'QEMU/KVM (완전 가상화)' + (b.qemu ? '' : ' — 미설치') }, { value: 'docker', label: 'Docker 컨테이너 (경량)' + (b.docker ? '' : ' — 사용 불가') }, { value: 'simulated', label: '시뮬레이션 (테스트용)' }];
      el.innerHTML = `
      <div class="row between mb"><div class="pill-list">
        <span class="badge ${b.qemu ? 'ok' : ''}">QEMU ${b.qemu ? '사용 가능' : '미설치'}</span><span class="badge ${b.kvm ? 'ok' : ''}">KVM ${b.kvm ? '가속 가능' : '없음'}</span><span class="badge ${b.docker ? 'ok' : ''}" title="${attr(b.dockerError || '')}">Docker ${b.docker ? 'v' + esc(b.dockerVersion) : '사용 불가'}</span><span class="badge accent">시뮬레이션 항상 가능</span><button class="btn ghost xs" id="detect">재검사</button></div>
        <button class="btn primary sm" id="addVm">+ VM 만들기</button></div>
      ${!b.qemu && !b.docker ? '<div class="card mb muted small">실제 가상화 백엔드가 없어 VM 은 <b>시뮬레이션 모드</b>로만 만들 수 있습니다. 서버에 <code>qemu-system-x86_64</code>(완전 가상화) 또는 <code>docker</code>(경량 컨테이너)를 설치하면 자동으로 감지됩니다. QEMU 용 ISO 는 <code>' + esc(d.isoDir) + '</code> 에 넣으세요.</div>' : ''}
      <div class="grid cols-3" id="vmGrid">${d.vms.map((vm) => `<div class="card vm-card" data-vm="${vm.id}"><div class="head"><div><div class="name">${esc(vm.name)}</div><div class="dim small">${vm.backend === 'qemu' ? 'QEMU' : vm.backend === 'docker' ? 'Docker · ' + esc(vm.image) : '시뮬레이션'}</div></div><span class="badge ${vm.state === 'running' ? 'ok live' : ''}"><span class="dot"></span>${vm.state === 'running' ? '실행 중' : '정지'}</span></div>
        <div class="kv small"><dt>리소스</dt><dd>${vm.cpus} vCPU · ${vm.memMB >= 1024 ? (vm.memMB / 1024).toFixed(1) + ' GB' : vm.memMB + ' MB'} RAM${vm.backend === 'qemu' ? ` · ${vm.diskGB} GB` : ''}</dd>${vm.backend === 'qemu' ? `<dt>VNC</dt><dd class="mono">:${vm.vncPort} (디스플레이 :${vm.vncPort - 5900})</dd>` : ''}${vm.iso ? `<dt>ISO</dt><dd>${esc(vm.iso)}${vm.bootFromIso ? ' (부팅)' : ''}</dd>` : ''}${vm.ports?.length ? `<dt>포트</dt><dd class="mono">${esc(vm.ports.join(', '))}</dd>` : ''}${vm.startedAt ? `<dt>가동</dt><dd>${fmtDur((Date.now() - vm.startedAt) / 1000)}</dd>` : ''}${vm.lastError ? `<dt class="danger">오류</dt><dd class="danger small">${esc(vm.lastError)}</dd>` : ''}</div>
        <div class="row">${vm.state === 'running' ? `<button class="btn sm warn" data-act="stop">정지</button><button class="btn sm" data-act="restart">재시작</button>` : `<button class="btn sm ok" data-act="start">▶ 시작</button>`}<button class="btn sm" data-act="detail">콘솔/상세</button><button class="btn sm ghost" data-act="edit">편집</button><button class="btn sm ghost danger" data-act="del">삭제</button></div></div>`).join('') || '<div class="empty" style="grid-column:1/-1">VM 이 없습니다.</div>'}</div>`;
      $('#detect').onclick = async () => { await api.post('/api/admin/vms/detect'); draw(); };
      $('#addVm').onclick = async () => {
        const v = await modal({ title: 'VM 만들기', wide: true, body: fields([
          { name: 'name', label: '이름', required: true, placeholder: 'game-server-1' }, { name: 'backend', label: '백엔드', type: 'select', value: d.defaultBackend, options: backendOpts },
          { name: 'cpus', label: 'vCPU', type: 'number', value: 2, min: 1, max: 64 }, { name: 'memMB', label: '메모리 (MB)', type: 'number', value: 2048, min: 64 }, { name: 'diskGB', label: '디스크 (GB, QEMU)', type: 'number', value: 20, min: 1 },
          { name: 'iso', label: 'ISO (QEMU)', type: 'select', value: '', options: [{ value: '', label: '없음' }].concat(d.isos.map((i) => ({ value: i.name, label: `${i.name} (${fmtBytes(i.size, 0)})` }))) }, { name: 'bootFromIso', label: 'ISO 로 부팅 (OS 설치 시)', type: 'checkbox', value: true },
          { name: 'image', label: 'Docker 이미지', value: 'ubuntu:24.04', placeholder: 'alpine:latest' }, { name: 'portsText', label: 'Docker 포트 매핑 (쉼표 구분)', placeholder: '8080:80, 2222:22/tcp' },
          { name: 'notes', label: '메모', full: true },
        ]), submit: '만들기', onSubmit: (v) => api.post('/api/admin/vms', { ...v, ports: String(v.portsText || '').split(',').map((s) => s.trim()).filter(Boolean) }) });
        if (v) { toast(`${v.name} 생성됨 (${v.backend})`, 'ok'); draw(); }
      };
      $('#vmGrid').onclick = async (e) => {
        const card = e.target.closest('[data-vm]'); const act = e.target.closest('[data-act]')?.dataset.act; if (!card || !act) return;
        const vm = d.vms.find((x) => x.id === card.dataset.vm);
        const btn = e.target.closest('button'); if (btn) btn.disabled = true;
        try {
          if (act === 'start') { await api.post(`/api/admin/vms/${vm.id}/start`); toast(`${vm.name} 시작`, 'ok'); }
          if (act === 'stop') { await api.post(`/api/admin/vms/${vm.id}/stop`); toast(`${vm.name} 정지`, 'ok'); }
          if (act === 'restart') { await api.post(`/api/admin/vms/${vm.id}/restart`); toast(`${vm.name} 재시작`, 'ok'); }
          if (act === 'del') { if (!await confirmDlg('VM 삭제', `"${vm.name}" 을 삭제할까요? 디스크 이미지도 함께 삭제됩니다.`)) return; await api.del(`/api/admin/vms/${vm.id}`); }
          if (act === 'edit') {
            const v = await modal({ title: `${vm.name} 편집`, body: fields([{ name: 'cpus', label: 'vCPU', type: 'number', value: vm.cpus, min: 1 }, { name: 'memMB', label: '메모리 (MB)', type: 'number', value: vm.memMB, min: 64 }, ...(vm.backend === 'qemu' ? [{ name: 'iso', label: 'ISO', type: 'select', value: vm.iso, options: [{ value: '', label: '없음' }].concat(d.isos.map((i) => ({ value: i.name, label: i.name }))) }, { name: 'bootFromIso', label: 'ISO 로 부팅', type: 'checkbox', value: vm.bootFromIso }] : []), ...(vm.backend === 'docker' ? [{ name: 'image', label: '이미지', value: vm.image }, { name: 'portsText', label: '포트 매핑', value: vm.ports.join(', ') }] : []), { name: 'notes', label: '메모', value: vm.notes, full: true }]), submit: '저장', onSubmit: (v) => api.put(`/api/admin/vms/${vm.id}`, { ...v, ports: v.portsText !== undefined ? String(v.portsText).split(',').map((s) => s.trim()).filter(Boolean) : undefined }) });
            if (!v) return;
          }
          if (act === 'detail') return views.vms.detail(vm);
        } catch (err) { toast(err.message, 'error', 6000); }
        finally { draw(); }
      };
    };
    await draw();
    every(8000, draw);
  },
  async detail(vm) {
    const history = [];
    await modal({ title: `${vm.name} — 콘솔 / 상세`, wide: true, submit: null, cancel: '닫기', body: `<div id="vmStats" class="grid stats"></div>
      ${vm.backend === 'qemu' ? `<div class="card pad-s muted small">QEMU VM 은 VNC 뷰어로 <b class="mono">서버IP:${vm.vncPort}</b> 에 접속해 화면을 봅니다. (TigerVNC, RealVNC 등)</div>` : ''}
      <div class="term" id="term">${vm.backend === 'docker' ? '컨테이너 안에서 실행할 명령을 입력하세요 (sh -c).\n' : vm.backend === 'simulated' ? '시뮬레이션 VM — 명령은 실제로 실행되지 않습니다.\n' : 'QEMU VM 은 명령 실행을 지원하지 않습니다.\n'}</div>
      <div id="execForm" class="row"><input class="input mono grow" name="cmd" placeholder="예: uname -a; cat /etc/os-release; ls /" autocomplete="off" ${vm.backend === 'qemu' ? 'disabled' : ''}><button class="btn primary" type="button" ${vm.backend === 'qemu' ? 'disabled' : ''}>실행</button></div>
      <details><summary class="muted small" style="cursor:pointer">컨테이너 로그</summary><pre class="code mt-s" id="vmLogs" style="max-height:200px"></pre></details>`,
      onOpen: (form) => {
        const term = $('#term', form);
        const refresh = async () => {
          try {
            const d = await api.get(`/api/admin/vms/${vm.id}`);
            const s = d.stats;
            $('#vmStats', form).innerHTML = `<div class="stat"><div class="k">상태</div><div class="v" style="font-size:18px">${d.vm.state === 'running' ? '<span class="ok">실행 중</span>' : '정지'}</div></div><div class="stat"><div class="k">CPU</div><div class="v" style="font-size:18px">${s ? esc(s.cpu) : '—'}</div></div><div class="stat"><div class="k">메모리</div><div class="v" style="font-size:16px">${s ? esc(s.mem) : '—'}</div><div class="s">${s && s.memPerc ? esc(s.memPerc) : ''}</div></div><div class="stat"><div class="k">네트워크 / PID</div><div class="v" style="font-size:14px">${s && s.net ? esc(s.net) : '—'}</div><div class="s">${s && s.pids ? 'PIDs ' + esc(s.pids) : (s && s.note ? esc(s.note) : '')}</div></div>`;
            $('#vmLogs', form).textContent = d.logs || '(로그 없음)';
          } catch { /* ignore */ }
        };
        refresh();
        const t = setInterval(refresh, 5000);
        const obs = new MutationObserver(() => { if (!document.body.contains(form)) { clearInterval(t); obs.disconnect(); } });
        obs.observe($('#modals'), { childList: true });
        const ef = $('#execForm', form), inp = $('input', ef);
        const runCmd = async () => {
          const cmd = inp.value.trim(); if (!cmd) return;
          history.push(cmd); inp.value = '';
          term.innerHTML += `<div class="cmd">$ ${esc(cmd)}</div>`;
          try { const r = await api.post(`/api/admin/vms/${vm.id}/exec`, { cmd }); term.innerHTML += `<div class="${r.ok ? '' : 'err'}">${esc(r.output || '(출력 없음)')}${r.ok ? '' : `\n[exit ${r.code}]`}</div>`; }
          catch (err) { term.innerHTML += `<div class="err">${esc(err.message)}</div>`; }
          term.scrollTop = term.scrollHeight;
        };
        $('button', ef).onclick = runCmd;
        inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); runCmd(); } if (e.key === 'ArrowUp' && history.length) { inp.value = history[history.length - 1]; } };
      } });
  },
};

// ------------------------------------------------------------ 예약 작업
const CRON_PRESETS = [['*/5 * * * *', '5분마다'], ['0 * * * *', '매시 정각'], ['0 4 * * *', '매일 04:00'], ['30 3 * * 1', '매주 월 03:30'], ['0 0 1 * *', '매월 1일 00:00']];
views.tasks = {
  title: '예약 작업',
  async render(el) {
    const d = await api.get('/api/admin/tasks');
    const [games, vmsList] = await Promise.all([api.get('/api/admin/games'), api.get('/api/admin/vms')]);
    el.innerHTML = `<div class="card"><div class="card-title"><div><h3>예약 작업 ${d.tasks.length}개</h3><p class="muted small">cron 표현식, 1회 실행, 간격 반복으로 점검 모드·셸 명령·백업·VM·알림 등을 자동 실행합니다.</p></div><button class="btn primary sm" id="addTask">+ 작업 추가</button></div>
      <div class="table-wrap"><table><thead><tr><th>작업</th><th>스케줄</th><th>다음 실행</th><th>마지막 결과</th><th>활성</th><th></th></tr></thead><tbody id="taskRows">${d.tasks.map((t) => `<tr data-t="${t.id}"><td><b>${esc(t.name)}</b><div class="dim small">${esc(t.actionLabel)}${t.action === 'shell' ? ` · <span class="mono">${esc((t.payload.command || '').slice(0, 60))}</span>` : ''}</div></td><td class="small">${esc(t.scheduleText)}</td><td class="small">${t.enabled && t.nextRun ? `${fmtDate(t.nextRun)}<div class="dim">${until(t.nextRun)}</div>` : '—'}</td><td class="small" style="max-width:260px">${t.lastResult ? `<span class="badge ${t.lastResult.ok ? 'ok' : 'danger'}">${t.lastResult.ok ? '성공' : '실패'}</span> <span class="dim">${ago(t.lastRun)}</span><div class="dim ellipsis" title="${attr(t.lastResult.output)}">${esc(t.lastResult.output)}</div>` : '<span class="dim">아직 없음</span>'}</td><td><label class="switch"><input type="checkbox" data-act="toggle" ${t.enabled ? 'checked' : ''}><span></span></label></td><td class="nowrap right"><button class="btn xs" data-act="run">지금 실행</button><button class="btn xs" data-act="edit">편집</button><button class="btn xs danger" data-act="del">삭제</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty" style="border:0">등록된 작업이 없습니다</td></tr>'}</tbody></table></div></div>`;
    const editor = async (t) => {
      const payloadFields = (action, p = {}) => ({
        maintenance_on: [{ name: 'p_title', label: '점검 제목', value: p.title ?? '', full: true }, { name: 'p_message', label: '안내 메시지', type: 'textarea', value: p.message ?? '', full: true, rows: 2 }, { name: 'p_durationMin', label: '자동 종료 (분, 비우면 무제한)', type: 'number', value: p.durationMin ?? '' }],
        maintenance_off: [],
        shell: [{ name: 'p_command', label: '셸 명령 (/bin/sh -c)', type: 'textarea', value: p.command ?? '', full: true, rows: 3, placeholder: 'e.g. systemctl restart game-server' }, { name: 'p_timeoutSec', label: '제한 시간 (초)', type: 'number', value: p.timeoutSec ?? 120 }],
        webhook: [{ name: 'p_title', label: '제목', value: p.title ?? '', full: true }, { name: 'p_text', label: '내용', type: 'textarea', value: p.text ?? '', full: true, rows: 2 }],
        backup: [], vpn_apply: [],
        vm_start: [{ name: 'p_vmId', label: 'VM', type: 'select', value: p.vmId, options: vmsList.vms.map((v) => ({ value: v.id, label: v.name })), full: true }],
        vm_stop: [{ name: 'p_vmId', label: 'VM', type: 'select', value: p.vmId, options: vmsList.vms.map((v) => ({ value: v.id, label: v.name })), full: true }],
        announcement: [{ name: 'p_title', label: '공지 제목', value: p.title ?? '', full: true }, { name: 'p_body', label: '내용', type: 'textarea', value: p.body ?? '', full: true, rows: 3 }, { name: 'p_pinned', label: '상단 고정', type: 'checkbox', value: !!p.pinned }],
        broadcast: [{ name: 'p_gameId', label: '게임', type: 'select', value: p.gameId, options: games.map((g) => ({ value: g.id, label: g.name })), full: true }, { name: 'p_text', label: '메시지', type: 'textarea', value: p.text ?? '', full: true, rows: 2 }],
      })[action] || [];
      const sch = t?.schedule || { type: 'cron', expr: '0 4 * * *' };
      const body = `${fields([{ name: 'name', label: '작업 이름', value: t?.name, required: true, full: true }, { name: 'action', label: '동작', type: 'select', value: t?.action || 'maintenance_on', options: d.actions.map((a) => ({ value: a.id, label: a.label })), full: true },
        { name: 'stype', label: '스케줄 유형', type: 'select', value: sch.type, options: [{ value: 'cron', label: 'cron 반복' }, { value: 'once', label: '1회 실행' }, { value: 'interval', label: 'N분 간격' }] },
        { name: 'expr', label: 'cron 표현식 (분 시 일 월 요일)', value: sch.expr || '0 4 * * *', mono: true }, { name: 'at', label: '실행 시각', type: 'datetime-local', value: dtLocal(sch.at || Date.now() + 3600000) }, { name: 'minutes', label: '간격 (분)', type: 'number', value: sch.minutes || 60, min: 1 }])}
        <div class="row" id="presets">${CRON_PRESETS.map(([e, l]) => `<button type="button" class="btn xs ghost" data-expr="${e}">${l}</button>`).join('')}</div>
        <div id="payload">${fields(payloadFields(t?.action || 'maintenance_on', t?.payload))}</div>`;
      const v = await modal({ title: t ? '작업 편집' : '작업 추가', wide: true, body, submit: '저장', onOpen: (form) => {
        const sync = () => { const st = form.stype.value; form.expr.closest('.field').classList.toggle('hidden', st !== 'cron'); $('#presets', form).classList.toggle('hidden', st !== 'cron'); form.at.closest('.field').classList.toggle('hidden', st !== 'once'); form.minutes.closest('.field').classList.toggle('hidden', st !== 'interval'); };
        form.stype.onchange = sync; sync();
        form.action.onchange = () => { $('#payload', form).innerHTML = fields(payloadFields(form.action.value, t && t.action === form.action.value ? t.payload : {})); };
        $('#presets', form).onclick = (e) => { const b = e.target.closest('[data-expr]'); if (b) form.expr.value = b.dataset.expr; };
      }, onSubmit: async (v) => {
        const payload = {}; for (const k of Object.keys(v)) if (k.startsWith('p_') && v[k] !== '') payload[k.slice(2)] = v[k];
        const schedule = v.stype === 'cron' ? { type: 'cron', expr: v.expr } : v.stype === 'once' ? { type: 'once', at: new Date(v.at).getTime() } : { type: 'interval', minutes: v.minutes };
        const data = { name: v.name, action: v.action, schedule, payload, enabled: t ? t.enabled : true };
        return t ? api.put(`/api/admin/tasks/${t.id}`, data) : api.post('/api/admin/tasks', data);
      } });
      if (v) { toast('저장했습니다', 'ok'); route(); }
    };
    $('#addTask').onclick = () => editor(null);
    $('#taskRows').onclick = async (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act; if (!act) return;
      const t = d.tasks.find((x) => x.id === e.target.closest('tr').dataset.t);
      if (act === 'edit') return editor(t);
      if (act === 'del') { if (await confirmDlg('작업 삭제', `"${t.name}" 을 삭제할까요?`)) { await api.del(`/api/admin/tasks/${t.id}`); route(); } }
      if (act === 'run') { try { const r = await api.post(`/api/admin/tasks/${t.id}/run`); toast(`${t.name}: ${r.result.ok ? '성공' : '실패'} — ${r.result.output.slice(0, 120)}`, r.result.ok ? 'ok' : 'error', 6000); } catch (err) { toast(err.message, 'error'); } route(); }
    };
    $('#taskRows').onchange = async (e) => { if (e.target.dataset.act === 'toggle') { const t = d.tasks.find((x) => x.id === e.target.closest('tr').dataset.t); await api.put(`/api/admin/tasks/${t.id}`, { enabled: e.target.checked }); route(); } };
    every(20000, () => route());
  },
};

// ------------------------------------------------------------ 네트워크 도구
views.network = {
  title: '네트워크 도구',
  async render(el) {
    const tool = (id, title, inputs, btn) => `<div class="card"><div class="card-title"><h3>${title}</h3></div><form data-tool="${id}" class="row">${inputs}<button class="btn primary sm" type="submit">${btn}</button></form><pre class="code mt hidden" data-out="${id}"></pre></div>`;
    el.innerHTML = `<div class="grid cols-2">
      ${tool('ping', 'Ping', '<input class="input grow" name="host" placeholder="example.com 또는 IP" required>', '실행')}
      ${tool('port', '포트 열림 확인 (TCP)', '<input class="input grow" name="host" placeholder="호스트" required><input class="input" name="port" type="number" placeholder="포트" style="width:110px" required>', '확인')}
      ${tool('dns', 'DNS 조회', '<input class="input grow" name="host" placeholder="도메인" required>', '조회')}
      ${tool('http', 'HTTP 상태 확인', '<input class="input grow" name="url" placeholder="https://…" required>', '확인')}
      <div class="card"><div class="card-title"><h3>공인 IP</h3><button class="btn sm" id="pubip">조회</button></div><pre class="code hidden" id="pubipOut"></pre></div>
      <div class="card"><div class="card-title"><h3>네트워크 인터페이스</h3><button class="btn sm" id="ifBtn">불러오기</button></div><div id="ifOut"></div></div>
      <div class="card" style="grid-column:1/-1"><div class="card-title"><h3>열린 포트 (Listening)</h3><button class="btn sm" id="lsBtn">불러오기</button></div><div id="lsOut"></div></div>
    </div>`;
    el.querySelectorAll('form[data-tool]').forEach((f) => {
      f.onsubmit = async (e) => {
        e.preventDefault();
        const out = $(`[data-out="${f.dataset.tool}"]`, el); out.classList.remove('hidden'); out.textContent = '실행 중…';
        try {
          const r = await api.post(`/api/admin/net/${f.dataset.tool}`, formValues(f));
          if (f.dataset.tool === 'ping') out.textContent = r.output;
          else if (f.dataset.tool === 'port') out.textContent = `${r.host}:${r.port} → ${r.open ? '열림 ✅' : '닫힘/실패 ❌'} (${r.ms}ms${r.error ? ', ' + r.error : ''})`;
          else if (f.dataset.tool === 'dns') out.textContent = Object.entries(r).map(([k, v]) => `${k.padEnd(6)} ${v.length ? JSON.stringify(v) : '-'}`).join('\n');
          else out.textContent = r.ok ? `HTTP ${r.status} ${r.statusText} — ${r.ms}ms\n` + Object.entries(r.headers).map(([k, v]) => `${k}: ${v}`).join('\n') : `실패 (${r.ms}ms): ${r.error}`;
        } catch (err) { out.textContent = '오류: ' + err.message; }
      };
    });
    $('#pubip').onclick = async () => { const o = $('#pubipOut'); o.classList.remove('hidden'); o.textContent = '조회 중…'; try { const r = await api.get('/api/admin/net/publicip'); o.textContent = `${r.ip}\n(출처: ${r.source})`; } catch (e) { o.textContent = e.message; } };
    $('#ifBtn').onclick = async () => { const r = await api.get('/api/admin/net/interfaces'); $('#ifOut').innerHTML = `<div class="table-wrap"><table><thead><tr><th>이름</th><th>주소</th><th>MAC</th></tr></thead><tbody>${r.filter((i) => !i.internal).map((i) => `<tr><td class="mono">${esc(i.name)}</td><td class="mono small">${esc(i.address)} <span class="dim">${esc(i.family)}</span></td><td class="mono small dim">${esc(i.mac)}</td></tr>`).join('')}</tbody></table></div>`; };
    $('#lsBtn').onclick = async () => { const r = await api.get('/api/admin/net/listening'); $('#lsOut').innerHTML = r.length ? `<div class="table-wrap"><table><thead><tr><th>프로토콜</th><th>로컬 주소</th><th>프로세스</th><th>PID</th></tr></thead><tbody>${r.map((x) => `<tr><td>${esc(x.proto)}</td><td class="mono">${esc(x.local)}</td><td>${esc(x.process || '—')}</td><td class="dim">${x.pid || ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">ss/netstat 명령을 사용할 수 없거나 결과가 없습니다</div>'; };
  },
};

// ------------------------------------------------------------ 프로세스
views.processes = {
  title: '프로세스',
  async render(el) {
    const draw = async () => {
      const [ps, disks] = await Promise.all([api.get('/api/admin/processes'), api.get('/api/admin/disks')]);
      el.innerHTML = `<div class="grid cols-2 mb"><div class="card"><div class="card-title"><h3>디스크</h3></div>${disks.map((x) => `<div class="row between small mt-s"><span class="mono">${esc(x.mount)} <span class="dim">${esc(x.fs)}</span></span><span class="muted">${fmtBytes(x.used, 0)} / ${fmtBytes(x.total, 0)} (${x.percent}%)</span></div><div class="${barClass(x.percent)}" style="height:6px"><i style="width:${x.percent}%"></i></div>`).join('') || '<p class="dim">정보 없음</p>'}</div></div>
      <div class="card"><div class="card-title"><h3>프로세스 (CPU 순 상위 60)</h3><button class="btn ghost sm icon" id="reload">${ICONS.refresh}</button></div><div class="table-wrap"><table><thead><tr><th>PID</th><th>사용자</th><th>CPU%</th><th>MEM%</th><th>RSS</th><th>경과</th><th>명령</th><th></th></tr></thead><tbody id="psRows">${ps.map((p) => `<tr data-pid="${p.pid}"><td class="mono">${p.pid}</td><td class="small">${esc(p.user)}</td><td>${p.cpu.toFixed(1)}</td><td>${p.mem.toFixed(1)}</td><td class="small">${fmtBytes(p.rss, 0)}</td><td class="small dim">${esc(p.etime)}</td><td class="mono small ellipsis" style="max-width:380px" title="${attr(p.args)}">${esc(p.comm)} <span class="dim">${esc(p.args.replace(p.comm, '').slice(0, 80))}</span></td><td class="right nowrap"><button class="btn xs warn" data-kill="0">종료</button><button class="btn xs danger" data-kill="1">강제</button></td></tr>`).join('')}</tbody></table></div></div>`;
      $('#reload').onclick = draw;
      $('#psRows').onclick = async (e) => {
        const b = e.target.closest('[data-kill]'); if (!b) return;
        const pid = e.target.closest('tr').dataset.pid;
        if (await confirmDlg('프로세스 종료', `PID ${pid} 에 ${b.dataset.kill === '1' ? 'SIGKILL' : 'SIGTERM'} 을 보낼까요?`, { submit: '종료' })) { try { await api.post(`/api/admin/processes/${pid}/kill`, { force: b.dataset.kill === '1' }); toast('신호를 보냈습니다', 'ok'); } catch (err) { toast(err.message, 'error'); } setTimeout(draw, 500); }
      };
    };
    await draw();
    every(6000, draw);
  },
};

// ------------------------------------------------------------ 백업
views.backups = {
  title: '백업',
  async render(el) {
    const list = await api.get('/api/admin/backups');
    el.innerHTML = `<div class="card"><div class="card-title"><div><h3>백업 ${list.length}개</h3><p class="muted small">설정 DB, 저장소 파일, VPN 설정, 게임/키 데이터를 tar.gz 로 묶습니다. (VM 디스크 이미지·ISO 제외) 예약 작업으로 자동화할 수 있습니다.</p></div><div class="row"><a class="btn sm" href="#/tasks">자동 백업 예약</a><button class="btn primary sm" id="mk">지금 백업</button></div></div>
      <div class="table-wrap"><table><thead><tr><th>파일</th><th>크기</th><th>생성</th><th></th></tr></thead><tbody id="rows">${list.map((b) => `<tr data-n="${attr(b.name)}"><td class="mono">${esc(b.name)}</td><td>${fmtBytes(b.size)}</td><td class="small">${fmtDate(b.mtime)} <span class="dim">(${ago(b.mtime)})</span></td><td class="right nowrap"><a class="btn xs" href="/api/admin/backups/${encodeURIComponent(b.name)}/download">다운로드</a><button class="btn xs warn" data-act="restore">복원</button><button class="btn xs danger" data-act="del">삭제</button></td></tr>`).join('') || '<tr><td colspan="4" class="empty" style="border:0">백업이 없습니다</td></tr>'}</tbody></table></div></div>`;
    $('#mk').onclick = async (e) => { e.target.disabled = true; try { const b = await api.post('/api/admin/backups'); toast(`${b.name} 생성 (${fmtBytes(b.size)})`, 'ok'); route(); } catch (err) { toast(err.message, 'error'); e.target.disabled = false; } };
    $('#rows').onclick = async (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act; if (!act) return;
      const n = e.target.closest('tr').dataset.n;
      if (act === 'del') { if (await confirmDlg('백업 삭제', `${n} 을 삭제할까요?`)) { await api.del(`/api/admin/backups/${encodeURIComponent(n)}`); route(); } }
      if (act === 'restore') { if (await confirmDlg('백업 복원', `${n} 의 내용으로 현재 데이터를 덮어씁니다. 되돌릴 수 없습니다. 계속할까요?`, { submit: '복원' })) { try { await api.post(`/api/admin/backups/${encodeURIComponent(n)}/restore`); toast('복원했습니다. 페이지를 새로고침합니다', 'ok'); setTimeout(() => location.reload(), 1200); } catch (err) { toast(err.message, 'error'); } } }
    };
  },
};

// ------------------------------------------------------------ 로그
views.logs = {
  title: '로그',
  async render(el) {
    const f = { type: '', level: '', q: '' };
    const draw = async () => {
      const d = await api.get(`/api/admin/logs?limit=300&type=${encodeURIComponent(f.type)}&level=${encodeURIComponent(f.level)}&q=${encodeURIComponent(f.q)}`);
      const rows = d.logs.map((l) => `<div class="log-item" style="grid-template-columns:130px 56px 100px 110px 1fr"><span class="dim">${fmtDate(l.ts)}</span><span class="lv ${l.level === 'error' ? 'danger' : l.level === 'warn' ? 'warn' : 'info'}">${l.level}</span><span class="muted">${esc(l.type)}</span><span class="dim mono small">${esc(l.ip || '')}</span><span>${esc(l.msg)}</span></div>`).join('');
      if (!$('#logBox')) {
        el.innerHTML = `<div class="card"><div class="card-title"><h3>활동 로그 <span class="muted small" id="logTotal"></span></h3><div class="row"><select class="select" id="fType" style="width:150px"><option value="">모든 유형</option>${d.types.map((t) => `<option ${t === f.type ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select><select class="select" id="fLevel" style="width:120px"><option value="">모든 수준</option><option value="info">info</option><option value="warn">warn</option><option value="error">error</option></select><input class="input" id="fQ" placeholder="검색…" style="width:180px"><button class="btn sm danger" id="clearLogs">비우기</button></div></div><div class="log-list" id="logBox"></div></div>`;
        $('#fType').onchange = (e) => { f.type = e.target.value; draw(); };
        $('#fLevel').onchange = (e) => { f.level = e.target.value; draw(); };
        let t; $('#fQ').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { f.q = e.target.value; draw(); }, 300); };
        $('#clearLogs').onclick = async () => { if (await confirmDlg('로그 비우기', '모든 로그를 삭제할까요?')) { await api.del('/api/admin/logs'); draw(); } };
      }
      $('#logTotal').textContent = `(${d.logs.length} / 전체 ${d.total})`;
      $('#logBox').innerHTML = rows || '<div class="empty">로그가 없습니다</div>';
    };
    await draw();
    every(5000, draw);
  },
};

// ------------------------------------------------------------ 설정
views.settings = {
  title: '설정',
  async render(el) {
    const [s, tokens] = await Promise.all([api.get('/api/admin/settings'), api.get('/api/admin/tokens')]);
    el.innerHTML = `<div class="grid cols-2">
      <div class="card"><div class="card-title"><h3>사이트</h3></div><form id="siteForm" class="col">${fields([{ name: 'siteName', label: '사이트 이름', value: s.siteName, full: true }, { name: 'description', label: '공개 페이지 설명', type: 'textarea', value: s.description, full: true, rows: 2 }, { name: 'publicHost', label: '공개 호스트 (도메인/IP)', value: s.publicHost, help: 'VPN 엔드포인트 기본값 등에 사용', full: true }, { name: 'trustProxy', label: '리버스 프록시 뒤에서 실행 (X-Forwarded-For 신뢰)', type: 'checkbox', value: s.trustProxy, full: true }])}<div class="row mt"><button class="btn primary" type="submit">저장</button></div></form></div>
      <div class="card"><div class="card-title"><h3>Discord 알림</h3></div><form id="hookForm" class="col">${fields([{ name: 'discordWebhook', label: '웹훅 URL', value: s.discordWebhook, full: true, mono: true, placeholder: 'https://discord.com/api/webhooks/…', help: '점검 시작/종료, VM 시작, 예약 작업 알림 등을 전송합니다' }])}<div class="row mt"><button class="btn primary" type="submit">저장</button><button type="button" class="btn" id="testHook">테스트 전송</button></div></form>
        <div class="card-title mt"><h3>가상 머신 기본 백엔드</h3></div><form id="vmForm" class="row">${fields([{ name: 'defaultBackend', label: '기본 백엔드', type: 'select', value: s.vm.defaultBackend, options: [{ value: 'auto', label: '자동 (QEMU → Docker → 시뮬레이션)' }, { value: 'qemu', label: 'QEMU' }, { value: 'docker', label: 'Docker' }, { value: 'simulated', label: '시뮬레이션' }] }])}<button class="btn" type="submit" style="margin-top:22px">저장</button></form></div>
      <div class="card"><div class="card-title"><h3>관리자 비밀번호</h3></div><form id="pwForm" class="col">${fields([{ name: 'current', label: '현재 비밀번호', type: 'password', required: true, full: true }, { name: 'next', label: '새 비밀번호', type: 'password', required: true }, { name: 'next2', label: '새 비밀번호 확인', type: 'password', required: true }])}<div class="row mt"><button class="btn primary" type="submit">변경</button><span class="dim small">변경 시 모든 세션이 로그아웃됩니다</span></div></form></div>
      <div class="card" style="grid-column:1/-1"><div class="card-title"><h3>API 토큰</h3><button class="btn primary sm" id="addToken">+ 토큰</button></div><p class="muted small">외부 스크립트/자동화에서 <code>Authorization: Bearer 토큰</code> 헤더로 관리자 API 를 호출할 수 있습니다.</p><div class="table-wrap mt"><table><thead><tr><th>이름</th><th>토큰</th><th>생성</th><th>마지막 사용</th><th></th></tr></thead><tbody id="tokRows">${tokens.map((t) => `<tr data-t="${t.id}"><td>${esc(t.name)}</td><td class="mono small">${esc(t.preview)}</td><td class="small dim">${fmtDate(t.created)}</td><td class="small dim">${t.lastUsed ? ago(t.lastUsed) : '—'}</td><td class="right"><button class="btn xs danger" data-del>삭제</button></td></tr>`).join('') || '<tr><td colspan="5" class="dim small" style="border:0">토큰이 없습니다</td></tr>'}</tbody></table></div></div>
      <div class="card" style="grid-column:1/-1"><div class="card-title"><h3>시스템</h3><button class="btn danger sm" id="restart">서버 프로세스 재시작</button></div><dl class="kv"><dt>버전</dt><dd>HALCYON 홈 서버 콘솔 v${esc(s.system.version)}</dd><dt>Node.js</dt><dd>${esc(s.system.node)}</dd><dt>데이터 폴더</dt><dd class="mono">${esc(s.system.dataDir)}</dd><dt>바인딩</dt><dd class="mono">${esc(s.system.host)}:${s.system.port}</dd><dt>PID</dt><dd>${s.system.pid}</dd><dt>가동 시간</dt><dd>${fmtDur(s.system.uptime)}</dd></dl>
        <p class="dim small mt">환경 변수: <code>PORT</code> (기본 3000), <code>HOST</code> (기본 0.0.0.0), <code>DATA_DIR</code> (기본 ./data). 리버스 프록시(nginx/caddy)로 HTTPS 를 붙이고 "리버스 프록시" 옵션을 켜는 것을 권장합니다.</p></div>
    </div>`;
    $('#siteForm').onsubmit = async (e) => { e.preventDefault(); await api.put('/api/admin/settings', formValues(e.target)); state.auth = await api.get('/api/auth/state'); $('#brandName').textContent = state.auth.siteName; toast('저장했습니다', 'ok'); };
    $('#hookForm').onsubmit = async (e) => { e.preventDefault(); await api.put('/api/admin/settings', formValues(e.target)); toast('저장했습니다', 'ok'); };
    $('#testHook').onclick = async () => { try { const r = await api.post('/api/admin/settings/test-webhook', { url: $('#hookForm').discordWebhook.value }); toast(r.message, 'ok'); } catch (err) { toast(err.message, 'error', 6000); } };
    $('#vmForm').onsubmit = async (e) => { e.preventDefault(); await api.put('/api/admin/settings', { vm: formValues(e.target) }); toast('저장했습니다', 'ok'); };
    $('#pwForm').onsubmit = async (e) => { e.preventDefault(); const v = formValues(e.target); if (v.next !== v.next2) return toast('새 비밀번호가 일치하지 않습니다', 'error'); try { await api.post('/api/admin/password', v); toast('변경했습니다. 다시 로그인하세요', 'ok'); setTimeout(() => location.reload(), 800); } catch (err) { toast(err.message, 'error'); } };
    $('#addToken').onclick = async () => { const v = await modal({ title: 'API 토큰 생성', body: fields([{ name: 'name', label: '이름', required: true, full: true }]), submit: '생성', onSubmit: (v) => api.post('/api/admin/tokens', v) }); if (v) { await modal({ title: '토큰이 생성되었습니다', body: `<p class="muted small">이 토큰은 지금만 표시됩니다. 안전한 곳에 보관하세요.</p><pre class="code">${esc(v.token)}</pre>`, submit: '복사', cancel: '닫기', onSubmit: () => { copy(v.token); return true; } }); route(); } };
    $('#tokRows').onclick = async (e) => { if (e.target.closest('[data-del]')) { await api.del(`/api/admin/tokens/${e.target.closest('tr').dataset.t}`); route(); } };
    $('#restart').onclick = async () => { if (await confirmDlg('서버 재시작', '프로세스를 종료합니다. systemd/pm2/docker 같은 감시 프로세스가 있어야 자동으로 다시 시작됩니다.', { submit: '재시작' })) { const r = await api.post('/api/admin/restart'); toast(r.message, 'warn', 6000); } };
  },
};

// ------------------------------------------------------------ 시작
window.addEventListener('hashchange', () => { if (state.auth && state.auth.authed) route(); else if (state.auth) renderShell(); });
(async () => {
  try { state.auth = await api.get('/api/auth/state', { noAuthRedirect: true }); }
  catch (e) { $('#app').innerHTML = `<div class="boot">서버에 연결할 수 없습니다: ${esc(e.message)}</div>`; return; }
  renderShell();
})();
})();
