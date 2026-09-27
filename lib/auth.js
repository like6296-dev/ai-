'use strict';
const crypto = require('crypto');
const { id, token, HttpError } = require('./util');

const SESSION_TTL = 7 * 24 * 3600 * 1000;

function hashPassword(pw, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(pw, salt, hash) {
  try {
    const h = crypto.scryptSync(String(pw), salt, 64);
    return crypto.timingSafeEqual(h, Buffer.from(hash, 'hex'));
  } catch { return false; }
}

class Auth {
  constructor(ctx) {
    this.ctx = ctx;
    this.fails = new Map(); // ip -> { count, until }
    setInterval(() => this.pruneSessions(), 60 * 1000).unref();
  }
  get db() { return this.ctx.db; }

  isSetup() { return !!(this.db.admin && this.db.admin.hash); }

  setup(username, password) {
    if (this.isSetup()) throw new HttpError(400, '이미 초기 설정이 완료되었습니다');
    if (!username || username.length < 2) throw new HttpError(400, '아이디는 2자 이상이어야 합니다');
    if (!password || password.length < 6) throw new HttpError(400, '비밀번호는 6자 이상이어야 합니다');
    this.db.admin = { username: String(username).slice(0, 40), ...hashPassword(password), created: Date.now() };
    this.ctx.store.save();
  }

  changePassword(current, next) {
    if (!verifyPassword(current, this.db.admin.salt, this.db.admin.hash)) throw new HttpError(400, '현재 비밀번호가 올바르지 않습니다');
    if (!next || next.length < 6) throw new HttpError(400, '새 비밀번호는 6자 이상이어야 합니다');
    Object.assign(this.db.admin, hashPassword(next));
    this.db.sessions = {};
    this.ctx.store.save();
  }

  isLocked(ip) {
    const f = this.fails.get(ip);
    return !!(f && f.until && f.until > Date.now());
  }
  recordFail(ip) {
    const f = this.fails.get(ip) || { count: 0, until: 0 };
    f.count += 1;
    if (f.count >= 5) { f.until = Date.now() + 5 * 60 * 1000; f.count = 0; }
    this.fails.set(ip, f);
    return f;
  }

  login(username, password, ip) {
    if (!this.isSetup()) throw new HttpError(400, '초기 설정이 필요합니다');
    if (this.isLocked(ip)) throw new HttpError(429, '로그인 시도가 너무 많습니다. 5분 후 다시 시도하세요');
    const a = this.db.admin;
    if (username !== a.username || !verifyPassword(password, a.salt, a.hash)) {
      const f = this.recordFail(ip);
      throw new HttpError(401, f.until > Date.now() ? '5회 실패로 5분간 잠겼습니다' : '아이디 또는 비밀번호가 올바르지 않습니다');
    }
    this.fails.delete(ip);
    return this.createSession(ip);
  }

  createSession(ip) {
    const sid = token(32);
    this.db.sessions[sid] = { created: Date.now(), expires: Date.now() + SESSION_TTL, ip };
    this.ctx.store.save();
    return sid;
  }
  getSession(sid) {
    if (!sid) return null;
    const s = this.db.sessions[sid];
    if (!s) return null;
    if (s.expires < Date.now()) { delete this.db.sessions[sid]; this.ctx.store.save(); return null; }
    return s;
  }
  destroySession(sid) {
    if (sid && this.db.sessions[sid]) { delete this.db.sessions[sid]; this.ctx.store.save(); }
  }
  pruneSessions() {
    let changed = false;
    for (const [k, s] of Object.entries(this.db.sessions)) {
      if (s.expires < Date.now()) { delete this.db.sessions[k]; changed = true; }
    }
    if (changed) this.ctx.store.save();
  }

  // API 토큰 (자동화용)
  createToken(name) {
    const t = { id: id(8), name: String(name || 'token').slice(0, 60), token: 'sh_' + token(24), created: Date.now(), lastUsed: null };
    this.db.tokens.push(t);
    this.ctx.store.save();
    return t;
  }
  listTokens() { return this.db.tokens.map((t) => ({ id: t.id, name: t.name, created: t.created, lastUsed: t.lastUsed, preview: t.token.slice(0, 8) + '…' })); }
  deleteToken(tid) {
    const i = this.db.tokens.findIndex((t) => t.id === tid);
    if (i < 0) throw new HttpError(404, '토큰을 찾을 수 없습니다');
    this.db.tokens.splice(i, 1);
    this.ctx.store.save();
  }
  findToken(value) {
    const t = this.db.tokens.find((x) => x.token === value);
    if (t) { t.lastUsed = Date.now(); this.ctx.store.save(); }
    return t || null;
  }
}

module.exports = { Auth, hashPassword, verifyPassword };
