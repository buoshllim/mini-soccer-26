# Chaos Soccer — Game Design Document

**Version:** 1.0 (2026-05-24)

---

## Concept

FC 시뮬레이터가 아닌 코미디 아케이드 축구. 공이 어디로 튈지 모르고, 선수들이 부딪혀 넘어지고, 엉망진창이지만 웃기는 게임.

---

## Teams & Roles

- **4v4** — 팀당 4명 (GK 포함)
- 각 팀: `GK` 1 + `DF` 1 + `MF` 1 + `FW` 1
- **GK**: 자동 AI, 플레이어가 직접 조작하지 않음
- **DF / MF / FW**: AI가 포지션 규칙을 따르되, 공이 달라붙으면 해당 선수가 자동으로 조작 선수로 전환됨

### Starting Positions (game coords, 0–100 x, 0–60 y)

| ID       | Team | Role | X  | Y  |
|----------|------|------|----|----|
| home-gk  | home | gk   | 4  | 30 |
| home-df  | home | df   | 18 | 30 |
| home-mf  | home | mf   | 35 | 30 |
| home-fw  | home | fw   | 48 | 30 |
| away-gk  | away | gk   | 96 | 30 |
| away-df  | away | df   | 82 | 30 |
| away-mf  | away | mf   | 65 | 30 |
| away-fw  | away | fw   | 52 | 30 |

---

## Ball Physics

- **2D only** — z축 없음. 공은 지면에 항상 붙어있음
- **Friction**: 속도 × 0.86 / tick → 자연스럽게 느려짐
- **Wall bounce**: 사이드라인 반사계수 0.82, 약간 에너지 손실
- **Goal opening**: 좌우 골라인에서 골폭(y: 24–36) 범위만 통과

### Dribble-attach (핵심 메카닉)
- 공 속도 < 4 units/sec이면 가장 가까운 비GK 선수에게 자동 부착
- 부착 시 해당 선수가 `isControlled = true`로 자동 전환
- 부착 상태에서 공은 선수 facing 방향 1.0 unit 앞에 위치

### Kick
- `Space` 누르고 뗄 때 kickPower 계산 (최대 1200ms = 풀파워)
- 속도: `14 + (42 - 14) * power` = 14~42 units/sec
- 무작위 ±15° 방향 spread → 예측 불가

### Chaotic Deflection
- 빠른 공(speed ≥ 4)이 비소유 선수 반경 내 진입 시 자동 반사
- 반사각 계산 후 ±25° 랜덤 spread 추가 → 엉뚱한 방향으로 튀기 가능

---

## Player Collision

- 두 선수 반경 합(2.4 units) 이내 → 밀어내기
- **Stun trigger**: 상대 속도 > 6 units/sec이면 양쪽 모두 0.55초 스턴
- 스턴 중: 입력 무시, 슬라이딩 감속, 시각적 tilt 표현
- 공을 드리블 중인 선수가 스턴되면 공이 랜덤 방향으로 튕겨남

---

## AI Behavior

| Role | Behavior |
|------|----------|
| FW   | 공 위치로 무조건 추적 |
| MF   | 공을 추적하되 x: 30–70 범위 제한 |
| DF   | 공을 추적하되 자기 진영 하프 제한 |
| GK   | 골라인 Y방향 슬라이딩; 공 14 units 이내 → 돌진; 접촉 시 전방 랜덤 킥 |

AI는 공을 드리블하면 즉시 상대 골대 방향으로 랜덤 킥을 날림.

---

## Controls

### PC
| 입력 | 동작 |
|------|------|
| WASD / 방향키 | 이동 |
| Space (누름 유지) | 킥 파워 충전 |
| Space (뗌) | 킥 발사 |

### Mobile
- 왼쪽: nipplejs 조이스틱
- 오른쪽: ⚽ 버튼 (탭 = 약한 킥, 꾹 = 강슛)

---

## Game Flow

```
lobby → (양쪽 색상 선택 + 준비) → countdown 3 → playing → halftime(5s) → countdown 3 → playing → ended
```

- **전/후반**: 각 3분 (180초)
- **골 이후**: 모든 선수 초기 위치 복귀, 공 센터서클
- **결과 화면**: 점수 / 점유율 / 슈팅 수

---

## Lobby

- 팀 색상 4가지 선택 (blue / red / green / yellow)
- 두 팀이 다른 색 선택 후 준비 → 카운트다운 시작
- 형성, 등번호, 전술 없음

---

## Visual Design

- **GK**: 일반 선수 + 큰 팔 + 초록 장갑으로 구분
- **Stumble**: stunTimer > 0이면 mesh rotation.x tilt + wobble
- **Field**: 잔디 줄무늬, 센터서클, PA박스, 양쪽 골대 + 그물
- **Minimap**: HUD 하단 중앙, 선수 위치 점 표시
- **Goal ceremony**: GOAL! 텍스트 + 팡파레 + 컨페티

---

## Constants

| 상수 | 값 | 설명 |
|------|----|------|
| FIELD.W / H | 100 / 60 | 경기장 크기 (game units) |
| GOAL_WIDTH | 12 | 골 폭 |
| PLAYER_RADIUS | 1.2 | 충돌 판정 반경 |
| BALL_SLOW_SPEED | 4 | 드리블 부착 임계 속도 |
| KICK_MIN / MAX | 14 / 42 | 킥 속도 범위 |
| STUN_DURATION | 0.55s | 스턴 지속 시간 |
| STUN_SPEED_THRESHOLD | 6 | 스턴 유발 상대속도 |
| TICK_MS | 50 | 서버 틱 (20 ticks/sec) |
| FRICTION | 0.86 | 공 마찰계수 / tick |

---

## Tech Stack

- **Frontend**: TypeScript + Vite + Three.js + nipplejs
- **Backend**: PartyKit (Cloudflare Workers Durable Objects)
- **Transport**: WebSocket (PartySocket, auto-reconnect)
- **Deploy**: GitHub Pages (client) + PartyKit Cloud (server)
