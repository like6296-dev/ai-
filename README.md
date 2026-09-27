# HALCYON — 홈 서버 콘솔

외부 의존성 없이 **Node.js 18+** 만으로 동작하는 올인원 홈 서버 관리 콘솔입니다.
점검 모드, 게임(Roblox 등) 연동, WireGuard VPN, 가상 저장소, 가상 머신, 예약 작업, 백업, 네트워크 도구, 실시간 모니터링을 한 화면에서 관리합니다.

```bash
git clone <이 저장소>
cd ai-
npm start            # http://localhost:3000
```

브라우저에서 `http://서버주소:3000/admin` 으로 접속해 **관리자 계정을 만들면** 끝입니다. 데이터는 `./data` 폴더(JSON + 파일)에 저장됩니다.

| 경로 | 설명 |
|---|---|
| `/` | 공개 페이지 (사이트 상태 · 공지 · 게임 접속자 수) — 점검 중이면 503 점검 페이지 |
| `/admin` | HALCYON 관리자 콘솔 (첫 화면: HALCYON-01 장치 콘솔) |
| `/maintenance?preview=1` | 점검 페이지 미리보기 |
| `/s/<token>` | 가상 저장소 공유 링크 |
| `/api/game/*` | 게임 스크립트용 API (게임 API 키 인증) |
| `/api/admin/*` | 관리자 API (세션 쿠키 또는 `Authorization: Bearer <토큰>`) |

## 기능

### 🛰️ HALCYON-01 장치 콘솔 (기본 화면)
- 서울 랙의 **HALCYON-01** 한 대를 살아 있는 장치처럼 보여줍니다. CPU·메모리·네트워크가 실시간으로 움직이고, 앞면 **베이 LED 가 부하에 맞춰 깜빡이며**, OLED 패널에 IP·업타임·부하가 표시됩니다
- **서비스**: Caddy, PostgreSQL, Redis, Immich, Home Assistant, Samba, Docker, SSH 를 켜고 끄고 재시작. `systemctl`/`docker` 가 있고 해당 unit·컨테이너가 존재하면 **실제로 제어**하고, 없으면 시뮬레이션으로 동작 (서비스 추가·편집 가능)
- **저장소**: 실제 디스크 사용량 + 가상 볼륨(NAS 등). 임계값(기본 90%)을 넘으면 `/data 92%` 처럼 경고 알림 생성
- **네트워크 · 방화벽**: 방화벽 토글과 규칙 관리. `ufw` 가 있으면 실제 적용, 없으면 시뮬레이션
- **전원 버튼**: 재부팅을 누르면 BMC 시퀀스(서비스 정지 → 전원 차단 → POST → UEFI → 커널 → 서비스 시작)가 OLED 에 흐르고 다시 올라옵니다. 체크박스로 **실제 OS 재부팅**도 가능
- **알림**: 볼륨 경고·서비스 실패·점검 모드·재부팅 완료 등. "확인"을 누르면 **서버에 저장**되어 새로고침·다른 기기에서도 확인 상태가 유지됩니다
- **명령줄**: `status`, `restart redis`, `df`, `top`, `fw off`, `alerts`, `ack all`, `reboot`, `maint on 30`, `vm list`, `ping`, `port`, `sh <명령>`, `help` 등. ↑↓ 로 기록 탐색

### 🔧 점검 모드
- 스위치 하나로 ON/OFF. 켜면 공개 페이지·공유 링크가 **HTTP 503 + 점검 페이지**(`Retry-After` 포함)로 응답
- 제목/메시지/예상 종료 시각 설정 → 종료 시각 도달 시 **자동 종료**, 점검 페이지에 카운트다운 표시
- 관리자 세션, 허용 IP, 우회 키(`/?bypass=키`)는 점검 중에도 정상 페이지 표시
- **점검 예약**: 시작 시각 + 소요 시간을 넣으면 시작/종료 예약 작업 2개 자동 생성
- 게임 API 응답에 점검 상태 포함 → 게임 스크립트가 안내 표시/접속 차단(kick) 가능
- 시작/종료 시 Discord 웹훅 알림

### 🎮 게임 연동
- 게임별 API 키 발급, 접속자/서버 실시간 집계(하트비트), 브로드캐스트(게임 내 공지 푸시), 게임 로그 수집
- **라이선스 키 시스템**: 대량 생성, 유효기간, 사용 기기 수 제한, HWID 바인딩/초기화, 비활성화, CSV 내보내기
- 관리자 콘솔 → 게임 → "연동 코드" 탭에 바로 붙여 쓸 수 있는 **Roblox Luau 예제** 제공

```lua
-- 최소 예시 (실행기 환경: request / game:HttpGet 지원 시)
local HUB, KEY = "https://hub.example.com", "gk_..."
local r = request({ Url = HUB .. "/api/game/key/validate", Method = "POST",
  Headers = { ["Content-Type"] = "application/json", ["X-Game-Key"] = KEY },
  Body = game:GetService("HttpService"):JSONEncode({ key = "RIV-XXXX-XXXX-XXXX", hwid = gethwid and gethwid() or "" }) })
local res = game:GetService("HttpService"):JSONDecode(r.Body)
if not res.valid then return warn(res.message) end
```

| 메서드 | 경로 | 본문 / 응답 |
|---|---|---|
| GET | `/api/game/status` | 점검 상태, 버전, 스크립트 URL, 공지 5개, 접속자 수 |
| POST | `/api/game/heartbeat` | `{serverId, players, maxPlayers, placeId, playerNames[], since}` → `{online, kick, broadcasts[], maintenance}` |
| POST | `/api/game/key/validate` | `{key, hwid}` → `{valid, reason, message, expires}` (reason: invalid/disabled/expired/hwid_mismatch/max_uses/maintenance) |
| POST | `/api/game/log` | `{level, message, player, serverId}` |
| GET | `/api/game/broadcasts?since=` | 브로드캐스트 목록 |

인증: 헤더 `X-Game-Key: gk_...` (또는 `?key=`). 하트비트가 90초 이상 끊긴 서버는 목록에서 사라집니다.

### 🛡️ VPN (WireGuard)
- 서버 키 자동 생성(X25519), 피어 추가 시 **개인키/사전공유키/IP 자동 할당**, 클라이언트 `.conf` 다운로드/복사
- 서버 설정(`data/vpn/wg0.conf`) 자동 생성, NAT/포워딩 iptables 규칙 옵션
- 서버에 `wireguard-tools` 가 설치돼 있으면 **적용(wg-quick up)** 버튼으로 바로 올리고 핸드셰이크/트래픽을 표시. 없으면 설정 파일만 생성

### 💾 가상 저장소
- 폴더 탐색, 드래그&드롭 업로드(진행률), 다운로드(폴더는 tar.gz), 이름 변경/이동, 삭제, 텍스트 파일 편집
- 용량 할당량, 만료 시간이 있는 **공개 공유 링크** `/s/<token>` (다운로드 횟수 집계, 점검 중 차단)

### 🖥️ 가상 머신
- 백엔드 자동 감지: **QEMU/KVM**(완전 가상화, qcow2 디스크 + ISO 부팅 + VNC), **Docker**(경량 컨테이너, 포트 매핑, 명령 실행 콘솔, 로그/리소스 통계), **시뮬레이션**(테스트용)
- 생성/시작/정지/재시작/삭제, 리소스 편집, 예약 작업으로 자동 시작/정지
- QEMU 용 ISO 는 `data/isos/` 에 넣으면 목록에 나타납니다

### ⏰ 예약 작업
- 스케줄: **cron**(5필드, 프리셋 제공) / **1회 실행** / **N분 간격**
- 동작: 점검 켜기·끄기, 셸 명령, Discord 알림, 백업, VM 시작·정지, VPN 적용, 공지 등록, 게임 브로드캐스트
- 마지막 실행 결과/출력 확인, "지금 실행"

### 그 외
- **대시보드**: CPU/메모리/네트워크 스파크라인, 디스크, 업타임, 최근 활동
- **공지사항**: 공개 페이지 + 게임 API 에 노출, 상단 고정
- **네트워크 도구**: ping, TCP 포트 확인, DNS 조회, HTTP 상태 확인, 공인 IP, 인터페이스, 열린 포트
- **프로세스**: 상위 프로세스 목록, 종료 신호 전송
- **백업**: 설정/저장소/VPN/게임 데이터 tar.gz 생성·다운로드·복원 (VM 디스크·ISO 제외)
- **로그**: 모든 관리 행위·게임 인증 실패·작업 실행 기록, 유형/수준/검색 필터
- **설정**: 사이트 이름, Discord 웹훅, 비밀번호 변경, API 토큰, 리버스 프록시 신뢰

## 배포

```bash
# 환경 변수
PORT=3000 HOST=0.0.0.0 DATA_DIR=./data node server.js

# systemd (deploy/halcyon.service 참고)
sudo cp -r . /opt/halcyon && sudo cp deploy/halcyon.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now halcyon

# Docker
docker compose up -d
```

HTTPS 는 nginx/caddy 리버스 프록시를 앞에 두는 것을 권장합니다 (`deploy/nginx.conf` 예시). 프록시 뒤에서는 설정에서 **"리버스 프록시 뒤에서 실행"** 을 켜야 접속 IP 가 올바르게 기록됩니다.

권한별 필요 사항:
- VPN 실제 적용(wg-quick), QEMU KVM 가속, 프로세스 종료 → root 또는 해당 권한
- Docker 백엔드 → `docker` 명령 + 데몬 접근 권한
- 셸 명령 예약 작업은 서버 프로세스 권한으로 실행되므로 관리자 계정을 안전하게 관리하세요

## 보안
- 비밀번호 scrypt 해시, HttpOnly + SameSite=Lax 세션 쿠키, 로그인 5회 실패 시 5분 잠금
- 교차 사이트 변경 요청 차단(`Sec-Fetch-Site`), 경로 탐색 방지, 업로드 할당량
- 모든 관리 행위 감사 로그

## 프로젝트 구조

```
server.js          HTTP 서버 · 라우팅 · 점검 게이트
lib/               device(장치 콘솔), auth, monitor, storage, vpn, vm, games, scheduler(cron), backup, nettools, notify
public/site.html   공개 페이지
public/maintenance.html  점검 페이지
public/admin/      HALCYON 관리자 SPA (index.html, app.js, style.css)
deploy/            systemd · nginx 예시
data/              런타임 데이터 (git 제외)
```

개발: `npm run dev` (파일 변경 시 자동 재시작), `npm run check` (문법 검사)
