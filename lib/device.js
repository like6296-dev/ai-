'use strict';
// HALCYON-01 장치 콘솔: 서비스 · 볼륨 · 방화벽 · 전원(BMC) · 알림 · 명령줄
const os = require('os');
const { findBin, run, sh, id, HttpError, str, clamp } = require('./util');

const DEFAULT_SERVICES = [
  { name: 'Caddy', unit: 'caddy', port: 443, desc: '리버스 프록시 / HTTPS', icon: '🌐' },
  { name: 'PostgreSQL', unit: 'postgresql', port: 5432, desc: '데이터베이스', icon: '🐘' },
  { name: 'Redis', unit: 'redis-server', port: 6379, desc: '캐시 / 큐', icon: '⚡' },
  { name: 'Immich', unit: 'immich', port: 2283, desc: '사진 · 영상 백업', icon: '📷' },
  { name: 'Home Assistant', unit: 'home-assistant', port: 8123, desc: '홈 오토메이션', icon: '🏠' },
  { name: 'Samba', unit: 'smbd', port: 445, desc: '파일 공유 (SMB)', icon: '📁' },
  { name: 'Docker', unit: 'docker', port: 0, desc: '컨테이너 런타임', icon: '🐳' },
  { name: 'SSH', unit: 'ssh', port: 22, desc: '원격 접속', icon: '🔐' },
];
const DEFAULT_RULES = [
  { port: 22, proto: 'tcp', from: 'any', note: 'SSH' }, { port: 80, proto: 'tcp', from: 'any', note: 'HTTP' },
  { port: 443, proto: 'tcp', from: 'any', note: 'HTTPS (Caddy)' }, { port: 51820, proto: 'udp', from: 'any', note: 'WireGuard' },
  { port: 445, proto: 'tcp', from: '192.168.0.0/16', note: 'SMB (내부망만)' },
];
const STATES = ['running', 'stopped', 'starting', 'stopping', 'restarting', 'failed'];
const STATE_LABEL = { running: '실행 중', stopped: '정지', starting: '시작 중', stopping: '정지 중', restarting: '재시작 중', failed: '실패' };

// BMC 재부팅 시퀀스 (ms 오프셋, 출처, 메시지)
const REBOOT_SEQ = [
  [0, 'BMC', 'IPMI 재부팅 요청 수신 · 전원 시퀀스 시작'],
  [900, 'OS', '서비스 정지 중 (graceful shutdown)'],
  [2600, 'BMC', '전원 차단 — 팬 정지, 베이 LED 소등'],
  [4200, 'BMC', '전원 인가 · POST 시작'],
  [5600, 'POST', '메모리 검사 OK · NVMe 베이 스캔 · NIC 링크 UP'],
  [7200, 'UEFI', '부트로더 로드 → HALCYON Linux'],
  [8600, 'OS', '커널 초기화 · 파일시스템 마운트'],
  [9800, 'OS', '서비스 시작 중'],
  [12000, 'BMC', '부팅 완료 — 온라인'],
];
const POWEROFF_SEQ = [[0, 'BMC', '전원 차단 요청 수신'], [900, 'OS', '서비스 정지 중'], [2600, 'BMC', '전원 차단 완료 — 대기 전력만 유지']];
const POWERON_SEQ = REBOOT_SEQ.slice(3).map(([t, s, m]) => [t - 4200, s, m]);

class Device {
  constructor(ctx, deps) {
    this.ctx = ctx;
    this.monitor = deps.monitor;
    this.notify = deps.notify;
    this.timers = [];
    this.bins = { systemctl: !!findBin('systemctl'), docker: !!findBin('docker'), ufw: !!findBin('ufw') };
    this.seed();
    const d = this.d;
    if (d.power !== 'on' && d.power !== 'off') this.finishBoot('콘솔 재시작 후 부팅 복구');
    setTimeout(() => this.tick().catch(() => {}), 1500).unref();
    setInterval(() => this.tick().catch(() => {}), 10000).unref();
  }
  get d() { return this.ctx.db.device; }
  save() { this.ctx.store.save(); }

  seed() {
    const d = this.d;
    if (d.seeded) return;
    d.services = DEFAULT_SERVICES.map((s) => ({ id: id(6), ...s, type: 'auto', backend: 'simulated', state: 'running', autostart: true, lastChange: Date.now(), lastError: null }));
    d.services.unshift({ id: 'console', name: 'HALCYON 콘솔', unit: 'halcyon', port: Number(process.env.PORT) || 3000, desc: '이 관리 콘솔 (정지 불가)', icon: '🛰️', type: 'self', backend: 'self', state: 'running', autostart: true, lastChange: Date.now(), lastError: null });
    d.volumes = [{ id: id(6), name: '/data', mount: '/data', backend: 'simulated', total: 8 * 1024 ** 4, used: Math.round(8 * 1024 ** 4 * 0.92), warnAt: 90, note: '데모 볼륨 (가상) — 삭제 가능' }];
    d.firewall.rules = DEFAULT_RULES.map((r) => ({ id: id(6), action: 'allow', ...r }));
    d.alerts = [{ id: id(6), level: 'info', title: 'HALCYON-01 콘솔 준비 완료', text: '장치 콘솔이 초기화되었습니다. 서비스·볼륨·방화벽은 설정에서 실제 환경에 맞게 바꿀 수 있습니다.', ts: Date.now(), acked: false, ackedAt: null, key: 'welcome' }];
    d.seeded = true;
    this.save();
  }

  // ------------------------------------------------------------ 서비스
  getService(ref) {
    const q = String(ref || '').toLowerCase().trim();
    const s = this.d.services.find((x) => x.id === q) || this.d.services.find((x) => x.name.toLowerCase() === q || x.unit.toLowerCase() === q) || this.d.services.find((x) => x.name.toLowerCase().startsWith(q) || x.unit.toLowerCase().startsWith(q));
    if (!s) throw new HttpError(404, `서비스를 찾을 수 없습니다: ${ref}`);
    return s;
  }
  addService(input) {
    const name = str(input.name, 40).trim(), unit = str(input.unit, 80).trim();
    if (!name) throw new HttpError(400, '서비스 이름을 입력하세요');
    if (!/^[a-zA-Z0-9@._:-]+$/.test(unit)) throw new HttpError(400, 'unit/컨테이너 이름 형식이 올바르지 않습니다');
    const s = { id: id(6), name, unit, port: clamp(input.port, 0, 65535, 0), desc: str(input.desc, 80), icon: str(input.icon, 4) || '⚙️', type: ['auto', 'systemd', 'docker', 'simulated'].includes(input.type) ? input.type : 'auto', backend: 'simulated', state: 'stopped', autostart: input.autostart !== false, lastChange: Date.now(), lastError: null };
    this.d.services.push(s);
    this.save();
    return s;
  }
  updateService(sid, patch) {
    const s = this.getService(sid);
    if (s.type === 'self') throw new HttpError(400, '콘솔 서비스는 수정할 수 없습니다');
    if (patch.name !== undefined) s.name = str(patch.name, 40).trim() || s.name;
    if (patch.unit !== undefined && /^[a-zA-Z0-9@._:-]+$/.test(patch.unit)) s.unit = patch.unit;
    if (patch.port !== undefined) s.port = clamp(patch.port, 0, 65535, s.port);
    if (patch.desc !== undefined) s.desc = str(patch.desc, 80);
    if (patch.icon !== undefined) s.icon = str(patch.icon, 4) || s.icon;
    if (patch.type !== undefined && ['auto', 'systemd', 'docker', 'simulated'].includes(patch.type)) s.type = patch.type;
    if (patch.autostart !== undefined) s.autostart = !!patch.autostart;
    this.save();
    return s;
  }
  removeService(sid) {
    const s = this.getService(sid);
    if (s.type === 'self') throw new HttpError(400, '콘솔 서비스는 삭제할 수 없습니다');
    this.d.services.splice(this.d.services.indexOf(s), 1);
    this.save();
  }

  async refreshServices() {
    const d = this.d;
    const now = Date.now();
    let changed = false;
    // 시뮬레이션 전이 완료
    for (const s of d.services) {
      if (s.transitionUntil && now >= s.transitionUntil) { s.state = s.transitionTo; s.transitionUntil = null; s.transitionTo = null; s.lastChange = now; changed = true; }
    }
    if (d.power !== 'on') { if (changed) this.save(); return; }
    const candidates = d.services.filter((s) => s.type === 'auto' || s.type === 'systemd');
    const found = new Set();
    if (this.bins.systemctl && candidates.length) {
      const r = await run('systemctl', ['show', ...candidates.map((s) => s.unit), '--property=Id,LoadState,ActiveState,SubState'], { timeout: 8000 });
      if (r.ok) {
        for (const block of r.stdout.split(/\n\s*\n/)) {
          const kv = Object.fromEntries(block.trim().split('\n').map((l) => l.split('=')));
          if (!kv.Id || kv.LoadState !== 'loaded') continue;
          const unit = kv.Id.replace(/\.service$/, '');
          const s = candidates.find((x) => x.unit === unit || x.unit === kv.Id);
          if (!s) continue;
          found.add(s.id);
          const st = kv.ActiveState === 'active' ? 'running' : kv.ActiveState === 'failed' ? 'failed' : kv.ActiveState === 'activating' ? 'starting' : kv.ActiveState === 'deactivating' ? 'stopping' : 'stopped';
          if (s.backend !== 'systemd' || s.state !== st) { s.backend = 'systemd'; s.state = st; s.lastChange = now; changed = true; }
        }
      }
    }
    const dockerCands = d.services.filter((s) => !found.has(s.id) && (s.type === 'auto' || s.type === 'docker') && s.type !== 'systemd');
    if (this.bins.docker && dockerCands.length) {
      const r = await run('docker', ['inspect', '-f', '{{.Name}} {{.State.Running}}', ...dockerCands.map((s) => s.unit)], { timeout: 8000 });
      if (r.ok || r.stdout) {
        for (const line of r.stdout.split('\n')) {
          const [name, running] = line.trim().split(' ');
          if (!name) continue;
          const s = dockerCands.find((x) => '/' + x.unit === name || x.unit === name);
          if (!s) continue;
          found.add(s.id);
          const st = running === 'true' ? 'running' : 'stopped';
          if (s.backend !== 'docker' || s.state !== st) { s.backend = 'docker'; s.state = st; s.lastChange = now; changed = true; }
        }
      }
    }
    for (const s of d.services) {
      if (found.has(s.id) || s.type === 'self') continue;
      if (s.type === 'simulated' || s.type === 'auto') { if (s.backend !== 'simulated') { s.backend = 'simulated'; changed = true; } }
      else if (s.backend !== 'simulated') { s.backend = 'simulated'; s.lastError = `${s.type} 백엔드에서 ${s.unit} 을 찾지 못해 시뮬레이션으로 동작`; changed = true; }
    }
    if (changed) this.save();
  }

  async serviceAction(sid, action) {
    const s = this.getService(sid);
    if (!['start', 'stop', 'restart'].includes(action)) throw new HttpError(400, '알 수 없는 동작');
    if (s.type === 'self') throw new HttpError(400, 'HALCYON 콘솔은 여기서 정지할 수 없습니다 (설정 → 서버 재시작)');
    if (this.d.power !== 'on') throw new HttpError(400, '장치가 켜져 있지 않습니다');
    const now = Date.now();
    s.lastError = null;
    if (s.backend === 'systemd' || s.backend === 'docker') {
      const r = s.backend === 'systemd' ? await run('systemctl', [action, s.unit], { timeout: 90000 }) : await run('docker', [action, s.unit], { timeout: 90000 });
      if (!r.ok) {
        s.state = 'failed'; s.lastError = (r.stderr || r.error || '').trim().slice(0, 300); s.lastChange = now; this.save();
        this.addAlert('error', `${s.name} ${action} 실패`, s.lastError, 'svc:' + s.id);
        throw new HttpError(500, `${s.name} ${action} 실패: ${s.lastError}`);
      }
      await this.refreshServices();
    } else {
      const plan = { start: ['starting', 'running', 1400], stop: ['stopping', 'stopped', 900], restart: ['restarting', 'running', 2300] }[action];
      s.state = plan[0]; s.transitionTo = plan[1]; s.transitionUntil = now + plan[2]; s.lastChange = now;
      const t = setTimeout(() => { if (s.transitionUntil && Date.now() >= s.transitionUntil) { s.state = s.transitionTo; s.transitionUntil = null; s.transitionTo = null; s.lastChange = Date.now(); this.save(); } }, plan[2] + 50);
      t.unref();
    }
    this.save();
    this.ctx.audit('info', 'device', `서비스 ${s.name} ${action} (${s.backend})`);
    return s;
  }

  // ------------------------------------------------------------ 볼륨
  async volumes() {
    const real = await this.monitor.disks();
    const out = real.map((x) => ({ id: 'real:' + x.mount, name: x.mount, mount: x.mount, fs: x.fs, backend: 'real', total: x.total, used: x.used, percent: x.percent, warnAt: this.d.volumeWarnAt || 90 }));
    for (const v of this.d.volumes) out.push({ ...v, percent: v.total ? Math.round(v.used / v.total * 100) : 0 });
    return out;
  }
  addVolume(input) {
    const total = Number(input.totalGB) * 1024 ** 3;
    if (!(total > 0)) throw new HttpError(400, '용량(GB)을 입력하세요');
    const v = { id: id(6), name: str(input.name, 40).trim() || '/volume', mount: str(input.mount, 80).trim() || str(input.name, 40), backend: 'simulated', total, used: Math.min(total, Math.max(0, Number(input.usedGB || 0) * 1024 ** 3)), warnAt: clamp(input.warnAt, 50, 99, 90), note: str(input.note, 80) };
    this.d.volumes.push(v); this.save(); return v;
  }
  updateVolume(vid, patch) {
    const v = this.d.volumes.find((x) => x.id === vid);
    if (!v) throw new HttpError(404, '볼륨을 찾을 수 없습니다');
    if (patch.name !== undefined) v.name = str(patch.name, 40).trim() || v.name;
    if (patch.totalGB !== undefined) v.total = Math.max(1, Number(patch.totalGB)) * 1024 ** 3;
    if (patch.usedGB !== undefined) v.used = Math.min(v.total, Math.max(0, Number(patch.usedGB)) * 1024 ** 3);
    if (patch.warnAt !== undefined) v.warnAt = clamp(patch.warnAt, 50, 99, v.warnAt);
    if (patch.note !== undefined) v.note = str(patch.note, 80);
    this.save(); return v;
  }
  removeVolume(vid) {
    const i = this.d.volumes.findIndex((x) => x.id === vid);
    if (i < 0) throw new HttpError(404, '볼륨을 찾을 수 없습니다');
    this.d.volumes.splice(i, 1); delete this.d.raised['vol:' + vid]; this.save();
  }

  // ------------------------------------------------------------ 방화벽
  async firewall() {
    const fw = this.d.firewall;
    let backend = 'simulated', enabled = fw.enabled, note = '';
    if (this.bins.ufw) {
      const r = await run('ufw', ['status'], { timeout: 8000 });
      if (r.ok) { backend = 'ufw'; enabled = /Status:\s*active/i.test(r.stdout); if (fw.enabled !== enabled) { fw.enabled = enabled; this.save(); } }
      else note = 'ufw 상태를 읽을 수 없습니다 (root 권한 필요) — 시뮬레이션으로 표시';
    }
    return { enabled, backend, note, rules: fw.rules, policy: fw.policy || 'deny' };
  }
  async setFirewall(enabled) {
    const fw = this.d.firewall;
    if (this.bins.ufw) {
      const r = await run('ufw', enabled ? ['--force', 'enable'] : ['disable'], { timeout: 20000 });
      if (!r.ok) throw new HttpError(500, 'ufw 변경 실패: ' + (r.stderr || r.error || '').trim().slice(0, 200));
    }
    fw.enabled = !!enabled; this.save();
    this.ctx.audit('warn', 'device', `방화벽 ${enabled ? '활성화' : '비활성화'}`);
    this.addAlert(enabled ? 'info' : 'warn', `방화벽 ${enabled ? '켜짐' : '꺼짐'}`, enabled ? '인바운드 기본 정책: 차단' : '모든 포트가 외부에 노출될 수 있습니다', 'fw');
    return fw.enabled;
  }
  async addRule(input) {
    const port = clamp(input.port, 1, 65535, 0);
    if (!port) throw new HttpError(400, '포트를 입력하세요');
    const proto = input.proto === 'udp' ? 'udp' : 'tcp';
    const from = str(input.from, 60).trim() || 'any';
    if (from !== 'any' && !/^[0-9a-fA-F:.\/]+$/.test(from)) throw new HttpError(400, '출발지 형식이 올바르지 않습니다');
    const rule = { id: id(6), action: input.action === 'deny' ? 'deny' : 'allow', port, proto, from, note: str(input.note, 60) };
    if (this.bins.ufw) {
      const args = from === 'any' ? [rule.action, `${port}/${proto}`] : [rule.action, 'from', from, 'to', 'any', 'port', String(port), 'proto', proto];
      const r = await run('ufw', args, { timeout: 20000 });
      if (!r.ok) throw new HttpError(500, 'ufw 규칙 추가 실패: ' + (r.stderr || r.error || '').trim().slice(0, 200));
    }
    this.d.firewall.rules.push(rule); this.save();
    this.ctx.audit('info', 'device', `방화벽 규칙 추가: ${rule.action} ${port}/${proto} from ${from}`);
    return rule;
  }
  async removeRule(rid) {
    const rules = this.d.firewall.rules;
    const i = rules.findIndex((r) => r.id === rid);
    if (i < 0) throw new HttpError(404, '규칙을 찾을 수 없습니다');
    const rule = rules[i];
    if (this.bins.ufw) {
      const args = rule.from === 'any' ? ['delete', rule.action, `${rule.port}/${rule.proto}`] : ['delete', rule.action, 'from', rule.from, 'to', 'any', 'port', String(rule.port), 'proto', rule.proto];
      await run('ufw', args, { timeout: 20000 });
    }
    rules.splice(i, 1); this.save();
  }

  // ------------------------------------------------------------ 알림
  addAlert(level, title, text, key) {
    const d = this.d;
    if (key && d.alerts.some((a) => a.key === key && !a.acked)) return null;
    const a = { id: id(6), level: ['info', 'warn', 'error', 'ok'].includes(level) ? level : 'info', title: str(title, 120), text: str(text, 500), ts: Date.now(), acked: false, ackedAt: null, key: key || null };
    d.alerts.unshift(a);
    if (d.alerts.length > 100) d.alerts.length = 100;
    this.save();
    if (a.level === 'warn' || a.level === 'error') this.notify.fire(`${a.level === 'error' ? '🚨' : '⚠️'} ${a.title}`, a.text, a.level === 'error' ? 'error' : 'warn');
    return a;
  }
  ack(aid) {
    const a = this.d.alerts.find((x) => x.id === aid);
    if (!a) throw new HttpError(404, '알림을 찾을 수 없습니다');
    a.acked = true; a.ackedAt = Date.now(); this.save(); return a;
  }
  ackAll() { const n = Date.now(); let c = 0; for (const a of this.d.alerts) if (!a.acked) { a.acked = true; a.ackedAt = n; c++; } this.save(); return c; }
  removeAlert(aid) { const i = this.d.alerts.findIndex((x) => x.id === aid); if (i < 0) throw new HttpError(404, '알림을 찾을 수 없습니다'); this.d.alerts.splice(i, 1); this.save(); }
  clearAcked() { const before = this.d.alerts.length; this.d.alerts = this.d.alerts.filter((a) => !a.acked); this.save(); return before - this.d.alerts.length; }

  async evaluate() {
    const vols = await this.volumes();
    const raised = this.d.raised;
    for (const v of vols) {
      const key = 'vol:' + v.id;
      if (v.percent >= v.warnAt) {
        if (!raised[key]) { raised[key] = Date.now(); this.addAlert(v.percent >= 97 ? 'error' : 'warn', `${v.name} 저장 공간 ${v.percent}% 사용`, `${v.mount} 볼륨이 경고 임계값(${v.warnAt}%)을 넘었습니다. 남은 공간 ${Math.round((v.total - v.used) / 1024 ** 3)} GB.`, key); this.save(); }
      } else if (raised[key] && v.percent < v.warnAt - 3) { delete raised[key]; this.save(); }
    }
    for (const s of this.d.services) {
      const key = 'svcdown:' + s.id;
      if (s.state === 'failed') { if (!raised[key]) { raised[key] = Date.now(); this.addAlert('error', `${s.name} 실패 상태`, s.lastError || '서비스가 실패 상태입니다', key); this.save(); } }
      else if (raised[key] && s.state === 'running') { delete raised[key]; this.save(); }
    }
    const m = this.monitor.snapshot();
    const memP = m.mem.used / m.mem.total * 100;
    if (memP >= 92) { if (!raised.mem) { raised.mem = Date.now(); this.addAlert('warn', `메모리 사용률 ${memP.toFixed(0)}%`, '메모리가 거의 가득 찼습니다. 프로세스 페이지에서 사용량이 큰 프로세스를 확인하세요.', 'mem'); this.save(); } }
    else if (raised.mem && memP < 85) { delete raised.mem; this.save(); }
  }

  async tick() { await this.refreshServices(); await this.evaluate(); }

  // ------------------------------------------------------------ 전원 / BMC
  clearTimers() { for (const t of this.timers) clearTimeout(t); this.timers = []; }
  log(src, msg) { const d = this.d; d.bootLog.push({ ts: Date.now(), src, msg }); if (d.bootLog.length > 40) d.bootLog.splice(0, d.bootLog.length - 40); }

  runSequence(seq, onStep, onDone) {
    this.clearTimers();
    const d = this.d;
    d.bootLog = [];
    d.bootStep = 0; d.bootTotal = seq.length; d.bootStartedAt = Date.now();
    seq.forEach(([t, src, msg], i) => {
      const timer = setTimeout(() => {
        this.log(src, msg); d.bootStep = i + 1; d.bootPhase = msg;
        try { onStep && onStep(i, src, msg); } catch { /* ignore */ }
        if (i === seq.length - 1) { onDone && onDone(); }
        this.save();
      }, t);
      timer.unref();
      this.timers.push(timer);
    });
  }
  stopSimulatedServices() { for (const s of this.d.services) if (s.backend === 'simulated' && s.type !== 'self') { s.state = 'stopped'; s.transitionUntil = null; s.lastChange = Date.now(); } }
  startSimulatedServices() {
    const list = this.d.services.filter((s) => s.backend === 'simulated' && s.type !== 'self' && s.autostart);
    list.forEach((s, i) => { s.state = 'starting'; s.transitionTo = 'running'; s.transitionUntil = Date.now() + 700 + i * 350; const t = setTimeout(() => { if (s.transitionUntil && Date.now() >= s.transitionUntil) { s.state = 'running'; s.transitionUntil = null; s.lastChange = Date.now(); this.save(); } }, 750 + i * 350); t.unref(); this.timers.push(t); });
  }
  finishBoot(reason) {
    const d = this.d;
    d.power = 'on'; d.bootedAt = Date.now(); d.bootPhase = null; d.bootStep = d.bootTotal || 0;
    for (const s of d.services) if (s.backend === 'simulated' && s.type !== 'self' && s.autostart) { s.state = 'running'; s.transitionUntil = null; }
    this.addAlert('ok', '부팅 완료 — HALCYON-01 온라인', reason || '재부팅이 완료되어 모든 서비스가 올라왔습니다.', null);
    this.save();
  }

  async power(action, opts = {}) {
    const d = this.d;
    if (action === 'reboot') {
      if (d.power !== 'on') throw new HttpError(400, '켜져 있는 상태에서만 재부팅할 수 있습니다');
      d.power = 'rebooting'; d.realReboot = !!opts.real; this.save();
      this.ctx.audit('warn', 'device', `재부팅 요청 (${opts.real ? '실제 systemctl reboot' : 'BMC 시뮬레이션'})`);
      this.runSequence(REBOOT_SEQ, (i) => {
        if (i === 1) this.stopSimulatedServices();
        if (i === 2 && opts.real) { d.bootedAt = null; this.save(); this.realReboot(); }
        if (i === 7) this.startSimulatedServices();
      }, () => this.finishBoot());
      return d;
    }
    if (action === 'off') {
      if (d.power !== 'on') throw new HttpError(400, '이미 꺼져 있습니다');
      d.power = 'shutting_down'; this.save();
      this.ctx.audit('warn', 'device', '전원 끄기 (시뮬레이션)');
      this.runSequence(POWEROFF_SEQ, (i) => { if (i === 1) this.stopSimulatedServices(); }, () => { d.power = 'off'; d.bootedAt = null; d.bootPhase = null; this.addAlert('warn', 'HALCYON-01 전원 꺼짐', '전원 버튼으로 다시 켤 수 있습니다.', null); this.save(); });
      return d;
    }
    if (action === 'on') {
      if (d.power !== 'off') throw new HttpError(400, '꺼져 있는 상태에서만 켤 수 있습니다');
      d.power = 'booting'; this.save();
      this.ctx.audit('info', 'device', '전원 켜기');
      this.runSequence(POWERON_SEQ, (i) => { if (i === 4) this.startSimulatedServices(); }, () => this.finishBoot('전원이 켜져 모든 서비스가 올라왔습니다.'));
      return d;
    }
    throw new HttpError(400, '알 수 없는 전원 동작');
  }
  async realReboot() {
    const r = findBin('systemctl') ? await run('systemctl', ['reboot'], { timeout: 15000 }) : await run('shutdown', ['-r', 'now'], { timeout: 15000 });
    if (!r.ok) { this.addAlert('error', '실제 재부팅 실패', (r.stderr || r.error || '권한 없음').trim().slice(0, 300), 'realreboot'); this.ctx.audit('error', 'device', '실제 재부팅 실패: ' + (r.stderr || r.error)); }
  }

  // ------------------------------------------------------------ 상태
  async status() {
    const d = this.d;
    const m = this.monitor.snapshot();
    const ips = [];
    for (const [name, addrs] of Object.entries(os.networkInterfaces())) for (const a of addrs || []) if (!a.internal && a.family === 'IPv4') ips.push({ name, address: a.address });
    const uptime = d.power === 'on' ? (d.bootedAt ? (Date.now() - d.bootedAt) / 1000 : m.uptime) : 0;
    return {
      device: { name: d.name, location: d.location, model: d.model, bays: d.bays, power: d.power, bootedAt: d.bootedAt, bootPhase: d.bootPhase, bootStep: d.bootStep || 0, bootTotal: d.bootTotal || 0, bootLog: d.bootLog.slice(-12), uptime, hostname: m.hostname, ips, kernel: `${m.platform} ${m.release}`, arch: m.arch, node: m.node },
      monitor: { cpu: m.cpu, mem: m.mem, net: m.net, loadavg: m.loadavg, history: { cpu: m.history.cpu.slice(-40), mem: m.history.mem.slice(-40), rx: m.history.rx.slice(-40), tx: m.history.tx.slice(-40) } },
      services: d.services.map((s) => ({ ...s, stateLabel: STATE_LABEL[s.state] || s.state })),
      volumes: await this.volumes(),
      firewall: await this.firewall(),
      alerts: d.alerts.slice(0, 50),
      unacked: d.alerts.filter((a) => !a.acked).length,
      maintenance: this.ctx.db.settings.maintenance.enabled,
      backends: this.bins,
    };
  }
  updateInfo(patch) {
    const d = this.d;
    if (patch.name !== undefined) d.name = str(patch.name, 30).trim() || d.name;
    if (patch.location !== undefined) d.location = str(patch.location, 60);
    if (patch.model !== undefined) d.model = str(patch.model, 60);
    if (patch.bays !== undefined) d.bays = clamp(patch.bays, 1, 12, d.bays);
    if (patch.volumeWarnAt !== undefined) d.volumeWarnAt = clamp(patch.volumeWarnAt, 50, 99, 90);
    this.save(); return d;
  }

  // ------------------------------------------------------------ 명령줄
  async cli(line, ext) {
    const raw = String(line || '').trim();
    if (!raw) return { output: '' };
    const [cmd, ...args] = raw.split(/\s+/);
    const c = cmd.toLowerCase();
    const st = () => this.status();
    const fmtB = (n) => { const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; n = Number(n) || 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return n.toFixed(i ? 1 : 0) + u[i]; };
    const dur = (s) => { s = Math.floor(s); const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${m}m` : `${m}m ${s % 60}s`; };
    const pad = (s, n) => String(s).padEnd(n);
    switch (c) {
      case 'help': case '?': return { output: [
        '사용 가능한 명령:',
        '  status                       장치 요약 (CPU·메모리·네트워크·서비스·알림)',
        '  services | svc               서비스 목록',
        '  start|stop|restart <서비스>   서비스 제어 (예: restart redis)',
        '  df | storage                 볼륨 사용량',
        '  top                          CPU 상위 프로세스',
        '  net | ip                     인터페이스 · 트래픽',
        '  fw [on|off|status]           방화벽',
        '  alerts | ack <id|all>        알림 보기 / 확인',
        '  reboot [--real] | poweroff | poweron   전원 (기본: BMC 시뮬레이션)',
        '  maint [on|off] [분]          점검 모드',
        '  vm [list|start|stop <이름>]  가상 머신',
        '  ping <host> | port <host> <port>',
        '  sh <명령>                    서버 셸에서 실행 (60초 제한)',
        '  uptime | date | hostname | whoami | logs [n] | clear',
      ].join('\n') };
      case 'status': {
        const s = await st(); const m = s.monitor; const run = s.services.filter((x) => x.state === 'running').length;
        return { output: [
          `${s.device.name}  ${s.device.location}  [${s.device.power === 'on' ? 'ONLINE' : s.device.power.toUpperCase()}]`,
          `uptime ${dur(s.device.uptime)} · load ${m.loadavg.map((x) => x.toFixed(2)).join(' ')} · ${s.device.kernel}`,
          `cpu ${m.cpu.usage.toFixed(0)}% (${m.cpu.cores} cores) · mem ${fmtB(m.mem.used)}/${fmtB(m.mem.total)} (${(m.mem.used / m.mem.total * 100).toFixed(0)}%)`,
          `net ↓${fmtB(m.net.rxRate)}/s ↑${fmtB(m.net.txRate)}/s · ip ${s.device.ips.map((i) => i.address).join(', ') || '-'}`,
          `services ${run}/${s.services.length} running · firewall ${s.firewall.enabled ? 'on' : 'OFF'} (${s.firewall.backend}) · alerts ${s.unacked} unacked · maintenance ${s.maintenance ? 'ON' : 'off'}`,
          ...s.volumes.filter((v) => v.percent >= v.warnAt).map((v) => `⚠ ${v.name} ${v.percent}% used`),
        ].join('\n') };
      }
      case 'services': case 'svc': case 'ls': {
        const s = await st();
        return { output: s.services.map((x) => `${pad(x.state === 'running' ? '●' : x.state === 'failed' ? '✖' : '○', 2)} ${pad(x.name, 16)} ${pad(x.state, 11)} ${pad(x.backend, 10)} ${x.port ? ':' + x.port : ''}  ${x.desc || ''}`).join('\n') };
      }
      case 'start': case 'stop': case 'restart': {
        if (!args[0]) return { output: `사용법: ${c} <서비스>` };
        const s = await this.serviceAction(args.join(' '), c);
        return { output: `${s.name}: ${c} → ${STATE_LABEL[s.state]} (${s.backend})`, refresh: true };
      }
      case 'df': case 'storage': {
        const s = await st();
        return { output: s.volumes.map((v) => `${pad(v.name, 22)} ${pad(fmtB(v.used), 8)} / ${pad(fmtB(v.total), 8)} ${pad(v.percent + '%', 5)} ${'█'.repeat(Math.round(v.percent / 5)).padEnd(20, '░')} ${v.percent >= v.warnAt ? '⚠ 경고' : ''} ${v.backend === 'simulated' ? '(가상)' : ''}`).join('\n') };
      }
      case 'top': {
        const ps = await this.monitor.processes(12);
        return { output: [`${pad('PID', 7)} ${pad('CPU%', 6)} ${pad('MEM%', 6)} ${pad('RSS', 9)} COMMAND`, ...ps.map((p) => `${pad(p.pid, 7)} ${pad(p.cpu.toFixed(1), 6)} ${pad(p.mem.toFixed(1), 6)} ${pad(fmtB(p.rss), 9)} ${p.comm}`)].join('\n') };
      }
      case 'net': case 'ip': {
        const s = await st();
        return { output: [`rx ${fmtB(s.monitor.net.rxRate)}/s  tx ${fmtB(s.monitor.net.txRate)}/s`, ...Object.entries(os.networkInterfaces()).flatMap(([n, as]) => (as || []).filter((a) => !a.internal).map((a) => `${pad(n, 10)} ${pad(a.family, 5)} ${a.address}${a.mac && a.mac !== '00:00:00:00:00:00' ? '  ' + a.mac : ''}`))].join('\n') };
      }
      case 'fw': case 'firewall': {
        if (args[0] === 'on' || args[0] === 'off') { await this.setFirewall(args[0] === 'on'); return { output: `방화벽 ${args[0] === 'on' ? '활성화' : '비활성화'}`, refresh: true }; }
        const f = await this.firewall();
        return { output: [`firewall: ${f.enabled ? 'ACTIVE' : 'inactive'} (${f.backend}) · default deny incoming`, ...f.rules.map((r) => `  ${pad(r.action.toUpperCase(), 6)} ${pad(r.port + '/' + r.proto, 11)} from ${pad(r.from, 18)} ${r.note || ''}`)].join('\n') };
      }
      case 'alerts': {
        const a = this.d.alerts.slice(0, 15);
        return { output: a.length ? a.map((x) => `${x.acked ? '  ' : '! '}${x.id} ${pad(x.level, 5)} ${new Date(x.ts).toLocaleTimeString('ko-KR', { hour12: false })} ${x.title}`).join('\n') : '알림 없음' };
      }
      case 'ack': {
        if (!args[0]) return { output: '사용법: ack <id|all>' };
        if (args[0] === 'all') return { output: `${this.ackAll()}개 알림 확인`, refresh: true };
        const a = this.ack(args[0]); return { output: `확인: ${a.title}`, refresh: true };
      }
      case 'reboot': { await this.power('reboot', { real: args.includes('--real') }); return { output: args.includes('--real') ? '실제 재부팅을 시작합니다 — 서버가 곧 내려갑니다' : 'BMC 재부팅 시퀀스 시작', refresh: true }; }
      case 'poweroff': case 'shutdown': { await this.power('off'); return { output: '전원 끄기 시퀀스 시작', refresh: true }; }
      case 'poweron': { await this.power('on'); return { output: '전원 켜기', refresh: true }; }
      case 'maint': case 'maintenance': {
        if (!ext.setMaintenance) return { output: '지원되지 않음' };
        if (args[0] === 'on') { const min = Number(args[1]); const m = ext.setMaintenance({ enabled: true, until: min ? Date.now() + min * 60000 : null }, '명령줄'); return { output: `점검 모드 ON${m.until ? ` (${min}분 후 자동 종료)` : ''}`, refresh: true }; }
        if (args[0] === 'off') { ext.setMaintenance({ enabled: false }, '명령줄'); return { output: '점검 모드 OFF', refresh: true }; }
        const m = this.ctx.db.settings.maintenance; return { output: `maintenance: ${m.enabled ? 'ON' : 'off'}${m.until ? ' · until ' + new Date(m.until).toLocaleString('ko-KR') : ''}` };
      }
      case 'vm': {
        const vms = ext.vms; if (!vms) return { output: '지원되지 않음' };
        if (!args[0] || args[0] === 'list') return { output: vms.list().map((v) => `${v.state === 'running' ? '●' : '○'} ${pad(v.name, 18)} ${pad(v.backend, 10)} ${v.cpus}vCPU ${v.memMB}MB`).join('\n') || 'VM 없음' };
        const vm = vms.list().find((v) => v.name.toLowerCase() === (args[1] || '').toLowerCase()); if (!vm) return { output: 'VM 을 찾을 수 없습니다: ' + (args[1] || '') };
        if (args[0] === 'start') { await vms.start(vm.id); return { output: `${vm.name} 시작` }; }
        if (args[0] === 'stop') { await vms.stop(vm.id); return { output: `${vm.name} 정지` }; }
        return { output: '사용법: vm [list|start|stop <이름>]' };
      }
      case 'ping': { if (!args[0]) return { output: '사용법: ping <host>' }; const r = await ext.nettools.ping(args[0]); return { output: r.output }; }
      case 'port': { if (!args[1]) return { output: '사용법: port <host> <port>' }; const r = await ext.nettools.portCheck(args[0], args[1]); return { output: `${r.host}:${r.port} ${r.open ? 'open' : 'closed'} (${r.ms}ms${r.error ? ', ' + r.error : ''})` }; }
      case 'sh': case '!': { const command = raw.slice(cmd.length).trim(); if (!command) return { output: '사용법: sh <명령>' }; const r = await sh(command, { timeout: 60000, cwd: this.ctx.dataDir }); this.ctx.audit('warn', 'device', `명령줄 셸 실행: ${command.slice(0, 120)}`); return { output: ((r.stdout + (r.stderr ? '\n' + r.stderr : '')).trim() || '(출력 없음)') + (r.ok ? '' : `\n[exit ${r.code}]`) }; }
      case 'uptime': { const s = await st(); return { output: `up ${dur(s.device.uptime)} · load ${s.monitor.loadavg.map((x) => x.toFixed(2)).join(' ')}` }; }
      case 'date': return { output: new Date().toString() };
      case 'hostname': return { output: `${this.d.name} (${os.hostname()})` };
      case 'whoami': return { output: `${this.ctx.db.admin ? this.ctx.db.admin.username : 'admin'}@${this.d.name.toLowerCase()}` };
      case 'logs': { const n = clamp(args[0], 1, 100, 15); return { output: this.ctx.db.logs.slice(-n).map((l) => `${new Date(l.ts).toLocaleTimeString('ko-KR', { hour12: false })} ${pad(l.level, 5)} ${pad(l.type, 11)} ${l.msg}`).join('\n') || '로그 없음' }; }
      default: return { output: `알 수 없는 명령: ${cmd}  (help 를 입력하세요)`, error: true };
    }
  }
}

module.exports = { Device, STATES, STATE_LABEL };
