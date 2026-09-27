'use strict';
const os = require('os');
const fs = require('fs');
const { run, findBin } = require('./util');

const HISTORY = 90;

class Monitor {
  constructor() {
    this.history = { ts: [], cpu: [], mem: [], rx: [], tx: [] };
    this.lastCpu = this.cpuTimes();
    this.lastNet = this.readNet();
    this.lastNetTs = Date.now();
    this.latest = { cpu: 0, rxRate: 0, txRate: 0 };
    this.startedAt = Date.now();
    this.timer = setInterval(() => this.sample(), 2000);
    this.timer.unref();
  }

  cpuTimes() {
    let idle = 0, total = 0;
    for (const c of os.cpus()) {
      for (const k of Object.keys(c.times)) total += c.times[k];
      idle += c.times.idle;
    }
    return { idle, total };
  }

  readNet() {
    try {
      const txt = fs.readFileSync('/proc/net/dev', 'utf8');
      let rx = 0, tx = 0;
      for (const line of txt.split('\n').slice(2)) {
        const [name, rest] = line.split(':');
        if (!rest) continue;
        if (name.trim() === 'lo') continue;
        const f = rest.trim().split(/\s+/);
        rx += Number(f[0]) || 0;
        tx += Number(f[8]) || 0;
      }
      return { rx, tx };
    } catch { return null; }
  }

  sample() {
    const now = Date.now();
    const cur = this.cpuTimes();
    const dTotal = cur.total - this.lastCpu.total;
    const dIdle = cur.idle - this.lastCpu.idle;
    const cpu = dTotal > 0 ? Math.max(0, Math.min(100, (1 - dIdle / dTotal) * 100)) : 0;
    this.lastCpu = cur;

    const net = this.readNet();
    let rxRate = 0, txRate = 0;
    if (net && this.lastNet) {
      const dt = (now - this.lastNetTs) / 1000;
      rxRate = Math.max(0, (net.rx - this.lastNet.rx) / dt);
      txRate = Math.max(0, (net.tx - this.lastNet.tx) / dt);
    }
    this.lastNet = net;
    this.lastNetTs = now;

    const memUsed = (os.totalmem() - os.freemem()) / os.totalmem() * 100;
    this.latest = { cpu: +cpu.toFixed(1), rxRate: Math.round(rxRate), txRate: Math.round(txRate) };

    const h = this.history;
    h.ts.push(now); h.cpu.push(+cpu.toFixed(1)); h.mem.push(+memUsed.toFixed(1)); h.rx.push(Math.round(rxRate)); h.tx.push(Math.round(txRate));
    for (const k of Object.keys(h)) if (h[k].length > HISTORY) h[k].splice(0, h[k].length - HISTORY);
  }

  snapshot() {
    const cpus = os.cpus();
    let memAvailable = os.freemem();
    try {
      const m = fs.readFileSync('/proc/meminfo', 'utf8').match(/MemAvailable:\s+(\d+)/);
      if (m) memAvailable = Number(m[1]) * 1024;
    } catch { /* not linux */ }
    return {
      time: Date.now(),
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      release: os.release(),
      uptime: os.uptime(),
      appUptime: (Date.now() - this.startedAt) / 1000,
      loadavg: os.loadavg(),
      cpu: { model: cpus[0] ? cpus[0].model : 'unknown', cores: cpus.length, usage: this.latest.cpu, speed: cpus[0] ? cpus[0].speed : 0 },
      mem: { total: os.totalmem(), free: os.freemem(), available: memAvailable, used: os.totalmem() - memAvailable },
      net: { rxRate: this.latest.rxRate, txRate: this.latest.txRate, total: this.lastNet },
      node: process.version,
      pid: process.pid,
      history: this.history,
    };
  }

  async disks() {
    const r = await run('df', ['-kP']);
    if (!r.ok) return [];
    const out = [];
    for (const line of r.stdout.trim().split('\n').slice(1)) {
      const f = line.trim().split(/\s+/);
      if (f.length < 6) continue;
      const fsName = f[0], total = Number(f[1]) * 1024, used = Number(f[2]) * 1024, avail = Number(f[3]) * 1024;
      const mount = f.slice(5).join(' ');
      if (/^(tmpfs|devtmpfs|udev|none|proc|sysfs|cgroup|shm)$/.test(fsName) && !mount.startsWith('/home')) continue;
      if (total <= 0) continue;
      out.push({ fs: fsName, mount, total, used, avail, percent: Math.round(used / total * 100) });
    }
    return out;
  }

  async processes(limit = 40) {
    if (!findBin('ps')) return [];
    const r = await run('ps', ['-eo', 'pid,ppid,user,pcpu,pmem,rss,etime,comm,args', '--sort=-pcpu']);
    if (!r.ok) return [];
    const rows = [];
    for (const line of r.stdout.trim().split('\n').slice(1)) {
      const f = line.trim().split(/\s+/);
      if (f.length < 8) continue;
      rows.push({ pid: +f[0], ppid: +f[1], user: f[2], cpu: +f[3], mem: +f[4], rss: +f[5] * 1024, etime: f[6], comm: f[7], args: f.slice(8).join(' ').slice(0, 160) });
      if (rows.length >= limit) break;
    }
    return rows;
  }
}

module.exports = { Monitor };
