import type { GameState, TeamColor } from '../types'
import { sendLobby } from '../main'

let _color: TeamColor | null = null

export function resetLobbyLocalState(): void {
  _color = null
}

export function mountLobby(el: HTMLElement, state?: GameState): void {
  const myTeam = (window as any).__myTeam as 'home' | 'away' | null ?? null
  const lobby = state?.lobby
  const mySlot = myTeam && lobby ? lobby[myTeam] : null
  const oppTeam = myTeam === 'home' ? 'away' : 'home'
  const oppSlot = myTeam && lobby ? lobby[oppTeam] : null

  const colors: TeamColor[] = ['blue', 'red', 'green', 'yellow']
  const colorHex: Record<TeamColor, string> = {
    blue: '#3b82f6', red: '#ef4444', green: '#16a34a', yellow: '#eab308',
  }

  if (!_color && mySlot?.color) _color = mySlot.color

  const phase = state?.phase ?? 'lobby'
  const countdown = state?.countdown

  el.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:24px;padding:32px;max-width:380px;margin:auto">
      <h1 style="font-size:28px;font-weight:900;letter-spacing:3px;color:#fff;margin:0">⚽ CHAOS SOCCER</h1>

      ${phase === 'countdown' ? `
        <div style="font-size:80px;font-weight:900;color:#ffd700;text-shadow:0 0 30px #ff8800">${countdown}</div>
      ` : ''}

      ${phase === 'lobby' && myTeam ? `
        <div style="background:rgba(255,255,255,0.08);border-radius:12px;padding:20px;width:100%;box-sizing:border-box">
          <p style="margin:0 0 12px;font-size:13px;color:#aaa;text-align:center">팀 색상 선택</p>
          <div style="display:flex;gap:10px;justify-content:center">
            ${colors.map(c => `
              <button data-color="${c}" style="
                width:48px;height:48px;border-radius:50%;background:${colorHex[c]};
                border:${_color === c ? '3px solid #fff' : '3px solid transparent'};
                cursor:pointer;transition:border 0.1s;
              "></button>
            `).join('')}
          </div>
        </div>

        <div style="width:100%;display:flex;align-items:center;justify-content:space-between">
          <div style="font-size:13px;color:${oppSlot?.ready ? '#4ade80' : '#888'}">
            상대방: ${oppSlot?.ready ? '✅ 준비됨' : '⏳ 대기중'}
          </div>
          <button id="ready-btn" style="
            padding:12px 28px;border-radius:8px;font-size:16px;font-weight:bold;cursor:pointer;
            background:${mySlot?.ready ? '#4ade80' : '#3b82f6'};color:#fff;border:none;
          ">${mySlot?.ready ? '취소' : '준비!'}</button>
        </div>
      ` : ''}

      ${!myTeam && phase === 'lobby' ? `
        <p style="color:#888;font-size:14px">대기 중... (방이 가득 찼습니다)</p>
      ` : ''}

      ${!lobby && phase === 'lobby' ? `
        <p style="color:#666;font-size:14px">상대 플레이어 기다리는 중...</p>
      ` : ''}
    </div>
  `

  el.querySelectorAll('[data-color]').forEach(btn => {
    btn.addEventListener('click', () => {
      _color = (btn as HTMLElement).dataset.color as TeamColor
      sendLobby({ color: _color })
      mountLobby(el, state)
    })
  })

  el.querySelector('#ready-btn')?.addEventListener('click', () => {
    if (!_color) return
    const isReady = !(mySlot?.ready ?? false)
    sendLobby({ color: _color, ready: isReady })
  })
}
