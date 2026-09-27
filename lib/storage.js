'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn } = require('child_process');
const { HttpError, id, token, findBin } = require('./util');

const BAD_NAME = /[\\/\0]|^\.{1,2}$/;

class Storage {
  constructor(ctx) {
    this.ctx = ctx;
    this.root = path.join(ctx.dataDir, 'storage');
    fs.mkdirSync(this.root, { recursive: true });
  }

  resolve(rel) {
    const clean = path.posix.normalize('/' + String(rel || '').replace(/\\/g, '/'));
    const abs = path.join(this.root, clean);
    if (abs !== this.root && !abs.startsWith(this.root + path.sep)) throw new HttpError(400, '잘못된 경로');
    return { abs, rel: clean === '/' ? '/' : clean.replace(/\/$/, '') };
  }

  quotaBytes() { return (this.ctx.db.settings.storage.quotaMB || 0) * 1024 * 1024; }

  async list(rel) {
    const { abs, rel: r } = this.resolve(rel);
    let ents;
    try { ents = await fsp.readdir(abs, { withFileTypes: true }); } catch (e) {
      if (e.code === 'ENOENT') throw new HttpError(404, '폴더가 없습니다');
      if (e.code === 'ENOTDIR') throw new HttpError(400, '폴더가 아닙니다');
      throw e;
    }
    const items = [];
    for (const e of ents) {
      try {
        const st = await fsp.stat(path.join(abs, e.name));
        items.push({ name: e.name, type: st.isDirectory() ? 'dir' : 'file', size: st.isDirectory() ? 0 : st.size, mtime: st.mtimeMs });
      } catch { /* skip broken */ }
    }
    items.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'ko') : a.type === 'dir' ? -1 : 1));
    return { path: r, items };
  }

  async stat(rel) {
    const { abs, rel: r } = this.resolve(rel);
    try {
      const st = await fsp.stat(abs);
      return { abs, rel: r, isDir: st.isDirectory(), size: st.size, mtime: st.mtimeMs, name: path.basename(abs) };
    } catch { throw new HttpError(404, '파일 또는 폴더가 없습니다'); }
  }

  async mkdir(rel) {
    const { abs, rel: r } = this.resolve(rel);
    if (r === '/') throw new HttpError(400, '이름을 입력하세요');
    if (BAD_NAME.test(path.basename(abs))) throw new HttpError(400, '잘못된 이름');
    await fsp.mkdir(abs, { recursive: true });
    return r;
  }

  async remove(rel) {
    const { abs, rel: r } = this.resolve(rel);
    if (r === '/') throw new HttpError(400, '루트는 삭제할 수 없습니다');
    await fsp.rm(abs, { recursive: true, force: true });
    this.ctx.db.shares = this.ctx.db.shares.filter((s) => s.path !== r && !s.path.startsWith(r + '/'));
    this.ctx.store.save();
  }

  async rename(from, to) {
    const a = this.resolve(from), b = this.resolve(to);
    if (a.rel === '/' || b.rel === '/') throw new HttpError(400, '루트는 이동할 수 없습니다');
    if (BAD_NAME.test(path.basename(b.abs))) throw new HttpError(400, '잘못된 이름');
    await fsp.mkdir(path.dirname(b.abs), { recursive: true });
    try { await fsp.access(b.abs); throw new HttpError(409, '같은 이름이 이미 존재합니다'); } catch (e) { if (e instanceof HttpError) throw e; }
    await fsp.rename(a.abs, b.abs);
    for (const s of this.ctx.db.shares) {
      if (s.path === a.rel) s.path = b.rel;
      else if (s.path.startsWith(a.rel + '/')) s.path = b.rel + s.path.slice(a.rel.length);
    }
    this.ctx.store.save();
  }

  async usage() {
    let used = 0, files = 0, dirs = 0;
    const walk = async (dir) => {
      let ents;
      try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { dirs++; await walk(p); }
        else if (e.isFile()) { try { used += (await fsp.stat(p)).size; files++; } catch { /* skip */ } }
      }
    };
    await walk(this.root);
    return { used, files, dirs, quota: this.quotaBytes() };
  }

  async upload(req, dirRel, name) {
    name = String(name || '');
    if (!name || BAD_NAME.test(name) || name.length > 255) throw new HttpError(400, '파일 이름이 올바르지 않습니다');
    const { abs: dirAbs } = this.resolve(dirRel);
    await fsp.mkdir(dirAbs, { recursive: true });
    const target = path.join(dirAbs, name);
    const len = Number(req.headers['content-length'] || 0);
    const quota = this.quotaBytes();
    if (quota > 0) {
      const u = await this.usage();
      if (u.used + len > quota) throw new HttpError(413, '저장 공간 할당량을 초과합니다');
    }
    const tmp = target + '.uploading-' + id(6) + '.tmp';
    await new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(tmp);
      let written = 0;
      req.on('data', (c) => { written += c.length; if (quota > 0 && written > len + 1024 * 1024) { req.destroy(new HttpError(413, '전송량이 선언된 크기를 초과했습니다')); } });
      req.on('error', reject);
      ws.on('error', reject);
      ws.on('finish', resolve);
      req.pipe(ws);
    }).catch(async (e) => { try { await fsp.unlink(tmp); } catch { /* ignore */ } throw e; });
    await fsp.rename(tmp, target);
    const st = await fsp.stat(target);
    return { name, size: st.size, path: path.posix.join(this.resolve(dirRel).rel, name) };
  }

  async readText(rel) {
    const s = await this.stat(rel);
    if (s.isDir) throw new HttpError(400, '폴더는 열 수 없습니다');
    if (s.size > 2 * 1024 * 1024) throw new HttpError(413, '2MB 이하 텍스트 파일만 편집할 수 있습니다');
    return { path: s.rel, name: s.name, content: await fsp.readFile(s.abs, 'utf8'), size: s.size };
  }

  async writeText(rel, content) {
    const { abs, rel: r } = this.resolve(rel);
    if (r === '/' || BAD_NAME.test(path.basename(abs))) throw new HttpError(400, '잘못된 경로');
    const buf = Buffer.from(String(content ?? ''), 'utf8');
    const quota = this.quotaBytes();
    if (quota > 0) {
      const u = await this.usage();
      let existing = 0;
      try { existing = (await fsp.stat(abs)).size; } catch { /* new file */ }
      if (u.used - existing + buf.length > quota) throw new HttpError(413, '저장 공간 할당량을 초과합니다');
    }
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, buf);
    return { path: r, size: buf.length };
  }

  // 폴더를 tar.gz 스트림으로
  tarStream(rel) {
    const { abs } = this.resolve(rel);
    if (!findBin('tar')) throw new HttpError(500, 'tar 명령을 찾을 수 없습니다');
    const child = spawn('tar', ['-czf', '-', '-C', path.dirname(abs), path.basename(abs)]);
    child.stderr.on('data', () => {});
    return child;
  }

  // 공유 링크
  createShare(rel, expiresHours) {
    const { rel: r } = this.resolve(rel);
    const share = { id: id(8), token: token(18), path: r, created: Date.now(), expires: expiresHours > 0 ? Date.now() + expiresHours * 3600 * 1000 : null, downloads: 0 };
    this.ctx.db.shares.push(share);
    this.ctx.store.save();
    return share;
  }
  listShares() {
    this.ctx.db.shares = this.ctx.db.shares.filter((s) => !s.expires || s.expires > Date.now());
    return this.ctx.db.shares;
  }
  deleteShare(sid) {
    const i = this.ctx.db.shares.findIndex((s) => s.id === sid);
    if (i < 0) throw new HttpError(404, '공유 링크가 없습니다');
    this.ctx.db.shares.splice(i, 1);
    this.ctx.store.save();
  }
  findShare(tok) {
    const s = this.ctx.db.shares.find((x) => x.token === tok);
    if (!s) return null;
    if (s.expires && s.expires < Date.now()) return null;
    return s;
  }
}

module.exports = { Storage };
