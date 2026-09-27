'use strict';
// 5필드 cron 파서: 분 시 일 월 요일  (지원: * , - / 및 7=일요일)
const RANGES = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];

function parseField(field, min, max) {
  const set = new Set();
  for (const part of field.split(',')) {
    const m = part.match(/^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/);
    if (!m) throw new Error('잘못된 cron 필드: ' + part);
    const step = m[3] ? parseInt(m[3], 10) : 1;
    let start, end;
    if (m[1] === '*') { start = min; end = max; }
    else {
      start = parseInt(m[1], 10);
      end = m[2] !== undefined ? parseInt(m[2], 10) : (m[3] ? max : start);
    }
    if (step < 1 || start < min || end > max || start > end) throw new Error('범위 오류: ' + part);
    for (let v = start; v <= end; v += step) set.add(v);
  }
  return set;
}

function parse(expr) {
  const parts = String(expr || '').trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('cron 표현식은 5개 필드여야 합니다 (분 시 일 월 요일)');
  const sets = parts.map((p, i) => parseField(p, RANGES[i][0], RANGES[i][1]));
  if (sets[4].has(7)) sets[4].add(0);
  const domStar = parts[2] === '*';
  const dowStar = parts[4] === '*';

  function dayOk(d) {
    const domOk = sets[2].has(d.getDate());
    const dowOk = sets[4].has(d.getDay());
    if (domStar && dowStar) return true;
    if (domStar) return dowOk;
    if (dowStar) return domOk;
    return domOk || dowOk;
  }

  return {
    matches(d) {
      return sets[0].has(d.getMinutes()) && sets[1].has(d.getHours()) && sets[3].has(d.getMonth() + 1) && dayOk(d);
    },
    next(from = new Date()) {
      const d = new Date(from.getTime());
      d.setSeconds(0, 0);
      d.setMinutes(d.getMinutes() + 1);
      const limit = d.getTime() + 366 * 24 * 3600 * 1000;
      while (d.getTime() < limit) {
        if (!sets[3].has(d.getMonth() + 1)) { d.setMonth(d.getMonth() + 1, 1); d.setHours(0, 0, 0, 0); continue; }
        if (!dayOk(d)) { d.setDate(d.getDate() + 1); d.setHours(0, 0, 0, 0); continue; }
        if (!sets[1].has(d.getHours())) { d.setHours(d.getHours() + 1, 0, 0, 0); continue; }
        if (!sets[0].has(d.getMinutes())) { d.setMinutes(d.getMinutes() + 1); continue; }
        return d;
      }
      return null;
    },
  };
}

function describe(expr) {
  try {
    const [m, h, dom, mon, dow] = String(expr).trim().split(/\s+/);
    const days = ['일', '월', '화', '수', '목', '금', '토', '일'];
    if (m.startsWith('*/') && h === '*' && dom === '*' && mon === '*' && dow === '*') return `${m.slice(2)}분마다`;
    if (m === '*' && h === '*') return '매분';
    if (h.startsWith('*/') && dom === '*' && mon === '*' && dow === '*') return `${h.slice(2)}시간마다 (${m}분)`;
    if (dom === '*' && mon === '*' && dow === '*') return `매일 ${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
    if (dom === '*' && mon === '*') {
      const names = dow.split(',').map((x) => x.includes('-') ? x.split('-').map((n) => days[+n]).join('~') : days[+x]).join(',');
      return `매주 ${names} ${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
    }
    if (mon === '*' && dow === '*') return `매월 ${dom}일 ${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
    return expr;
  } catch { return String(expr); }
}

module.exports = { parse, describe };
