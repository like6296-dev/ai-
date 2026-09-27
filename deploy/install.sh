#!/usr/bin/env bash
# HALCYON 홈 서버 콘솔 — 리눅스 서버 한 줄 설치 (Ubuntu/Debian, root 권한)
#   curl -fsSL https://raw.githubusercontent.com/like6296-dev/ai-/main/deploy/install.sh | sudo bash
set -euo pipefail
REPO="${HALCYON_REPO:-https://github.com/like6296-dev/ai-.git}"
DIR="${HALCYON_DIR:-/opt/halcyon}"
PORT="${PORT:-3000}"

if [ "$(id -u)" -ne 0 ]; then echo "root 권한이 필요합니다: sudo bash install.sh" >&2; exit 1; fi
export DEBIAN_FRONTEND=noninteractive
command -v git >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq git curl ca-certificates; }
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'Number(process.versions.node.split(".")[0])')" -lt 18 ]; then
  echo "▶ Node.js 22 설치"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs
fi

if [ -d "$DIR/.git" ]; then
  echo "▶ 업데이트: $DIR"; git -C "$DIR" pull --ff-only
else
  echo "▶ 설치: $DIR"; git clone --depth 1 "$REPO" "$DIR"
fi

sed -e "s|/opt/halcyon|$DIR|g" -e "s|Environment=PORT=3000|Environment=PORT=$PORT|" "$DIR/deploy/halcyon.service" > /etc/systemd/system/halcyon.service
systemctl daemon-reload
systemctl enable --now halcyon
systemctl restart halcyon
sleep 1
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo
echo "✅ HALCYON 실행 중"
echo "   관리자:  http://${IP:-<서버IP>}:$PORT/admin   (처음 접속 시 관리자 계정 생성)"
echo "   상태:    systemctl status halcyon   /   로그: journalctl -u halcyon -f"
echo "   외부에서 접속하려면 공유기 포트포워딩 또는 Tailscale/WireGuard 를 사용하세요."
