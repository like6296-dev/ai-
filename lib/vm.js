'use strict';
const fs = require('fs');
const path = require('path');
const { findBin, run, id, HttpError, clamp, str } = require('./util');

const NAME_RE = /^[a-zA-Z0-9가-힣_-]{1,40}$/;
const IMAGE_RE = /^[a-z0-9][a-z0-9._\/-]*(:[a-zA-Z0-9._-]+)?(@sha256:[a-f0-9]{64})?$/;
const PORT_RE = /^\d{1,5}:\d{1,5}(\/(tcp|udp))?$/;

class VmManager {
  constructor(ctx) {
    this.ctx = ctx;
    this.dir = path.join(ctx.dataDir, 'vms');
    this.isoDir = path.join(ctx.dataDir, 'isos');
    fs.mkdirSync(this.dir, { recursive: true });
    fs.mkdirSync(this.isoDir, { recursive: true });
    this.backends = { qemu: false, kvm: false, docker: false, dockerVersion: '', checkedAt: 0 };
    this.detect().then(() => this.refresh()).catch(() => {});
    this.timer = setInterval(() => this.refresh().catch(() => {}), 10000);
    this.timer.unref();
  }
  get vms() { return this.ctx.db.vms; }

  async detect() {
    this.backends.qemu = !!findBin('qemu-system-x86_64');
    this.backends.qemuImg = !!findBin('qemu-img');
    this.backends.kvm = fs.existsSync('/dev/kvm');
    if (findBin('docker')) {
      const r = await run('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: 8000 });
      this.backends.docker = r.ok;
      this.backends.dockerVersion = r.ok ? r.stdout.trim() : '';
      this.backends.dockerError = r.ok ? '' : (r.stderr || r.error || '').trim().split('\n')[0];
    } else { this.backends.docker = false; this.backends.dockerError = 'docker 명령 없음'; }
    this.backends.checkedAt = Date.now();
    return this.backends;
  }

  pickBackend(requested) {
    let b = requested && requested !== 'auto' ? requested : (this.backends.qemu ? 'qemu' : this.backends.docker ? 'docker' : 'simulated');
    if (!['qemu', 'docker', 'simulated'].includes(b)) throw new HttpError(400, '알 수 없는 백엔드');
    if (b === 'qemu' && !this.backends.qemu) throw new HttpError(400, 'QEMU 가 설치되어 있지 않습니다');
    if (b === 'docker' && !this.backends.docker) throw new HttpError(400, 'Docker 를 사용할 수 없습니다: ' + (this.backends.dockerError || ''));
    return b;
  }

  get(vmId) {
    const vm = this.vms.find((v) => v.id === vmId);
    if (!vm) throw new HttpError(404, 'VM 을 찾을 수 없습니다');
    return vm;
  }
  vmDir(vm) { return path.join(this.dir, vm.id); }
  diskPath(vm) { return path.join(this.vmDir(vm), 'disk.qcow2'); }
  containerName(vm) { return 'serverhub-' + vm.id; }
  nextVnc() {
    const used = new Set(this.vms.map((v) => v.vncPort));
    for (let p = 5900; p < 6000; p++) if (!used.has(p)) return p;
    return 5900;
  }

  listIsos() {
    try { return fs.readdirSync(this.isoDir).filter((f) => /\.(iso|img)$/i.test(f)).map((f) => ({ name: f, size: fs.statSync(path.join(this.isoDir, f)).size })); } catch { return []; }
  }

  async create(input) {
    const name = str(input.name, 40).trim();
    if (!NAME_RE.test(name)) throw new HttpError(400, '이름은 영문/숫자/한글/-/_ 1~40자만 가능합니다');
    if (this.vms.some((v) => v.name === name)) throw new HttpError(409, '같은 이름의 VM 이 있습니다');
    const backend = this.pickBackend(input.backend);
    const vm = {
      id: id(8), name, backend,
      cpus: clamp(input.cpus, 1, 64, 1), memMB: clamp(input.memMB, 64, 262144, 1024), diskGB: clamp(input.diskGB, 1, 4096, 20),
      iso: str(input.iso, 200), bootFromIso: !!input.bootFromIso,
      image: str(input.image, 200).trim() || 'alpine:latest', ports: [], notes: str(input.notes, 500),
      state: 'stopped', pid: null, containerId: null, vncPort: backend === 'qemu' ? this.nextVnc() : null,
      created: Date.now(), startedAt: null, lastError: null,
    };
    if (Array.isArray(input.ports)) vm.ports = input.ports.map((p) => String(p).trim()).filter((p) => PORT_RE.test(p)).slice(0, 20);
    if (backend === 'docker' && !IMAGE_RE.test(vm.image)) throw new HttpError(400, '이미지 이름 형식이 올바르지 않습니다');
    if (backend === 'qemu') {
      if (vm.iso && !this.listIsos().some((i) => i.name === vm.iso)) throw new HttpError(400, 'ISO 파일을 찾을 수 없습니다');
      fs.mkdirSync(this.vmDir(vm), { recursive: true });
      if (this.backends.qemuImg) {
        const r = await run('qemu-img', ['create', '-f', 'qcow2', this.diskPath(vm), `${vm.diskGB}G`]);
        if (!r.ok) throw new HttpError(500, '디스크 생성 실패: ' + (r.stderr || r.error));
      }
    }
    this.vms.push(vm);
    this.ctx.store.save();
    return vm;
  }

  async update(vmId, patch) {
    const vm = this.get(vmId);
    if (vm.state === 'running') throw new HttpError(400, '실행 중인 VM 은 수정할 수 없습니다. 먼저 정지하세요');
    if (patch.cpus !== undefined) vm.cpus = clamp(patch.cpus, 1, 64, vm.cpus);
    if (patch.memMB !== undefined) vm.memMB = clamp(patch.memMB, 64, 262144, vm.memMB);
    if (patch.iso !== undefined) vm.iso = str(patch.iso, 200);
    if (patch.bootFromIso !== undefined) vm.bootFromIso = !!patch.bootFromIso;
    if (patch.image !== undefined) { if (!IMAGE_RE.test(String(patch.image))) throw new HttpError(400, '이미지 이름 형식이 올바르지 않습니다'); vm.image = String(patch.image); }
    if (patch.notes !== undefined) vm.notes = str(patch.notes, 500);
    if (Array.isArray(patch.ports)) vm.ports = patch.ports.map((p) => String(p).trim()).filter((p) => PORT_RE.test(p)).slice(0, 20);
    this.ctx.store.save();
    return vm;
  }

  async start(vmId) {
    const vm = this.get(vmId);
    await this.refreshOne(vm);
    if (vm.state === 'running') return vm;
    vm.lastError = null;
    try {
      if (vm.backend === 'qemu') await this.startQemu(vm);
      else if (vm.backend === 'docker') await this.startDocker(vm);
      else { vm.pid = null; }
      vm.state = 'running';
      vm.startedAt = Date.now();
    } catch (e) {
      vm.state = 'stopped';
      vm.lastError = e.message;
      this.ctx.store.save();
      throw e instanceof HttpError ? e : new HttpError(500, e.message);
    }
    this.ctx.store.save();
    return vm;
  }

  async startQemu(vm) {
    const pidfile = path.join(this.vmDir(vm), 'qemu.pid');
    const args = ['-name', vm.name, '-m', String(vm.memMB), '-smp', String(vm.cpus), '-daemonize', '-pidfile', pidfile,
      '-vnc', `:${vm.vncPort - 5900}`, '-drive', `file=${this.diskPath(vm)},format=qcow2,if=virtio`, '-netdev', 'user,id=n0', '-device', 'virtio-net-pci,netdev=n0'];
    if (this.backends.kvm) args.push('-enable-kvm', '-cpu', 'host');
    if (vm.iso) { args.push('-cdrom', path.join(this.isoDir, vm.iso)); args.push('-boot', vm.bootFromIso ? 'order=d' : 'order=c'); }
    try { fs.unlinkSync(pidfile); } catch { /* ignore */ }
    const r = await run('qemu-system-x86_64', args, { timeout: 30000 });
    if (!r.ok) throw new Error('QEMU 실행 실패: ' + (r.stderr || r.error).trim());
    vm.pid = parseInt(fs.readFileSync(pidfile, 'utf8').trim(), 10) || null;
  }

  async startDocker(vm) {
    const name = this.containerName(vm);
    await run('docker', ['rm', '-f', name], { timeout: 20000 });
    const args = ['run', '-d', '--name', name, '--hostname', vm.name.replace(/[^a-zA-Z0-9-]/g, '-') || 'vm', '--cpus', String(vm.cpus), '--memory', `${vm.memMB}m`, '--restart', 'no'];
    for (const p of vm.ports) args.push('-p', p);
    args.push(vm.image, 'sh', '-c', 'while true; do sleep 3600; done');
    const r = await run('docker', args, { timeout: 5 * 60 * 1000 });
    if (!r.ok) throw new Error('컨테이너 실행 실패: ' + (r.stderr || r.error).trim());
    vm.containerId = r.stdout.trim().slice(0, 12);
  }

  async stop(vmId, force = false) {
    const vm = this.get(vmId);
    if (vm.backend === 'qemu' && vm.pid) {
      try { process.kill(vm.pid, force ? 'SIGKILL' : 'SIGTERM'); } catch { /* already gone */ }
      for (let i = 0; i < 20 && this.pidAlive(vm.pid); i++) await new Promise((r) => setTimeout(r, 250));
      if (this.pidAlive(vm.pid)) { try { process.kill(vm.pid, 'SIGKILL'); } catch { /* ignore */ } }
      vm.pid = null;
    } else if (vm.backend === 'docker') {
      await run('docker', force ? ['kill', this.containerName(vm)] : ['stop', '-t', '10', this.containerName(vm)], { timeout: 40000 });
      await run('docker', ['rm', '-f', this.containerName(vm)], { timeout: 20000 });
      vm.containerId = null;
    }
    vm.state = 'stopped';
    vm.startedAt = null;
    this.ctx.store.save();
    return vm;
  }

  async remove(vmId) {
    const vm = this.get(vmId);
    await this.stop(vmId, true);
    if (vm.backend === 'qemu') fs.rmSync(this.vmDir(vm), { recursive: true, force: true });
    this.vms.splice(this.vms.indexOf(vm), 1);
    this.ctx.store.save();
  }

  pidAlive(pid) { if (!pid) return false; try { process.kill(pid, 0); return true; } catch { return false; } }

  async refreshOne(vm) {
    const before = vm.state;
    if (vm.backend === 'qemu') { if (vm.state === 'running' && !this.pidAlive(vm.pid)) { vm.state = 'stopped'; vm.pid = null; } }
    else if (vm.backend === 'docker') {
      if (vm.state === 'running' && this.backends.docker) {
        const r = await run('docker', ['inspect', '-f', '{{.State.Running}}', this.containerName(vm)], { timeout: 8000 });
        if (!r.ok || r.stdout.trim() !== 'true') { vm.state = 'stopped'; vm.containerId = null; }
      }
    }
    return before !== vm.state;
  }
  async refresh() {
    if (Date.now() - this.backends.checkedAt > 60000) await this.detect();
    let changed = false;
    for (const vm of this.vms) if (await this.refreshOne(vm)) changed = true;
    if (changed) this.ctx.store.save();
  }

  async exec(vmId, cmd) {
    const vm = this.get(vmId);
    if (vm.state !== 'running') throw new HttpError(400, 'VM 이 실행 중이 아닙니다');
    if (vm.backend === 'docker') {
      const r = await run('docker', ['exec', this.containerName(vm), 'sh', '-c', String(cmd).slice(0, 4000)], { timeout: 60000 });
      return { ok: r.ok, code: r.code, output: (r.stdout + (r.stderr ? r.stderr : '')).slice(0, 200000) };
    }
    if (vm.backend === 'simulated') return { ok: true, code: 0, output: `[시뮬레이션] ${vm.name}$ ${cmd}\n(실제 실행 백엔드가 없어 명령이 실행되지 않았습니다)` };
    throw new HttpError(400, 'QEMU VM 은 VNC 콘솔(포트 ' + vm.vncPort + ')로 접속하세요');
  }

  async logs(vmId) {
    const vm = this.get(vmId);
    if (vm.backend !== 'docker' || !this.backends.docker) return '';
    const r = await run('docker', ['logs', '--tail', '200', this.containerName(vm)], { timeout: 15000 });
    return (r.stdout + r.stderr).slice(-50000);
  }

  async stats(vmId) {
    const vm = this.get(vmId);
    if (vm.state !== 'running') return null;
    if (vm.backend === 'docker') {
      const r = await run('docker', ['stats', '--no-stream', '--format', '{{json .}}', this.containerName(vm)], { timeout: 15000 });
      if (!r.ok) return null;
      try { const j = JSON.parse(r.stdout.trim()); return { cpu: j.CPUPerc, mem: j.MemUsage, memPerc: j.MemPerc, net: j.NetIO, block: j.BlockIO, pids: j.PIDs }; } catch { return null; }
    }
    if (vm.backend === 'qemu' && vm.pid) {
      const r = await run('ps', ['-o', 'pcpu=,rss=', '-p', String(vm.pid)], { timeout: 5000 });
      if (!r.ok) return null;
      const [cpu, rss] = r.stdout.trim().split(/\s+/);
      return { cpu: cpu + '%', mem: `${Math.round(+rss / 1024)}MiB / ${vm.memMB}MiB`, memPerc: `${Math.round(+rss / 1024 / vm.memMB * 100)}%` };
    }
    return { cpu: '—', mem: `— / ${vm.memMB}MiB`, note: '시뮬레이션 모드: 실제 리소스를 사용하지 않습니다' };
  }
}

module.exports = { VmManager };
