'use strict';
const net = require('net');
const os = require('os');
const dns = require('dns').promises;
const { run, findBin, isValidHost, HttpError, clamp } = require('./util');

async function ping(host) {
  if (!isValidHost(host)) throw new HttpError(400, '호스트 형식이 올바르지 않습니다');
  const bin = findBin('ping');
  if (!bin) {
    // ping 이 없으면 TCP 443/80 연결 시간으로 대체
    const t = await portCheck(host, 443);
    return { ok: t.open, output: `ping 명령이 없어 TCP 443 연결로 대체했습니다.\n${host}:443 → ${t.open ? `열림 (${t.ms}ms)` : '연결 실패'}` };
  }
  const r = await run(bin, ['-c', '4', '-W', '2', host], { timeout: 20000 });
  return { ok: r.ok, output: (r.stdout + (r.stderr ? '\n' + r.stderr : '')).trim() || r.error };
}

function portCheck(host, port) {
  if (!isValidHost(host)) throw new HttpError(400, '호스트 형식이 올바르지 않습니다');
  port = clamp(port, 1, 65535, 0);
  if (!port) throw new HttpError(400, '포트 번호가 올바르지 않습니다');
  return new Promise((resolve) => {
    const start = Date.now();
    const sock = net.connect({ host, port, timeout: 4000 });
    const done = (open, error) => { try { sock.destroy(); } catch { /* ignore */ } resolve({ host, port, open, ms: Date.now() - start, error }); };
    sock.on('connect', () => done(true));
    sock.on('timeout', () => done(false, 'timeout'));
    sock.on('error', (e) => done(false, e.code || e.message));
  });
}

async function lookup(host) {
  if (!isValidHost(host)) throw new HttpError(400, '호스트 형식이 올바르지 않습니다');
  const types = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT'];
  const results = await Promise.allSettled(types.map((t) => dns.resolve(host, t)));
  const out = {};
  types.forEach((t, i) => {
    const r = results[i];
    out[t] = r.status === 'fulfilled' ? r.value : [];
  });
  return out;
}

async function publicIp() {
  const urls = ['https://api.ipify.org?format=json', 'https://ifconfig.me/ip', 'https://icanhazip.com'];
  for (const u of urls) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(u, { signal: ctrl.signal, headers: { 'User-Agent': 'curl/8' } });
      clearTimeout(t);
      const text = (await res.text()).trim();
      if (!res.ok) continue;
      if (text.startsWith('{')) return { ip: JSON.parse(text).ip, source: u };
      return { ip: text, source: u };
    } catch { /* try next */ }
  }
  throw new HttpError(502, '공인 IP를 조회할 수 없습니다 (외부 네트워크 차단?)');
}

async function httpCheck(url) {
  let u;
  try { u = new URL(url); } catch { throw new HttpError(400, 'URL 형식이 올바르지 않습니다'); }
  if (!/^https?:$/.test(u.protocol)) throw new HttpError(400, 'http/https URL만 지원합니다');
  const start = Date.now();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(u, { method: 'GET', redirect: 'manual', signal: ctrl.signal, headers: { 'User-Agent': 'ServerHub/1.0' } });
    clearTimeout(t);
    const headers = {};
    for (const k of ['content-type', 'server', 'location', 'content-length', 'cache-control', 'x-powered-by']) if (res.headers.get(k)) headers[k] = res.headers.get(k);
    res.body && res.body.cancel && res.body.cancel().catch(() => {});
    return { ok: true, status: res.status, statusText: res.statusText, ms: Date.now() - start, headers };
  } catch (e) {
    return { ok: false, ms: Date.now() - start, error: e.cause ? (e.cause.code || e.cause.message) : e.message };
  }
}

async function listening() {
  if (findBin('ss')) {
    const r = await run('ss', ['-tulpnH']);
    if (r.ok) {
      return r.stdout.trim().split('\n').filter(Boolean).map((line) => {
        const f = line.trim().split(/\s+/);
        const proc = (f.slice(6).join(' ').match(/users:\(\("([^"]+)",pid=(\d+)/) || []);
        return { proto: f[0], state: f[1], local: f[4], peer: f[5], process: proc[1] || '', pid: proc[2] ? +proc[2] : null };
      });
    }
  }
  if (findBin('netstat')) {
    const r = await run('netstat', ['-tulpn']);
    if (r.ok) {
      return r.stdout.trim().split('\n').slice(2).map((line) => {
        const f = line.trim().split(/\s+/);
        return { proto: f[0], state: f[5] && !/\d/.test(f[5]) ? f[5] : '', local: f[3], peer: f[4], process: (f[6] || f[5] || '').split('/')[1] || '', pid: null };
      });
    }
  }
  return [];
}

function interfaces() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) out.push({ name, family: a.family, address: a.address, netmask: a.netmask, mac: a.mac, internal: a.internal });
  }
  return out;
}

module.exports = { ping, portCheck, lookup, publicIp, httpCheck, listening, interfaces };
