'use strict';
const fs = require('fs');
const path = require('path');
const { run, tsName, HttpError, findBin } = require('./util');

const NAME_RE = /^backup-\d{8}-\d{6}\.tar\.gz$/;

class Backup {
  constructor(ctx) {
    this.ctx = ctx;
    this.dir = path.join(ctx.dataDir, 'backups');
    fs.mkdirSync(this.dir, { recursive: true });
  }

  list() {
    return fs.readdirSync(this.dir).filter((f) => NAME_RE.test(f)).map((f) => {
      const st = fs.statSync(path.join(this.dir, f));
      return { name: f, size: st.size, mtime: st.mtimeMs };
    }).sort((a, b) => b.mtime - a.mtime);
  }

  filePath(name) {
    if (!NAME_RE.test(name)) throw new HttpError(400, '잘못된 백업 이름');
    return path.join(this.dir, name);
  }

  async create() {
    if (!findBin('tar')) throw new HttpError(500, 'tar 명령을 찾을 수 없습니다');
    this.ctx.store.saveNow();
    const name = `backup-${tsName()}.tar.gz`;
    const file = path.join(this.dir, name);
    const r = await run('tar', ['-czf', file, '-C', this.ctx.dataDir, '--exclude=./backups', '--exclude=*.qcow2', '--exclude=./isos', '--exclude=*.tmp', '.'], { timeout: 10 * 60 * 1000 });
    if (!r.ok) { try { fs.unlinkSync(file); } catch { /* ignore */ } throw new HttpError(500, '백업 실패: ' + (r.stderr || r.error)); }
    const st = fs.statSync(file);
    return { name, size: st.size, mtime: st.mtimeMs };
  }

  remove(name) {
    fs.unlinkSync(this.filePath(name));
  }

  async restore(name) {
    const file = this.filePath(name);
    const r = await run('tar', ['-xzf', file, '-C', this.ctx.dataDir], { timeout: 10 * 60 * 1000 });
    if (!r.ok) throw new HttpError(500, '복원 실패: ' + (r.stderr || r.error));
    this.ctx.store.load();
    return true;
  }
}

module.exports = { Backup };
