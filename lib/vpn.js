'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { findBin, run, id, HttpError, str, clamp } = require('./util');

function genKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  const priv = privateKey.export({ type: 'pkcs8', format: 'der' }).subarray(-32);
  const pub = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  return { privateKey: priv.toString('base64'), publicKey: pub.toString('base64') };
}
function genPsk() { return crypto.randomBytes(32).toString('base64'); }

const IFACE_RE = /^[a-zA-Z0-9_=+.-]{1,15}$/;
const CIDR_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/;

class Vpn {
  constructor(ctx) {
    this.ctx = ctx;
    this.dir = path.join(ctx.dataDir, 'vpn');
    fs.mkdirSync(this.dir, { recursive: true });
    this.ensureKeys();
  }
  get s() { return this.ctx.db.settings.vpn; }
  get peers() { return this.ctx.db.vpnPeers; }

  ensureKeys() {
    if (!this.s.privateKey || !this.s.publicKey) {
      Object.assign(this.s, genKeyPair());
      this.ctx.store.save();
    }
  }
  regenerateKeys() {
    Object.assign(this.s, genKeyPair());
    this.ctx.store.save();
    return this.s.publicKey;
  }

  updateSettings(patch) {
    const s = this.s;
    if (patch.interface !== undefined) { if (!IFACE_RE.test(patch.interface)) throw new HttpError(400, '인터페이스 이름이 올바르지 않습니다'); s.interface = patch.interface; }
    if (patch.address !== undefined && patch.address !== s.address) {
      if (!CIDR_RE.test(patch.address)) throw new HttpError(400, '주소는 10.8.0.1/24 형식이어야 합니다');
      s.address = patch.address;
      // 서브넷이 바뀌면 피어 IP 를 새 대역으로 순서대로 재할당
      const { base } = this.network();
      let host = 2;
      for (const p of this.peers) { if (host === base[3]) host++; p.ip = `${base[0]}.${base[1]}.${base[2]}.${host++}`; }
    }
    if (patch.port !== undefined) s.port = clamp(patch.port, 1, 65535, 51820);
    if (patch.endpoint !== undefined) s.endpoint = str(patch.endpoint, 253).trim();
    if (patch.dns !== undefined) s.dns = str(patch.dns, 200).trim() || '1.1.1.1';
    if (patch.allowedIps !== undefined) s.allowedIps = str(patch.allowedIps, 500).trim() || '0.0.0.0/0, ::/0';
    if (patch.nat !== undefined) s.nat = !!patch.nat;
    if (patch.natInterface !== undefined) { if (patch.natInterface && !IFACE_RE.test(patch.natInterface)) throw new HttpError(400, 'NAT 인터페이스 이름이 올바르지 않습니다'); s.natInterface = patch.natInterface; }
    if (patch.mtu !== undefined) s.mtu = patch.mtu ? clamp(patch.mtu, 1280, 9000, 1420) : 0;
    this.ctx.store.save();
    return s;
  }

  network() {
    const m = this.s.address.match(CIDR_RE);
    return { base: [+m[1], +m[2], +m[3], +m[4]], cidr: +m[5] };
  }
  nextIp() {
    const used = new Set(this.peers.map((p) => p.ip));
    const { base } = this.network();
    for (let i = 2; i < 255; i++) {
      const ip = `${base[0]}.${base[1]}.${base[2]}.${i}`;
      if (i !== base[3] && !used.has(ip)) return ip;
    }
    throw new HttpError(400, '할당 가능한 IP가 없습니다');
  }

  addPeer(name) {
    const peer = { id: id(10), name: str(name, 60).trim() || 'peer-' + (this.peers.length + 1), ...genKeyPair(), presharedKey: genPsk(), ip: this.nextIp(), created: Date.now(), enabled: true };
    this.peers.push(peer);
    this.ctx.store.save();
    return peer;
  }
  getPeer(pid) {
    const p = this.peers.find((x) => x.id === pid);
    if (!p) throw new HttpError(404, '피어를 찾을 수 없습니다');
    return p;
  }
  updatePeer(pid, patch) {
    const p = this.getPeer(pid);
    if (patch.name !== undefined) p.name = str(patch.name, 60).trim() || p.name;
    if (patch.enabled !== undefined) p.enabled = !!patch.enabled;
    this.ctx.store.save();
    return p;
  }
  removePeer(pid) {
    const i = this.peers.findIndex((x) => x.id === pid);
    if (i < 0) throw new HttpError(404, '피어를 찾을 수 없습니다');
    this.peers.splice(i, 1);
    this.ctx.store.save();
  }

  serverConfig() {
    const s = this.s;
    const lines = ['[Interface]', `Address = ${s.address}`, `ListenPort = ${s.port}`, `PrivateKey = ${s.privateKey}`];
    if (s.mtu) lines.push(`MTU = ${s.mtu}`);
    if (s.nat) {
      const out = s.natInterface || 'eth0';
      lines.push(`PostUp = iptables -A FORWARD -i %i -j ACCEPT; iptables -A FORWARD -o %i -j ACCEPT; iptables -t nat -A POSTROUTING -o ${out} -j MASQUERADE`);
      lines.push(`PostDown = iptables -D FORWARD -i %i -j ACCEPT; iptables -D FORWARD -o %i -j ACCEPT; iptables -t nat -D POSTROUTING -o ${out} -j MASQUERADE`);
    }
    for (const p of this.peers.filter((x) => x.enabled)) {
      lines.push('', `# ${p.name} (${p.id})`, '[Peer]', `PublicKey = ${p.publicKey}`, `PresharedKey = ${p.presharedKey}`, `AllowedIPs = ${p.ip}/32`);
    }
    return lines.join('\n') + '\n';
  }

  clientConfig(peer) {
    const s = this.s;
    const { cidr } = this.network();
    const host = s.endpoint || this.ctx.db.settings.publicHost || 'YOUR_SERVER_IP';
    const endpoint = host.includes(':') && !host.startsWith('[') && host.split(':').length > 2 ? `[${host}]:${s.port}` : (host.includes(':') ? host : `${host}:${s.port}`);
    const lines = ['[Interface]', `PrivateKey = ${peer.privateKey}`, `Address = ${peer.ip}/${cidr}`, `DNS = ${s.dns}`];
    if (s.mtu) lines.push(`MTU = ${s.mtu}`);
    lines.push('', '[Peer]', `PublicKey = ${s.publicKey}`, `PresharedKey = ${peer.presharedKey}`, `Endpoint = ${endpoint}`, `AllowedIPs = ${s.allowedIps || '0.0.0.0/0, ::/0'}`, 'PersistentKeepalive = 25');
    return lines.join('\n') + '\n';
  }

  confPath() { return path.join(this.dir, `${this.s.interface}.conf`); }
  writeConfig() {
    const p = this.confPath();
    fs.writeFileSync(p, this.serverConfig(), { mode: 0o600 });
    return p;
  }
  available() { return { wg: !!findBin('wg'), wgQuick: !!findBin('wg-quick'), root: typeof process.getuid === 'function' ? process.getuid() === 0 : false }; }

  async apply() {
    const p = this.writeConfig();
    const a = this.available();
    if (!a.wgQuick) return { ok: true, applied: false, path: p, message: 'wg-quick 이 설치되어 있지 않아 설정 파일만 저장했습니다: ' + p };
    await run('wg-quick', ['down', p], { timeout: 20000 });
    const r = await run('wg-quick', ['up', p], { timeout: 30000 });
    return { ok: r.ok, applied: r.ok, path: p, message: r.ok ? `${this.s.interface} 인터페이스를 올렸습니다` : ((r.stderr || r.error || '').trim() || '적용 실패') };
  }
  async down() {
    const a = this.available();
    if (!a.wgQuick) return { ok: false, message: 'wg-quick 이 설치되어 있지 않습니다' };
    const r = await run('wg-quick', ['down', this.confPath()], { timeout: 20000 });
    return { ok: r.ok, message: r.ok ? '인터페이스를 내렸습니다' : (r.stderr || r.error || '').trim() };
  }

  async status() {
    const a = this.available();
    if (!a.wg) return { ...a, running: false, peers: {}, message: 'WireGuard(wg) 가 설치되어 있지 않습니다. 설정 파일 생성만 가능합니다.' };
    const r = await run('wg', ['show', this.s.interface, 'dump'], { timeout: 8000 });
    if (!r.ok) return { ...a, running: false, peers: {}, message: (r.stderr || '').trim() || '인터페이스가 실행 중이 아닙니다' };
    const lines = r.stdout.trim().split('\n');
    const peers = {};
    for (const line of lines.slice(1)) {
      const f = line.split('\t');
      if (f.length < 8) continue;
      peers[f[0]] = { endpoint: f[2] !== '(none)' ? f[2] : null, allowedIps: f[3], handshake: +f[4] ? +f[4] * 1000 : null, rx: +f[5], tx: +f[6] };
    }
    return { ...a, running: true, peers, listenPort: +(lines[0] || '').split('\t')[2] || this.s.port };
  }
}

module.exports = { Vpn, genKeyPair };
