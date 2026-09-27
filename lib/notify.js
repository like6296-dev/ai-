'use strict';

const COLORS = { info: 0x3b82f6, ok: 0x22c55e, warn: 0xf59e0b, error: 0xef4444, maint: 0xa855f7 };

class Notify {
  constructor(ctx) { this.ctx = ctx; }

  async send(title, description, level = 'info', url) {
    const webhook = url || this.ctx.db.settings.discordWebhook;
    if (!webhook || !/^https:\/\/(discord\.com|discordapp\.com|canary\.discord\.com|ptb\.discord\.com)\/api\/webhooks\//.test(webhook)) {
      return { ok: false, skipped: true, message: 'Discord 웹훅 URL이 설정되지 않았거나 형식이 올바르지 않습니다' };
    }
    const body = {
      username: this.ctx.db.settings.siteName || 'HALCYON',
      embeds: [{ title: String(title).slice(0, 250), description: String(description || '').slice(0, 3900), color: COLORS[level] || COLORS.info, timestamp: new Date().toISOString() }],
    };
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
      clearTimeout(t);
      return { ok: res.ok, status: res.status, message: res.ok ? '전송 완료' : `전송 실패 (HTTP ${res.status})` };
    } catch (e) {
      return { ok: false, message: '전송 실패: ' + e.message };
    }
  }

  // 실패해도 서버 흐름을 막지 않는 알림
  fire(title, description, level) {
    this.send(title, description, level).catch(() => {});
  }
}

module.exports = { Notify };
