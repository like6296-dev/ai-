'use strict';
const crypto = require('crypto');
const { id, token, HttpError, str, clamp } = require('./util');

const PRESENCE_TTL = 90 * 1000;
const KEY_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function seg(n = 4) {
  const bytes = crypto.randomBytes(n);
  let out = '';
  for (let i = 0; i < n; i++) out += KEY_CHARS[bytes[i] % KEY_CHARS.length];
  return out;
}

class Games {
  constructor(ctx) {
    this.ctx = ctx;
    this.presence = new Map(); // gameId -> Map(serverId -> info)
    setInterval(() => this.prune(), 30000).unref();
  }
  get db() { return this.ctx.db; }

  prune() {
    const now = Date.now();
    for (const [, servers] of this.presence) {
      for (const [sid, info] of servers) if (now - info.lastSeen > PRESENCE_TTL) servers.delete(sid);
    }
  }

  servers(gameId) {
    this.prune();
    const m = this.presence.get(gameId);
    return m ? [...m.values()].sort((a, b) => b.players - a.players) : [];
  }
  online(gameId) { return this.servers(gameId).reduce((n, s) => n + (s.players || 0), 0); }
  totalOnline() { return this.db.games.reduce((n, g) => n + this.online(g.id), 0); }

  publicView(g) {
    return { id: g.id, name: g.name, version: g.version, online: this.online(g.id), servers: this.servers(g.id).length, message: g.message, scriptUrl: g.scriptUrl, keyRequired: g.keyRequired, hwidBind: g.hwidBind, created: g.created, apiKey: g.apiKey, broadcasts: g.broadcasts.slice(-10), keyCount: this.db.keys.filter((k) => k.gameId === g.id).length, logCount: g.logs.length, placeId: g.placeId };
  }
  list() { return this.db.games.map((g) => this.publicView(g)); }
  get(gid) {
    const g = this.db.games.find((x) => x.id === gid);
    if (!g) throw new HttpError(404, '게임을 찾을 수 없습니다');
    return g;
  }
  byApiKey(key) { return key ? this.db.games.find((g) => g.apiKey === key) || null : null; }

  create(input) {
    const name = str(input.name, 60).trim();
    if (!name) throw new HttpError(400, '게임 이름을 입력하세요');
    const g = { id: id(8), name, apiKey: 'gk_' + token(18), created: Date.now(), version: str(input.version, 30) || '1.0.0', scriptUrl: str(input.scriptUrl, 500), message: str(input.message, 500), placeId: str(input.placeId, 40), keyRequired: input.keyRequired !== false, hwidBind: input.hwidBind !== false, broadcasts: [], logs: [] };
    this.db.games.push(g);
    this.ctx.store.save();
    return g;
  }
  update(gid, patch) {
    const g = this.get(gid);
    if (patch.name !== undefined) g.name = str(patch.name, 60).trim() || g.name;
    if (patch.version !== undefined) g.version = str(patch.version, 30);
    if (patch.scriptUrl !== undefined) g.scriptUrl = str(patch.scriptUrl, 500);
    if (patch.message !== undefined) g.message = str(patch.message, 500);
    if (patch.placeId !== undefined) g.placeId = str(patch.placeId, 40);
    if (patch.keyRequired !== undefined) g.keyRequired = !!patch.keyRequired;
    if (patch.hwidBind !== undefined) g.hwidBind = !!patch.hwidBind;
    this.ctx.store.save();
    return g;
  }
  remove(gid) {
    const g = this.get(gid);
    this.db.games.splice(this.db.games.indexOf(g), 1);
    this.db.keys = this.db.keys.filter((k) => k.gameId !== gid);
    this.presence.delete(gid);
    this.ctx.store.save();
  }
  rotateKey(gid) {
    const g = this.get(gid);
    g.apiKey = 'gk_' + token(18);
    this.ctx.store.save();
    return g.apiKey;
  }

  heartbeat(g, body) {
    const serverId = str(body.serverId || body.jobId, 80).trim();
    if (!serverId) throw new HttpError(400, 'serverId 가 필요합니다');
    let m = this.presence.get(g.id);
    if (!m) { m = new Map(); this.presence.set(g.id, m); }
    const prev = m.get(serverId);
    const names = Array.isArray(body.playerNames) ? body.playerNames.slice(0, 100).map((n) => str(n, 40)) : (prev ? prev.playerNames : []);
    m.set(serverId, { serverId, players: clamp(body.players, 0, 10000, 0), maxPlayers: clamp(body.maxPlayers, 0, 10000, 0), placeId: str(body.placeId, 40), region: str(body.region, 40), version: str(body.version, 30), playerNames: names, firstSeen: prev ? prev.firstSeen : Date.now(), lastSeen: Date.now() });
    return { online: this.online(g.id), servers: m.size };
  }

  broadcast(gid, text, meta = {}) {
    const g = this.get(gid);
    const b = { id: id(8), ts: Date.now(), text: str(text, 1000).trim(), type: str(meta.type, 20) || 'message', duration: clamp(meta.duration, 1, 3600, 10) };
    if (!b.text) throw new HttpError(400, '내용을 입력하세요');
    g.broadcasts.push(b);
    if (g.broadcasts.length > 50) g.broadcasts.splice(0, g.broadcasts.length - 50);
    this.ctx.store.save();
    return b;
  }
  broadcastsSince(g, since) {
    since = Number(since) || 0;
    return g.broadcasts.filter((b) => b.ts > since && Date.now() - b.ts < 24 * 3600 * 1000);
  }

  addLog(g, entry, ip) {
    const e = { ts: Date.now(), level: ['info', 'warn', 'error', 'debug'].includes(entry.level) ? entry.level : 'info', message: str(entry.message, 1000), player: str(entry.player, 60), serverId: str(entry.serverId, 80), ip };
    g.logs.push(e);
    if (g.logs.length > 300) g.logs.splice(0, g.logs.length - 300);
    this.ctx.store.save();
    return e;
  }

  // ---- 라이선스 키 ----
  createKeys(input) {
    const g = this.get(input.gameId);
    const count = clamp(input.count, 1, 200, 1);
    const prefix = (str(input.prefix, 12).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'KEY');
    const expires = input.expiresDays ? Date.now() + clamp(input.expiresDays, 1, 3650, 30) * 86400000 : null;
    const maxUses = input.maxUses ? clamp(input.maxUses, 1, 1000000, 1) : 0;
    const out = [];
    for (let i = 0; i < count; i++) {
      let key;
      do { key = `${prefix}-${seg()}-${seg()}-${seg()}`; } while (this.db.keys.some((k) => k.key === key));
      const k = { id: id(10), gameId: g.id, key, note: str(input.note, 120), hwid: null, expires, maxUses, uses: 0, created: Date.now(), lastUsed: null, lastIp: null, disabled: false };
      this.db.keys.push(k);
      out.push(k);
    }
    this.ctx.store.save();
    return out;
  }
  listKeys(gameId) { return this.db.keys.filter((k) => !gameId || k.gameId === gameId).slice().reverse(); }
  getKey(kid) {
    const k = this.db.keys.find((x) => x.id === kid);
    if (!k) throw new HttpError(404, '키를 찾을 수 없습니다');
    return k;
  }
  updateKey(kid, patch) {
    const k = this.getKey(kid);
    if (patch.disabled !== undefined) k.disabled = !!patch.disabled;
    if (patch.note !== undefined) k.note = str(patch.note, 120);
    if (patch.expires !== undefined) k.expires = patch.expires ? Number(patch.expires) : null;
    if (patch.maxUses !== undefined) k.maxUses = clamp(patch.maxUses, 0, 1000000, k.maxUses);
    if (patch.resetHwid) k.hwid = null;
    this.ctx.store.save();
    return k;
  }
  deleteKey(kid) {
    const k = this.getKey(kid);
    this.db.keys.splice(this.db.keys.indexOf(k), 1);
    this.ctx.store.save();
  }

  validateKey(g, keyStr, hwid, ip) {
    keyStr = str(keyStr, 80).trim().toUpperCase();
    hwid = str(hwid, 200).trim();
    const k = this.db.keys.find((x) => x.key === keyStr && x.gameId === g.id);
    if (!k) return { valid: false, reason: 'invalid', message: '존재하지 않는 키입니다' };
    if (k.disabled) return { valid: false, reason: 'disabled', message: '비활성화된 키입니다' };
    if (k.expires && k.expires < Date.now()) return { valid: false, reason: 'expired', message: '만료된 키입니다' };
    if (g.hwidBind) {
      if (!hwid) return { valid: false, reason: 'hwid_required', message: 'HWID 가 필요합니다' };
      if (k.hwid && k.hwid !== hwid) return { valid: false, reason: 'hwid_mismatch', message: '다른 기기에 등록된 키입니다' };
    }
    const newDevice = g.hwidBind && !k.hwid;
    if (k.maxUses && k.uses >= k.maxUses && newDevice) return { valid: false, reason: 'max_uses', message: '사용 횟수를 초과한 키입니다' };
    if (newDevice) k.hwid = hwid;
    k.uses += newDevice || !g.hwidBind ? 1 : 0;
    k.lastUsed = Date.now();
    k.lastIp = ip || null;
    this.ctx.store.save();
    return { valid: true, reason: 'ok', message: '인증 성공', expires: k.expires, note: k.note, uses: k.uses, maxUses: k.maxUses };
  }
}

module.exports = { Games };
