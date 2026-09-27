'use strict';
/*
 * Server Hub — 서버 관리 사이트 (외부 의존성 없음, Node.js 18+)
 * 점검 모드 · 게임 연동(키/하트비트/브로드캐스트) · VPN(WireGuard) · 가상 저장소 · 가상 머신 · 예약 작업 · 백업 · 네트워크 도구 · 모니터링
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const { HttpError, id, parseCookies, readJson, sendJson, sendText, sendFile, clientIp, clamp, str } = require('./lib/util');
const { Store } = require('./lib/store');
const { Auth } = require('./lib/auth');
const { Monitor } = require('./lib/monitor');
const { Notify } = require('./lib/notify');
const { Storage } = require('./lib/storage');
const { Vpn } = require('./lib/vpn');
const { VmManager } = require('./lib/vm');
const { Games } = require('./lib/games');
const { Scheduler, ACTIONS, ACTION_LABELS } = require('./lib/scheduler');
const { Backup } = require('./lib/backup');
const nettools = require('./lib/nettools');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const PUBLIC_DIR = path.join(__dirname, 'public');
const VERSION = require('./package.json').version;

fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------------------------------------------------------------- 데이터
const defaults = () => ({
  admin: null,
  sessions: {},
  tokens: [],
  settings: {
    siteName: 'Server Hub',
    description: '서버 상태와 공지를 확인할 수 있는 페이지입니다.',
    publicHost: '',
    discordWebhook: '',
    trustProxy: false,
    maintenance: { enabled: false, title: '서버 점검 중입니다', message: '더 나은 서비스를 위해 점검을 진행하고 있습니다. 잠시 후 다시 접속해 주세요.', until: null, allowIps: [], bypassKey: '', blockGames: true, startedAt: null },
    storage: { quotaMB: 10240 },
    vpn: { interface: 'wg0', address: '10.8.0.1/24', port: 51820, endpoint: '', dns: '1.1.1.1', allowedIps: '0.0.0.0/0, ::/0', nat: true, natInterface: 'eth0', mtu: 0, privateKey: '', publicKey: '' },
    vm: { defaultBackend: 'auto' },
  },
  announcements: [],
  games: [],
  keys: [],
  vpnPeers: [],
  vms: [],
  tasks: [],
  shares: [],
  logs: [],
});

const store = new Store(path.join(DATA_DIR, 'db.json'), defaults);

const ctx = {
  dataDir: DATA_DIR,
  store,
  get db() { return store.data; },
  audit(level, type, msg, ip) {
    const entry = { ts: Date.now(), level, type, msg: String(msg).slice(0, 1000), ip: ip || null };
    store.data.logs.push(entry);
    if (store.data.logs.length > 3000) store.data.logs.splice(0, store.data.logs.length - 3000);
    store.save();
    const line = `[${new Date(entry.ts).toISOString()}] ${level.toUpperCase().padEnd(5)} ${type}: ${entry.msg}`;
    if (level === 'error') console.error(line); else console.log(line);
  },
};

const auth = new Auth(ctx);
const monitor = new Monitor();
const notify = new Notify(ctx);
ctx.notify = notify;
const storage = new Storage(ctx);
const vpn = new Vpn(ctx);
const vms = new VmManager(ctx);
const games = new Games(ctx);
const backup = new Backup(ctx);

// ---------------------------------------------------------------- 점검 모드
const maint = () => ctx.db.settings.maintenance;

function setMaintenance(patch, who = 'admin') {
  const m = maint();
  const wasOn = m.enabled;
  if (patch.enabled !== undefined) m.enabled = !!patch.enabled;
  if (patch.title !== undefined) m.title = str(patch.title, 120).trim() || '서버 점검 중입니다';
  if (patch.message !== undefined) m.message = str(patch.message, 2000);
  if (patch.until !== undefined) { const t = patch.until ? new Date(patch.until).getTime() : null; m.until = Number.isFinite(t) ? t : null; }
  if (patch.allowIps !== undefined) m.allowIps = (Array.isArray(patch.allowIps) ? patch.allowIps : String(patch.allowIps).split(/[\n,]/)).map((s) => s.trim()).filter(Boolean).slice(0, 100);
  if (patch.bypassKey !== undefined) m.bypassKey = str(patch.bypassKey, 80).trim();
  if (patch.blockGames !== undefined) m.blockGames = !!patch.blockGames;
  if (m.enabled && !wasOn) m.startedAt = Date.now();
  if (!m.enabled) { m.startedAt = null; if (patch.enabled === false) m.until = null; }
  store.save();
  if (m.enabled !== wasOn) {
    ctx.audit('warn', 'maintenance', `점검 모드 ${m.enabled ? '시작' : '종료'} (${who})${m.enabled && m.until ? ' · 예상 종료 ' + new Date(m.until).toLocaleString('ko-KR') : ''}`);
    notify.fire(m.enabled ? '🔧 점검 모드 시작' : '✅ 점검 모드 종료', m.enabled ? `${m.title}\n${m.message}${m.until ? `\n예상 종료: ${new Date(m.until).toLocaleString('ko-KR')}` : ''}` : '서비스가 정상 운영 중입니다.', m.enabled ? 'maint' : 'ok');
  }
  return m;
}

// 예정 시각이 지나면 자동 종료
setInterval(() => {
  const m = maint();
  if (m.enabled && m.until && m.until <= Date.now()) setMaintenance({ enabled: false }, '자동(예상 종료 시각 도달)');
}, 15000).unref();

function maintenanceView() {
  const m = maint();
  return { enabled: m.enabled, title: m.title, message: m.message, until: m.until, startedAt: m.startedAt, blockGames: m.blockGames };
}

function isBypass(req, ip) {
  const m = maint();
  if (!m.enabled) return true;
  if (m.allowIps.includes(ip)) return true;
  const cookies = parseCookies(req);
  if (auth.getSession(cookies.sid)) return true;
  if (m.bypassKey && cookies.bypass === m.bypassKey) return true;
  return false;
}

// ---------------------------------------------------------------- 공지
function addAnnouncement(input) {
  const a = { id: id(8), title: str(input.title, 120).trim(), body: str(input.body, 4000), pinned: !!input.pinned, created: Date.now(), updated: Date.now() };
  if (!a.title) throw new HttpError(400, '제목을 입력하세요');
  ctx.db.announcements.unshift(a);
  if (ctx.db.announcements.length > 200) ctx.db.announcements.length = 200;
  store.save();
  return a;
}
function publicAnnouncements(limit = 10) {
  return ctx.db.announcements.slice().sort((a, b) => (b.pinned - a.pinned) || (b.created - a.created)).slice(0, limit);
}

// ---------------------------------------------------------------- 예약 작업 액션
const { sh } = require('./lib/util');
const scheduler = new Scheduler(ctx, {
  maintenance_on: async (p) => {
    const until = p.durationMin ? Date.now() + clamp(p.durationMin, 1, 100000, 60) * 60000 : (p.until || null);
    setMaintenance({ enabled: true, title: p.title, message: p.message, until }, '예약 작업');
    return '점검 모드를 켰습니다' + (until ? ` (종료 예정 ${new Date(until).toLocaleString('ko-KR')})` : '');
  },
  maintenance_off: async () => { setMaintenance({ enabled: false }, '예약 작업'); return '점검 모드를 껐습니다'; },
  shell: async (p) => {
    if (!p.command) throw new Error('명령이 비어 있습니다');
    const r = await sh(p.command, { timeout: clamp(p.timeoutSec, 1, 3600, 120) * 1000, cwd: DATA_DIR });
    const out = (r.stdout + (r.stderr ? '\n' + r.stderr : '')).trim();
    if (!r.ok) throw new Error(`종료 코드 ${r.code}: ${out.slice(0, 1500)}`);
    return out || '(출력 없음)';
  },
  webhook: async (p) => { const r = await notify.send(p.title || '예약 알림', p.text || '', p.level || 'info'); if (!r.ok) throw new Error(r.message); return r.message; },
  backup: async () => { const b = await backup.create(); ctx.audit('info', 'backup', `백업 생성 ${b.name}`); return `${b.name} (${Math.round(b.size / 1024)} KB)`; },
  vm_start: async (p) => { const vm = await vms.start(p.vmId); return `${vm.name} 시작`; },
  vm_stop: async (p) => { const vm = await vms.stop(p.vmId); return `${vm.name} 정지`; },
  vpn_apply: async () => { const r = await vpn.apply(); if (!r.ok) throw new Error(r.message); return r.message; },
  announcement: async (p) => { const a = addAnnouncement(p); return `공지 등록: ${a.title}`; },
  broadcast: async (p) => { const b = games.broadcast(p.gameId, p.text, p); return `브로드캐스트: ${b.text}`; },
});

// ---------------------------------------------------------------- 라우터
const routes = [];
function route(method, pattern, handler, opts = {}) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/\/:([a-zA-Z]+)(\*)?/g, (_, k, star) => { keys.push(k); return star ? '/(.+)' : '/([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, handler, opts });
}

function setCookie(res, name, value, opts = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax`;
  if (opts.maxAge !== undefined) c += `; Max-Age=${opts.maxAge}`;
  if (opts.secure) c += '; Secure';
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', prev ? [].concat(prev, c) : c);
}

function requireAdmin(req) {
  const cookies = parseCookies(req);
  if (auth.getSession(cookies.sid)) return { via: 'session' };
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ') && auth.findToken(h.slice(7).trim())) return { via: 'token' };
  throw new HttpError(401, auth.isSetup() ? '로그인이 필요합니다' : '초기 설정이 필요합니다');
}

function requireGame(req, q) {
  const key = req.headers['x-game-key'] || q.get('key') || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const g = games.byApiKey(String(key || ''));
  if (!g) throw new HttpError(401, '게임 API 키가 올바르지 않습니다');
  return g;
}

// ------------------------------------------------ 인증
route('GET', '/api/auth/state', async (r) => {
  const cookies = parseCookies(r.req);
  const s = auth.getSession(cookies.sid);
  return { setup: auth.isSetup(), authed: !!s, username: s ? ctx.db.admin.username : null, siteName: ctx.db.settings.siteName, version: VERSION };
});
route('POST', '/api/auth/setup', async (r) => {
  const b = await readJson(r.req);
  auth.setup(b.username, b.password);
  if (b.siteName) ctx.db.settings.siteName = str(b.siteName, 60).trim() || 'Server Hub';
  const sid = auth.createSession(r.ip);
  setCookie(r.res, 'sid', sid, { maxAge: 7 * 86400, secure: r.secure });
  ctx.audit('info', 'auth', `초기 설정 완료 (관리자 ${b.username})`, r.ip);
  return { ok: true };
});
route('POST', '/api/auth/login', async (r) => {
  const b = await readJson(r.req);
  try {
    const sid = auth.login(String(b.username || ''), String(b.password || ''), r.ip);
    setCookie(r.res, 'sid', sid, { maxAge: 7 * 86400, secure: r.secure });
    ctx.audit('info', 'auth', `로그인 성공 (${b.username})`, r.ip);
    return { ok: true, username: ctx.db.admin.username };
  } catch (e) {
    ctx.audit('warn', 'auth', `로그인 실패 (${String(b.username || '').slice(0, 40)}): ${e.message}`, r.ip);
    throw e;
  }
});
route('POST', '/api/auth/logout', async (r) => {
  auth.destroySession(parseCookies(r.req).sid);
  setCookie(r.res, 'sid', '', { maxAge: 0 });
  return { ok: true };
});

// ------------------------------------------------ 공개
route('GET', '/api/public/status', async () => ({
  siteName: ctx.db.settings.siteName,
  description: ctx.db.settings.description,
  maintenance: maintenanceView(),
  announcements: publicAnnouncements(10),
  games: ctx.db.games.map((g) => ({ name: g.name, online: games.online(g.id), servers: games.servers(g.id).length, version: g.version })),
  online: games.totalOnline(),
  time: Date.now(),
}));

// ------------------------------------------------ 게임 API (게임 스크립트가 호출)
route('GET', '/api/game/status', async (r) => {
  const g = requireGame(r.req, r.query);
  const m = maintenanceView();
  return { ok: !(m.enabled && m.blockGames), game: g.name, version: g.version, scriptUrl: g.scriptUrl, message: g.message, maintenance: m, online: games.online(g.id), announcements: publicAnnouncements(5).map((a) => ({ title: a.title, body: a.body, created: a.created })), time: Date.now() };
});
route('POST', '/api/game/heartbeat', async (r) => {
  const g = requireGame(r.req, r.query);
  const b = await readJson(r.req, 64 * 1024);
  const info = games.heartbeat(g, b);
  const m = maintenanceView();
  return { ok: true, ...info, maintenance: m, kick: m.enabled && m.blockGames, broadcasts: games.broadcastsSince(g, b.since), version: g.version, time: Date.now() };
});
route('POST', '/api/game/key/validate', async (r) => {
  const g = requireGame(r.req, r.query);
  const b = await readJson(r.req, 16 * 1024);
  const m = maintenanceView();
  if (m.enabled && m.blockGames) return { ok: false, valid: false, reason: 'maintenance', message: m.title, maintenance: m };
  if (!g.keyRequired) return { ok: true, valid: true, reason: 'not_required', message: '키 인증이 필요하지 않은 게임입니다', maintenance: m };
  const v = games.validateKey(g, b.key, b.hwid, r.ip);
  if (!v.valid) ctx.audit('warn', 'game', `[${g.name}] 키 인증 실패 (${v.reason}) key=${str(b.key, 40)}`, r.ip);
  return { ok: v.valid, ...v, maintenance: m };
});
route('POST', '/api/game/log', async (r) => {
  const g = requireGame(r.req, r.query);
  const b = await readJson(r.req, 16 * 1024);
  games.addLog(g, b, r.ip);
  return { ok: true };
});
route('GET', '/api/game/broadcasts', async (r) => {
  const g = requireGame(r.req, r.query);
  return { ok: true, broadcasts: games.broadcastsSince(g, r.query.get('since')), time: Date.now() };
});

// ------------------------------------------------ 관리자: 개요/모니터링
const admin = (method, p, h) => route(method, p, h, { admin: true });

admin('GET', '/api/admin/overview', async () => {
  const usage = await storage.usage();
  const nextTask = ctx.db.tasks.filter((t) => t.enabled && t.nextRun).sort((a, b) => a.nextRun - b.nextRun)[0] || null;
  return {
    monitor: monitor.snapshot(),
    maintenance: maintenanceView(),
    counts: { vms: ctx.db.vms.length, vmsRunning: ctx.db.vms.filter((v) => v.state === 'running').length, peers: ctx.db.vpnPeers.length, games: ctx.db.games.length, online: games.totalOnline(), keys: ctx.db.keys.length, tasks: ctx.db.tasks.filter((t) => t.enabled).length, announcements: ctx.db.announcements.length, shares: ctx.db.shares.length },
    storage: usage,
    nextTask: nextTask ? { name: nextTask.name, nextRun: nextTask.nextRun, action: ACTION_LABELS[nextTask.action] } : null,
    logs: ctx.db.logs.slice(-12).reverse(),
    disks: await monitor.disks(),
    vmBackends: vms.backends,
    siteName: ctx.db.settings.siteName,
  };
});
admin('GET', '/api/admin/monitor', async () => monitor.snapshot());
admin('GET', '/api/admin/disks', async () => monitor.disks());
admin('GET', '/api/admin/processes', async () => monitor.processes(60));
admin('POST', '/api/admin/processes/:pid/kill', async (r) => {
  const pid = clamp(r.params.pid, 2, 4194304, 0);
  if (!pid || pid === process.pid) throw new HttpError(400, '해당 프로세스는 종료할 수 없습니다');
  const b = await readJson(r.req);
  try { process.kill(pid, b.force ? 'SIGKILL' : 'SIGTERM'); } catch (e) { throw new HttpError(400, '종료 실패: ' + e.message); }
  ctx.audit('warn', 'system', `프로세스 ${pid} 에 ${b.force ? 'SIGKILL' : 'SIGTERM'} 전송`, r.ip);
  return { ok: true };
});

// ------------------------------------------------ 관리자: 점검 모드
admin('GET', '/api/admin/maintenance', async () => ({ ...maint(), privateKey: undefined }));
admin('PUT', '/api/admin/maintenance', async (r) => { const b = await readJson(r.req); return setMaintenance(b, `관리자 ${r.ip}`); });
admin('POST', '/api/admin/maintenance/toggle', async (r) => {
  const b = await readJson(r.req);
  const m = maint();
  const patch = { enabled: !m.enabled };
  if (patch.enabled && b.durationMin) patch.until = Date.now() + clamp(b.durationMin, 1, 100000, 60) * 60000;
  return setMaintenance(patch, `관리자 ${r.ip}`);
});

// ------------------------------------------------ 관리자: 설정
function settingsView() {
  const s = ctx.db.settings;
  return { siteName: s.siteName, description: s.description, publicHost: s.publicHost, discordWebhook: s.discordWebhook, trustProxy: s.trustProxy, storage: s.storage, vm: s.vm, system: { version: VERSION, node: process.version, dataDir: DATA_DIR, port: PORT, host: HOST, pid: process.pid, uptime: process.uptime() } };
}
admin('GET', '/api/admin/settings', async () => settingsView());
admin('PUT', '/api/admin/settings', async (r) => {
  const b = await readJson(r.req);
  const s = ctx.db.settings;
  if (b.siteName !== undefined) s.siteName = str(b.siteName, 60).trim() || 'Server Hub';
  if (b.description !== undefined) s.description = str(b.description, 500);
  if (b.publicHost !== undefined) s.publicHost = str(b.publicHost, 253).trim();
  if (b.discordWebhook !== undefined) s.discordWebhook = str(b.discordWebhook, 400).trim();
  if (b.trustProxy !== undefined) s.trustProxy = !!b.trustProxy;
  if (b.storage && b.storage.quotaMB !== undefined) s.storage.quotaMB = clamp(b.storage.quotaMB, 0, 100 * 1024 * 1024, s.storage.quotaMB);
  if (b.vm && b.vm.defaultBackend !== undefined) s.vm.defaultBackend = ['auto', 'qemu', 'docker', 'simulated'].includes(b.vm.defaultBackend) ? b.vm.defaultBackend : 'auto';
  store.save();
  ctx.audit('info', 'settings', '설정 변경', r.ip);
  return settingsView();
});
admin('POST', '/api/admin/settings/test-webhook', async (r) => {
  const b = await readJson(r.req);
  const res = await notify.send('🔔 테스트 알림', `${ctx.db.settings.siteName} 에서 보낸 테스트 메시지입니다.`, 'info', b.url || undefined);
  if (!res.ok) throw new HttpError(400, res.message);
  return res;
});
admin('POST', '/api/admin/password', async (r) => { const b = await readJson(r.req); auth.changePassword(String(b.current || ''), String(b.next || '')); ctx.audit('warn', 'auth', '관리자 비밀번호 변경 (모든 세션 로그아웃)', r.ip); return { ok: true }; });
admin('GET', '/api/admin/tokens', async () => auth.listTokens());
admin('POST', '/api/admin/tokens', async (r) => { const b = await readJson(r.req); const t = auth.createToken(b.name); ctx.audit('info', 'auth', `API 토큰 생성: ${t.name}`, r.ip); return t; });
admin('DELETE', '/api/admin/tokens/:id', async (r) => { auth.deleteToken(r.params.id); return { ok: true }; });
admin('POST', '/api/admin/restart', async (r) => {
  ctx.audit('warn', 'system', '관리자가 서버 재시작 요청 (프로세스 종료)', r.ip);
  setTimeout(() => process.exit(0), 300);
  return { ok: true, message: '프로세스를 종료합니다. systemd/pm2/docker 등 감시 프로세스가 있어야 자동으로 재시작됩니다.' };
});

// ------------------------------------------------ 관리자: 공지
admin('GET', '/api/admin/announcements', async () => ctx.db.announcements);
admin('POST', '/api/admin/announcements', async (r) => { const a = addAnnouncement(await readJson(r.req)); ctx.audit('info', 'announce', `공지 등록: ${a.title}`, r.ip); return a; });
admin('PUT', '/api/admin/announcements/:id', async (r) => {
  const a = ctx.db.announcements.find((x) => x.id === r.params.id);
  if (!a) throw new HttpError(404, '공지를 찾을 수 없습니다');
  const b = await readJson(r.req);
  if (b.title !== undefined) a.title = str(b.title, 120).trim() || a.title;
  if (b.body !== undefined) a.body = str(b.body, 4000);
  if (b.pinned !== undefined) a.pinned = !!b.pinned;
  a.updated = Date.now();
  store.save();
  return a;
});
admin('DELETE', '/api/admin/announcements/:id', async (r) => { ctx.db.announcements = ctx.db.announcements.filter((x) => x.id !== r.params.id); store.save(); return { ok: true }; });

// ------------------------------------------------ 관리자: 게임 연동
admin('GET', '/api/admin/games', async () => games.list());
admin('POST', '/api/admin/games', async (r) => { const g = games.create(await readJson(r.req)); ctx.audit('info', 'game', `게임 등록: ${g.name}`, r.ip); return games.publicView(g); });
admin('GET', '/api/admin/games/:id', async (r) => { const g = games.get(r.params.id); return { ...games.publicView(g), servers: games.servers(g.id), logs: g.logs.slice(-100).reverse(), broadcasts: g.broadcasts.slice().reverse() }; });
admin('PUT', '/api/admin/games/:id', async (r) => games.publicView(games.update(r.params.id, await readJson(r.req))));
admin('DELETE', '/api/admin/games/:id', async (r) => { const g = games.get(r.params.id); games.remove(r.params.id); ctx.audit('warn', 'game', `게임 삭제: ${g.name}`, r.ip); return { ok: true }; });
admin('POST', '/api/admin/games/:id/rotate-key', async (r) => ({ apiKey: games.rotateKey(r.params.id) }));
admin('POST', '/api/admin/games/:id/broadcast', async (r) => { const b = await readJson(r.req); const msg = games.broadcast(r.params.id, b.text, b); ctx.audit('info', 'game', `브로드캐스트: ${msg.text}`, r.ip); return msg; });
admin('GET', '/api/admin/games/:id/servers', async (r) => games.servers(r.params.id));
admin('GET', '/api/admin/games/:id/logs', async (r) => games.get(r.params.id).logs.slice().reverse());
admin('DELETE', '/api/admin/games/:id/logs', async (r) => { games.get(r.params.id).logs = []; store.save(); return { ok: true }; });
admin('GET', '/api/admin/keys', async (r) => games.listKeys(r.query.get('gameId') || ''));
admin('POST', '/api/admin/keys', async (r) => { const ks = games.createKeys(await readJson(r.req)); ctx.audit('info', 'game', `라이선스 키 ${ks.length}개 생성`, r.ip); return ks; });
admin('PUT', '/api/admin/keys/:id', async (r) => games.updateKey(r.params.id, await readJson(r.req)));
admin('DELETE', '/api/admin/keys/:id', async (r) => { games.deleteKey(r.params.id); return { ok: true }; });

// ------------------------------------------------ 관리자: VPN
admin('GET', '/api/admin/vpn', async () => {
  const status = await vpn.status();
  const s = ctx.db.settings.vpn;
  return { settings: { ...s, privateKey: undefined }, peers: ctx.db.vpnPeers.map((p) => ({ ...p, privateKey: undefined, presharedKey: undefined, live: status.peers[p.publicKey] || null })), status, confPath: vpn.confPath(), serverConfig: vpn.serverConfig() };
});
admin('PUT', '/api/admin/vpn/settings', async (r) => { const s = vpn.updateSettings(await readJson(r.req)); ctx.audit('info', 'vpn', 'VPN 설정 변경', r.ip); return { ...s, privateKey: undefined }; });
admin('POST', '/api/admin/vpn/regenerate-keys', async (r) => { const pub = vpn.regenerateKeys(); ctx.audit('warn', 'vpn', '서버 키 재생성 (모든 클라이언트 설정 재배포 필요)', r.ip); return { publicKey: pub }; });
admin('POST', '/api/admin/vpn/peers', async (r) => { const b = await readJson(r.req); const p = vpn.addPeer(b.name); ctx.audit('info', 'vpn', `VPN 피어 추가: ${p.name} (${p.ip})`, r.ip); return { ...p, privateKey: undefined, presharedKey: undefined, config: vpn.clientConfig(p) }; });
admin('PUT', '/api/admin/vpn/peers/:id', async (r) => { const p = vpn.updatePeer(r.params.id, await readJson(r.req)); return { ...p, privateKey: undefined, presharedKey: undefined }; });
admin('DELETE', '/api/admin/vpn/peers/:id', async (r) => { const p = vpn.getPeer(r.params.id); vpn.removePeer(r.params.id); ctx.audit('info', 'vpn', `VPN 피어 삭제: ${p.name}`, r.ip); return { ok: true }; });
admin('GET', '/api/admin/vpn/peers/:id/config', async (r) => {
  const p = vpn.getPeer(r.params.id);
  const conf = vpn.clientConfig(p);
  if (r.query.get('download')) { sendText(r.res, 200, conf, 'text/plain; charset=utf-8', { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(p.name.replace(/[^a-zA-Z0-9가-힣_-]/g, '_') + '.conf')}` }); return null; }
  return { config: conf };
});
admin('GET', '/api/admin/vpn/server-config', async (r) => { sendText(r.res, 200, vpn.serverConfig(), 'text/plain; charset=utf-8', { 'Content-Disposition': `attachment; filename="${ctx.db.settings.vpn.interface}.conf"` }); return null; });
admin('POST', '/api/admin/vpn/apply', async (r) => { const res = await vpn.apply(); ctx.audit(res.ok ? 'info' : 'error', 'vpn', `VPN 적용: ${res.message}`, r.ip); if (!res.ok) throw new HttpError(500, res.message); return res; });
admin('POST', '/api/admin/vpn/down', async (r) => { const res = await vpn.down(); ctx.audit('info', 'vpn', `VPN 중지: ${res.message}`, r.ip); return res; });

// ------------------------------------------------ 관리자: 가상 저장소
admin('GET', '/api/admin/storage/list', async (r) => storage.list(r.query.get('path') || '/'));
admin('GET', '/api/admin/storage/usage', async () => storage.usage());
admin('POST', '/api/admin/storage/mkdir', async (r) => { const b = await readJson(r.req); return { path: await storage.mkdir(b.path) }; });
admin('POST', '/api/admin/storage/delete', async (r) => {
  const b = await readJson(r.req);
  const paths = Array.isArray(b.paths) ? b.paths : [b.path];
  for (const p of paths) await storage.remove(p);
  ctx.audit('info', 'storage', `삭제: ${paths.join(', ').slice(0, 300)}`, r.ip);
  return { ok: true };
});
admin('POST', '/api/admin/storage/rename', async (r) => { const b = await readJson(r.req); await storage.rename(b.from, b.to); return { ok: true }; });
admin('PUT', '/api/admin/storage/upload', async (r) => {
  const dir = r.query.get('path') || '/';
  const name = decodeURIComponent(r.req.headers['x-file-name'] || r.query.get('name') || '');
  const out = await storage.upload(r.req, dir, name);
  ctx.audit('info', 'storage', `업로드: ${out.path} (${out.size} bytes)`, r.ip);
  return out;
});
admin('GET', '/api/admin/storage/download', async (r) => {
  const s = await storage.stat(r.query.get('path') || '');
  if (s.isDir) {
    const child = storage.tarStream(s.rel);
    r.res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(s.name + '.tar.gz')}` });
    child.stdout.pipe(r.res);
    return null;
  }
  await sendFile(r.res, s.abs, { download: s.name });
  return null;
});
admin('GET', '/api/admin/storage/text', async (r) => storage.readText(r.query.get('path') || ''));
admin('POST', '/api/admin/storage/text', async (r) => { const b = await readJson(r.req, 4 * 1024 * 1024); return storage.writeText(b.path, b.content); });
admin('GET', '/api/admin/storage/shares', async () => storage.listShares());
admin('POST', '/api/admin/storage/shares', async (r) => { const b = await readJson(r.req); await storage.stat(b.path); const s = storage.createShare(b.path, Number(b.expiresHours) || 0); ctx.audit('info', 'storage', `공유 링크 생성: ${s.path}`, r.ip); return s; });
admin('DELETE', '/api/admin/storage/shares/:id', async (r) => { storage.deleteShare(r.params.id); return { ok: true }; });

// ------------------------------------------------ 관리자: 가상 머신
admin('GET', '/api/admin/vms', async () => ({ vms: ctx.db.vms, backends: vms.backends, isos: vms.listIsos(), isoDir: vms.isoDir, defaultBackend: ctx.db.settings.vm.defaultBackend }));
admin('POST', '/api/admin/vms', async (r) => { const b = await readJson(r.req); if (!b.backend || b.backend === 'auto') b.backend = ctx.db.settings.vm.defaultBackend; const vm = await vms.create(b); ctx.audit('info', 'vm', `VM 생성: ${vm.name} (${vm.backend})`, r.ip); return vm; });
admin('POST', '/api/admin/vms/detect', async () => vms.detect());
admin('GET', '/api/admin/vms/:id', async (r) => { const vm = vms.get(r.params.id); await vms.refreshOne(vm); return { vm, stats: await vms.stats(vm.id), logs: await vms.logs(vm.id) }; });
admin('PUT', '/api/admin/vms/:id', async (r) => vms.update(r.params.id, await readJson(r.req)));
admin('DELETE', '/api/admin/vms/:id', async (r) => { const vm = vms.get(r.params.id); await vms.remove(r.params.id); ctx.audit('warn', 'vm', `VM 삭제: ${vm.name}`, r.ip); return { ok: true }; });
admin('POST', '/api/admin/vms/:id/start', async (r) => { const vm = await vms.start(r.params.id); ctx.audit('info', 'vm', `VM 시작: ${vm.name}`, r.ip); notify.fire('▶️ VM 시작', vm.name, 'info'); return vm; });
admin('POST', '/api/admin/vms/:id/stop', async (r) => { const b = await readJson(r.req); const vm = await vms.stop(r.params.id, !!b.force); ctx.audit('info', 'vm', `VM 정지: ${vm.name}`, r.ip); return vm; });
admin('POST', '/api/admin/vms/:id/restart', async (r) => { await vms.stop(r.params.id); const vm = await vms.start(r.params.id); ctx.audit('info', 'vm', `VM 재시작: ${vm.name}`, r.ip); return vm; });
admin('POST', '/api/admin/vms/:id/exec', async (r) => { const b = await readJson(r.req); if (!b.cmd) throw new HttpError(400, '명령을 입력하세요'); return vms.exec(r.params.id, String(b.cmd)); });

// ------------------------------------------------ 관리자: 예약 작업
const taskView = (t) => ({ ...t, scheduleText: scheduler.describe(t), actionLabel: ACTION_LABELS[t.action] });
admin('GET', '/api/admin/tasks', async () => ({ tasks: ctx.db.tasks.map(taskView), actions: ACTIONS.map((a) => ({ id: a, label: ACTION_LABELS[a] })) }));
admin('POST', '/api/admin/tasks', async (r) => { const t = scheduler.add(await readJson(r.req)); ctx.audit('info', 'task', `작업 등록: ${t.name}`, r.ip); return taskView(t); });
admin('PUT', '/api/admin/tasks/:id', async (r) => taskView(scheduler.update(r.params.id, await readJson(r.req))));
admin('DELETE', '/api/admin/tasks/:id', async (r) => { scheduler.remove(r.params.id); return { ok: true }; });
admin('POST', '/api/admin/tasks/:id/run', async (r) => { const t = scheduler.get(r.params.id); const res = await scheduler.runTask(t, true); return { result: res, task: taskView(t) }; });

// ------------------------------------------------ 관리자: 백업
admin('GET', '/api/admin/backups', async () => backup.list());
admin('POST', '/api/admin/backups', async (r) => { const b = await backup.create(); ctx.audit('info', 'backup', `백업 생성: ${b.name}`, r.ip); return b; });
admin('DELETE', '/api/admin/backups/:name', async (r) => { backup.remove(r.params.name); return { ok: true }; });
admin('GET', '/api/admin/backups/:name/download', async (r) => { await sendFile(r.res, backup.filePath(r.params.name), { download: r.params.name }); return null; });
admin('POST', '/api/admin/backups/:name/restore', async (r) => { await backup.restore(r.params.name); ctx.audit('warn', 'backup', `백업 복원: ${r.params.name}`, r.ip); return { ok: true }; });

// ------------------------------------------------ 관리자: 네트워크 도구
admin('POST', '/api/admin/net/ping', async (r) => nettools.ping((await readJson(r.req)).host));
admin('POST', '/api/admin/net/port', async (r) => { const b = await readJson(r.req); return nettools.portCheck(b.host, b.port); });
admin('POST', '/api/admin/net/dns', async (r) => nettools.lookup((await readJson(r.req)).host));
admin('POST', '/api/admin/net/http', async (r) => nettools.httpCheck((await readJson(r.req)).url));
admin('GET', '/api/admin/net/publicip', async () => nettools.publicIp());
admin('GET', '/api/admin/net/listening', async () => nettools.listening());
admin('GET', '/api/admin/net/interfaces', async () => nettools.interfaces());

// ------------------------------------------------ 관리자: 로그
admin('GET', '/api/admin/logs', async (r) => {
  const type = r.query.get('type'), level = r.query.get('level'), q = (r.query.get('q') || '').toLowerCase();
  const limit = clamp(r.query.get('limit'), 1, 1000, 200);
  let logs = ctx.db.logs;
  if (type) logs = logs.filter((l) => l.type === type);
  if (level) logs = logs.filter((l) => l.level === level);
  if (q) logs = logs.filter((l) => l.msg.toLowerCase().includes(q));
  return { logs: logs.slice(-limit).reverse(), total: ctx.db.logs.length, types: [...new Set(ctx.db.logs.map((l) => l.type))].sort() };
});
admin('DELETE', '/api/admin/logs', async (r) => { ctx.db.logs = []; store.save(); ctx.audit('info', 'system', '로그 초기화', r.ip); return { ok: true }; });

// ------------------------------------------------ 페이지
route('GET', '/', async (r) => {
  if (r.query.get('bypass') && r.query.get('bypass') === maint().bypassKey && maint().bypassKey) {
    setCookie(r.res, 'bypass', maint().bypassKey, { maxAge: 86400 });
    r.res.writeHead(302, { Location: '/' }); r.res.end(); return null;
  }
  if (!isBypass(r.req, r.ip)) { await serveMaintenance(r.res); return null; }
  await sendFile(r.res, path.join(PUBLIC_DIR, 'site.html'));
  return null;
});
route('GET', '/maintenance', async (r) => { await serveMaintenance(r.res, r.query.get('preview') ? 200 : (maint().enabled ? 503 : 200)); return null; });
route('GET', '/admin', async (r) => { await sendFile(r.res, path.join(PUBLIC_DIR, 'admin', 'index.html')); return null; });
route('GET', '/login', async (r) => { r.res.writeHead(302, { Location: '/admin#/login' }); r.res.end(); return null; });
route('GET', '/s/:token', async (r) => {
  if (!isBypass(r.req, r.ip)) { await serveMaintenance(r.res); return null; }
  const share = storage.findShare(r.params.token);
  if (!share) throw new HttpError(404, '공유 링크가 만료되었거나 존재하지 않습니다');
  const s = await storage.stat(share.path);
  share.downloads += 1; store.save();
  if (s.isDir) {
    const child = storage.tarStream(s.rel);
    r.res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(s.name + '.tar.gz')}` });
    child.stdout.pipe(r.res);
    return null;
  }
  await sendFile(r.res, s.abs, { download: r.query.get('inline') ? undefined : s.name });
  return null;
});

async function serveMaintenance(res, status = 503) {
  const m = maint();
  const headers = { 'Cache-Control': 'no-store' };
  if (status === 503 && m.until) headers['Retry-After'] = String(Math.max(60, Math.round((m.until - Date.now()) / 1000)));
  else if (status === 503) headers['Retry-After'] = '600';
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'maintenance.html'), 'utf8');
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
  res.end(html);
}

async function serveStatic(req, res, pathname) {
  const rel = path.posix.normalize(pathname);
  if (rel.includes('..')) return false;
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return false;
  let st;
  try { st = fs.statSync(file); } catch { return false; }
  if (!st.isFile()) return false;
  await sendFile(res, file, { cache: 'public, max-age=300' });
  return true;
}

// ---------------------------------------------------------------- 요청 처리
async function handle(req, res) {
  const u = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(u.pathname);
  const ip = clientIp(req, ctx.db.settings.trustProxy);
  const secure = req.headers['x-forwarded-proto'] === 'https' || !!req.socket.encrypted;

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');

  // CSRF 완화: 다른 사이트에서 온 변경 요청 차단
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const sfs = req.headers['sec-fetch-site'];
    if (sfs && sfs !== 'same-origin' && sfs !== 'none' && !req.headers.authorization && !req.headers['x-game-key']) throw new HttpError(403, '교차 사이트 요청은 허용되지 않습니다');
  }

  const method = req.method === 'HEAD' ? 'GET' : req.method;
  for (const rt of routes) {
    if (rt.method !== method) continue;
    const m = rt.re.exec(pathname);
    if (!m) continue;
    const params = {};
    rt.keys.forEach((k, i) => { params[k] = m[i + 1]; });
    const r = { req, res, params, query: u.searchParams, ip, secure };
    if (rt.opts.admin) requireAdmin(req);
    const out = await rt.handler(r);
    if (out !== null && !res.writableEnded) sendJson(res, 200, out === undefined ? { ok: true } : out);
    return;
  }

  if (method === 'GET' && (pathname.startsWith('/admin/') || pathname.startsWith('/assets/'))) {
    if (await serveStatic(req, res, pathname)) return;
    if (pathname.startsWith('/admin/')) { await sendFile(res, path.join(PUBLIC_DIR, 'admin', 'index.html')); return; }
  }
  if (pathname.startsWith('/api/')) throw new HttpError(404, 'API 경로를 찾을 수 없습니다');
  sendText(res, 404, '<!doctype html><meta charset="utf-8"><title>404</title><body style="font-family:sans-serif;background:#0f1320;color:#e6e9f2;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h1 style="font-size:64px;margin:0">404</h1><p>페이지를 찾을 수 없습니다.</p><a href="/" style="color:#7aa2ff">홈으로</a></div></body>', 'text/html; charset=utf-8');
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    if (res.writableEnded) return;
    if (e instanceof HttpError) {
      if (res.headersSent) { res.end(); return; }
      if (e.status === 401 && !req.url.startsWith('/api/')) { res.writeHead(302, { Location: '/admin#/login' }); res.end(); return; }
      sendJson(res, e.status, { error: e.message });
      return;
    }
    console.error(e);
    if (res.headersSent) { res.end(); return; }
    sendJson(res, 500, { error: '서버 내부 오류: ' + e.message });
  });
});
server.requestTimeout = 0;
server.headersTimeout = 60000;

server.listen(PORT, HOST, () => {
  ctx.audit('info', 'system', `Server Hub v${VERSION} 시작 — http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT} (데이터: ${DATA_DIR})`);
  if (!auth.isSetup()) console.log('▶ 초기 설정: 브라우저에서 /admin 으로 접속해 관리자 계정을 만드세요.');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { try { store.saveNow(); } catch { /* ignore */ } process.exit(0); });
}
process.on('uncaughtException', (e) => { console.error('uncaughtException', e); });
process.on('unhandledRejection', (e) => { console.error('unhandledRejection', e); });
