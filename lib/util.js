'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function id(len = 12) {
  return crypto.randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len);
}
function token(bytes = 24) { return crypto.randomBytes(bytes).toString('base64url'); }

function findBin(name) {
  const dirs = (process.env.PATH || '').split(path.delimiter)
    .concat(['/usr/local/sbin', '/usr/sbin', '/sbin', '/usr/local/bin', '/usr/bin', '/bin']);
  for (const d of dirs) {
    if (!d) continue;
    const p = path.join(d, name);
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* next */ }
  }
  return null;
}

function run(cmd, args = [], opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: opts.timeout || 30000, maxBuffer: 16 * 1024 * 1024, env: process.env, ...opts },
      (err, stdout, stderr) => {
        resolve({
          ok: !err,
          code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
          error: err ? err.message : null,
        });
      });
  });
}

function sh(command, opts = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('/bin/sh', ['-c', command], { env: process.env, cwd: opts.cwd });
    } catch (e) {
      return resolve({ ok: false, code: -1, stdout: '', stderr: e.message });
    }
    let out = '', errOut = '', killed = false;
    const t = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, opts.timeout || 60000);
    child.stdout.on('data', (d) => { if (out.length < 1e6) out += d; });
    child.stderr.on('data', (d) => { if (errOut.length < 1e6) errOut += d; });
    child.on('close', (code) => {
      clearTimeout(t);
      resolve({ ok: code === 0, code, stdout: out, stderr: killed ? errOut + '\n[시간 초과로 종료됨]' : errOut });
    });
    child.on('error', (e) => { clearTimeout(t); resolve({ ok: false, code: -1, stdout: out, stderr: e.message }); });
  });
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  }
  return out;
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, '요청 본문이 너무 큽니다')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req, limit) {
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400, 'JSON 형식이 올바르지 않습니다'); }
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendText(res, status, text, type = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(text), 'Cache-Control': 'no-store', ...extra });
  res.end(text);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf', '.zip': 'application/zip', '.gz': 'application/gzip', '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.lua': 'text/plain; charset=utf-8',
  '.conf': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.iso': 'application/octet-stream',
};
function mime(file) { return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'; }

function sendFile(res, filePath, opts = {}) {
  return new Promise((resolve) => {
    fs.stat(filePath, (err, st) => {
      if (err || !st.isFile()) { sendJson(res, 404, { error: '파일을 찾을 수 없습니다' }); return resolve(); }
      const headers = {
        'Content-Type': opts.type || mime(filePath),
        'Content-Length': st.size,
        'Cache-Control': opts.cache || 'no-cache',
      };
      if (opts.download) {
        headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(opts.download)}`;
      }
      res.writeHead(opts.status || 200, headers);
      const stream = fs.createReadStream(filePath);
      stream.on('error', () => { try { res.destroy(); } catch { /* ignore */ } resolve(); });
      stream.on('end', resolve);
      stream.pipe(res);
    });
  });
}

function clientIp(req, trustProxy) {
  if (trustProxy) {
    const xf = req.headers['x-forwarded-for'];
    if (xf) return String(xf).split(',')[0].trim();
    const xr = req.headers['x-real-ip'];
    if (xr) return String(xr).trim();
  }
  let ip = req.socket.remoteAddress || '';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip;
}

function isValidHost(h) {
  if (typeof h !== 'string' || h.length > 253) return false;
  return /^[a-zA-Z0-9.-]+$/.test(h) || /^[0-9a-fA-F:.]+$/.test(h);
}

function clamp(n, min, max, def) {
  n = Number(n);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function str(v, max = 500) {
  if (v === undefined || v === null) return '';
  return String(v).slice(0, max);
}

function tsName(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

module.exports = { HttpError, id, token, findBin, run, sh, parseCookies, readBody, readJson, sendJson, sendText, sendFile, mime, clientIp, isValidHost, clamp, str, tsName };
