import type { GameState, TeamColor } from '../types'
import { sendLobby, getCurrentRoomId, goHome } from '../main'
import { sound } from '../game/sound'

let _color: TeamColor | null = null
let _username = ''
let _composing = false  // true while IME (Korean/CJK) is composing a character

export function resetLobbyLocalState(): void {
  _color = null
  _username = ''
  _composing = false
}

export function mountLobby(el: HTMLElement, state?: GameState): void {
  const myTeam = (window as any).__myTeam as 'home' | 'away' | null ?? null
  const lobby = state?.lobby
  const mySlot = myTeam && lobby ? lobby[myTeam] : null
  const oppTeam = myTeam === 'home' ? 'away' : 'home'
  const oppSlot = myTeam && lobby ? lobby[oppTeam] : null

  const colors: TeamColor[] = ['blue', 'red', 'green', 'yellow']
  const colorHex: Record<TeamColor, string> = {
    blue: '#3b82f6', red: '#ef4444', green: '#16a34a', yellow: '#facc15',
  }

  if (!_color && mySlot?.color) _color = mySlot.color

  const phase = state?.phase ?? 'lobby'
  const countdown = state?.countdown
  const roomCode = getCurrentRoomId() ?? '------'

  // Waiting for opponent — show room code prominently
  const waitingForOpponent = !lobby && phase === 'lobby'

  // Don't re-render while IME is composing — would destroy the in-progress Korean/CJK character
  if (_composing) return

  // Save username input state so we can restore focus + cursor after re-render
  const prevInput = el.querySelector<HTMLInputElement>('#username-input')
  const hadInputFocus = document.activeElement === prevInput
  const selStart = prevInput?.selectionStart ?? null
  const selEnd = prevInput?.selectionEnd ?? null
  const isFirstRender = !prevInput

  el.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:clamp(12px,2.5vw,20px);
      padding:clamp(16px,4vw,32px);width:min(380px,94vw);margin:auto;box-sizing:border-box">

      ${phase === 'countdown' ? `
        <div style="font-size:80px;font-weight:900;color:#ffd700;text-shadow:0 0 30px #ff8800">${countdown}</div>
      ` : ''}

      ${waitingForOpponent ? `
        <div style="text-align:center">
          <p style="margin:0 0 8px;font-size:13px;color:#888">친구에게 이 코드를 알려주세요</p>
          <div style="font-size:52px;font-weight:900;letter-spacing:10px;color:#fff;
            background:rgba(255,255,255,0.08);padding:16px 24px;border-radius:12px;
            font-family:monospace">${roomCode}</div>
        </div>
        <p style="color:#555;font-size:13px;margin:0">상대방 접속 대기 중...</p>
        <button id="bgm-btn" style="width:100%;padding:10px;border-radius:8px;
          background:rgba(255,255,255,0.07);color:${sound.isBgmEnabled() ? '#ccc' : '#555'};
          border:1px solid ${sound.isBgmEnabled() ? '#555' : '#333'};font-size:13px;cursor:pointer;">
          ${sound.isBgmEnabled() ? '🎵 BGM 켜짐' : '🔇 BGM 꺼짐'}
        </button>
        <button id="leave-btn" style="width:100%;padding:10px;border-radius:8px;
          background:transparent;color:#555;border:1px solid #333;font-size:13px;cursor:pointer;">
          나가기
        </button>
      ` : ''}

      ${phase === 'lobby' && myTeam && lobby ? `
        <div style="background:rgba(255,255,255,0.06);border-radius:12px;padding:18px;width:100%;box-sizing:border-box">
          <p style="margin:0 0 8px;font-size:12px;color:#888">닉네임</p>
          <input id="username-input" type="text" maxlength="12"
            placeholder="이름을 입력하세요"
            value="${_username}"
            autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
            style="width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;
              border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.3);
              color:#fff;font-size:15px;outline:none;" />
        </div>

        <div style="background:rgba(255,255,255,0.06);border-radius:12px;padding:18px;width:100%;box-sizing:border-box">
          <p style="margin:0 0 10px;font-size:12px;color:#888">팀 색상</p>
          <div style="display:flex;gap:10px;justify-content:center">
            ${colors.map(c => {
              const taken = oppSlot?.color === c
              return `
              <button data-color="${c}" ${taken ? 'disabled' : ''} style="
                width:52px;height:52px;border-radius:50%;background:${colorHex[c]};
                border:${_color === c ? '4px solid #fff' : '4px solid transparent'};
                cursor:${taken ? 'not-allowed' : 'pointer'};
                box-shadow:${_color === c ? `0 0 0 2px ${colorHex[c]}` : 'none'};
                opacity:${taken ? '0.25' : '1'};
                transition:border 0.1s;
              "></button>`
            }).join('')}
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

        <button id="leave-btn" style="width:100%;padding:10px;border-radius:8px;
          background:transparent;color:#555;border:1px solid #333;font-size:13px;cursor:pointer;">
          나가기
        </button>
      ` : ''}

      ${!myTeam && phase === 'lobby' ? `
        <p style="color:#888;font-size:14px">방이 가득 찼습니다</p>
      ` : ''}

    </div>
  `

  const usernameInput = el.querySelector<HTMLInputElement>('#username-input')
  if (usernameInput) {
    usernameInput.addEventListener('compositionstart', () => { _composing = true })
    usernameInput.addEventListener('compositionend', () => {
      _composing = false
      _username = usernameInput.value
      ;(window as any).__username = _username
      if (_color) sendLobby({ username: _username })
    })
    usernameInput.addEventListener('input', () => {
      if (_composing) return  // let compositionend handle the final commit
      _username = usernameInput.value
      ;(window as any).__username = _username
      if (_color) sendLobby({ username: _username })
    })

    if (hadInputFocus) {
      // Restore focus + cursor position after re-render (e.g. color click)
      usernameInput.focus()
      if (selStart !== null && selEnd !== null) {
        try { usernameInput.setSelectionRange(selStart, selEnd) } catch { /* ignore */ }
      }
    } else if (isFirstRender) {
      // Auto-focus on first appearance so user can type without clicking
      requestAnimationFrame(() => usernameInput.focus())
    }
  }

  el.querySelectorAll('[data-color]').forEach(btn => {
    btn.addEventListener('click', () => {
      if ((btn as HTMLButtonElement).disabled) return
      _color = (btn as HTMLElement).dataset.color as TeamColor
      sendLobby({ color: _color, username: _username || undefined })
      mountLobby(el, state)
    })
  })

  el.querySelector('#ready-btn')?.addEventListener('click', () => {
    if (!_color) return
    const isReady = !(mySlot?.ready ?? false)
    sendLobby({ color: _color, ready: isReady, username: _username || undefined })
  })

  el.querySelector('#leave-btn')?.addEventListener('click', () => {
    if (confirm('정말 나가시겠습니까?')) goHome()
  })

  el.querySelector('#bgm-btn')?.addEventListener('click', () => {
    const on = sound.toggleLobbyBgm()
    const btn = el.querySelector<HTMLButtonElement>('#bgm-btn')
    if (btn) {
      btn.textContent = on ? '🎵 BGM 켜짐' : '🔇 BGM 꺼짐'
      btn.style.color = on ? '#ccc' : '#555'
      btn.style.borderColor = on ? '#555' : '#333'
    }
  })
}
