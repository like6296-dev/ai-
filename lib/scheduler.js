'use strict';
const cron = require('./cron');
const { id, HttpError, str, clamp } = require('./util');

const ACTIONS = ['maintenance_on', 'maintenance_off', 'shell', 'webhook', 'backup', 'vm_start', 'vm_stop', 'vpn_apply', 'announcement', 'broadcast'];
const ACTION_LABELS = { maintenance_on: '점검 모드 켜기', maintenance_off: '점검 모드 끄기', shell: '셸 명령 실행', webhook: 'Discord 알림', backup: '백업 생성', vm_start: 'VM 시작', vm_stop: 'VM 정지', vpn_apply: 'VPN 설정 적용', announcement: '공지 등록', broadcast: '게임 브로드캐스트' };

class Scheduler {
  constructor(ctx, actions) {
    this.ctx = ctx;
    this.actions = actions;
    this.running = new Set();
    for (const t of this.tasks) this.rescheduleOnBoot(t);
    this.ctx.store.save();
    this.timer = setInterval(() => this.tick().catch(() => {}), 10000);
    this.timer.unref();
    setTimeout(() => this.tick().catch(() => {}), 2000).unref();
  }
  get tasks() { return this.ctx.db.tasks; }

  normalize(input, existing = {}) {
    const t = { ...existing };
    t.name = str(input.name ?? existing.name, 80).trim();
    if (!t.name) throw new HttpError(400, '작업 이름을 입력하세요');
    const sch = input.schedule || existing.schedule;
    if (!sch || !sch.type) throw new HttpError(400, '스케줄을 지정하세요');
    if (sch.type === 'cron') {
      try { cron.parse(sch.expr); } catch (e) { throw new HttpError(400, e.message); }
      t.schedule = { type: 'cron', expr: String(sch.expr).trim() };
    }
    else if (sch.type === 'once') {
      const at = new Date(sch.at).getTime();
      if (!Number.isFinite(at)) throw new HttpError(400, '실행 시각이 올바르지 않습니다');
      t.schedule = { type: 'once', at };
    } else if (sch.type === 'interval') {
      t.schedule = { type: 'interval', minutes: clamp(sch.minutes, 1, 525600, 60) };
    } else throw new HttpError(400, '알 수 없는 스케줄 유형');
    const action = input.action ?? existing.action;
    if (!ACTIONS.includes(action)) throw new HttpError(400, '알 수 없는 작업 유형');
    t.action = action;
    t.payload = (input.payload && typeof input.payload === 'object') ? input.payload : (existing.payload || {});
    if (input.enabled !== undefined) t.enabled = !!input.enabled;
    else if (t.enabled === undefined) t.enabled = true;
    t.nextRun = this.computeNext(t, Date.now());
    return t;
  }

  computeNext(t, from) {
    const s = t.schedule;
    if (s.type === 'cron') { const n = cron.parse(s.expr).next(new Date(from)); return n ? n.getTime() : null; }
    if (s.type === 'once') return t.lastRun ? null : s.at;
    if (s.type === 'interval') return from + s.minutes * 60000;
    return null;
  }

  rescheduleOnBoot(t) {
    if (!t.enabled) return;
    const now = Date.now();
    if (t.schedule.type === 'once') {
      if (t.lastRun) { t.enabled = false; t.nextRun = null; }
      else if (t.schedule.at < now - 3600000) { t.enabled = false; t.nextRun = null; t.lastResult = { ok: false, at: now, output: '서버 중지 중 실행 시각이 지나 건너뜀' }; }
      return;
    }
    if (!t.nextRun || t.nextRun < now) t.nextRun = this.computeNext(t, now);
  }

  add(input) {
    const t = this.normalize(input);
    t.id = id(8); t.created = Date.now(); t.lastRun = null; t.lastResult = null;
    this.tasks.push(t);
    this.ctx.store.save();
    return t;
  }
  get(tid) {
    const t = this.tasks.find((x) => x.id === tid);
    if (!t) throw new HttpError(404, '작업을 찾을 수 없습니다');
    return t;
  }
  update(tid, input) {
    const t = this.get(tid);
    const n = this.normalize(input, t);
    if (input.enabled === true && t.schedule.type === 'once' && t.lastRun) { n.lastRun = null; n.nextRun = n.schedule.at; }
    Object.assign(t, n);
    this.ctx.store.save();
    return t;
  }
  remove(tid) {
    const t = this.get(tid);
    this.tasks.splice(this.tasks.indexOf(t), 1);
    this.ctx.store.save();
  }

  async runTask(t, manual = false) {
    if (this.running.has(t.id)) throw new HttpError(409, '이미 실행 중인 작업입니다');
    this.running.add(t.id);
    const started = Date.now();
    let result;
    try {
      const fn = this.actions[t.action];
      if (!fn) throw new Error('구현되지 않은 작업');
      const out = await fn(t.payload || {}, t);
      result = { ok: true, at: started, ms: Date.now() - started, output: str(typeof out === 'string' ? out : JSON.stringify(out ?? ''), 4000) };
    } catch (e) {
      result = { ok: false, at: started, ms: Date.now() - started, output: str(e.message, 4000) };
    } finally {
      this.running.delete(t.id);
    }
    t.lastRun = started;
    t.lastResult = result;
    if (!manual || t.schedule.type !== 'once') {
      if (t.schedule.type === 'once') { t.enabled = false; t.nextRun = null; }
      else t.nextRun = this.computeNext(t, Date.now());
    }
    this.ctx.store.save();
    this.ctx.audit(result.ok ? 'info' : 'error', 'task', `${manual ? '[수동] ' : ''}작업 "${t.name}" (${ACTION_LABELS[t.action]}) ${result.ok ? '완료' : '실패'}: ${result.output.slice(0, 200)}`);
    return result;
  }

  async tick() {
    const now = Date.now();
    for (const t of this.tasks) {
      if (!t.enabled || !t.nextRun || t.nextRun > now || this.running.has(t.id)) continue;
      await this.runTask(t, false).catch(() => {});
    }
  }

  describe(t) {
    const s = t.schedule;
    if (s.type === 'cron') return `${cron.describe(s.expr)} (${s.expr})`;
    if (s.type === 'once') return `1회: ${new Date(s.at).toLocaleString('ko-KR')}`;
    if (s.type === 'interval') return `${s.minutes}분마다`;
    return '';
  }
}

module.exports = { Scheduler, ACTIONS, ACTION_LABELS };
