'use strict';
const fs = require('fs');
const path = require('path');

function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function deepMerge(base, over) {
  const out = { ...base };
  for (const k of Object.keys(over || {})) {
    out[k] = isObj(base[k]) && isObj(over[k]) ? deepMerge(base[k], over[k]) : over[k];
  }
  return out;
}

class Store {
  constructor(file, defaults) {
    this.file = file;
    this.defaults = defaults;
    this.data = null;
    this.timer = null;
    this.load();
  }

  load() {
    let parsed = {};
    try { parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { parsed = {}; }
    this.data = deepMerge(this.defaults(), parsed);
    if (!fs.existsSync(this.file)) this.saveNow();
  }

  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.saveNow(); }, 80);
  }

  saveNow() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { Store, deepMerge };
