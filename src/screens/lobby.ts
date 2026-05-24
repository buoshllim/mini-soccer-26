import type { GameState, TeamColor, Formation } from '../types'
import { sendLobby, getCurrentRoomId } from '../main'

export function mountLobby(el: HTMLElement, state: GameState) {
  const lobby = state.lobby
  if (!lobby) {
    const code = getCurrentRoomId() ?? '------'
    el.innerHTML = `
      <div style="background:rgba(0,0,0,0.85);padding:40px;border-radius:12px;text-align:center;min-width:320px">
        <div style="font-size:40px;margin-bottom:12px">⚽</div>
        <h2 style="margin-bottom:16px">방 생성됨</h2>
        <p style="color:#888;margin-bottom:20px;font-size:14px">친구에게 코드를 알려주세요</p>
        <div style="font-size:36px;font-weight:bold;letter-spacing:8px;background:#1a1a2e;padding:16px;border-radius:8px;margin-bottom:16px">${code}</div>
        <button id="copy-btn" style="padding:10px 24px;border-radius:8px;background:#374151;color:#fff;border:none;cursor:pointer;font-size:14px">코드 복사</button>
        <p style="margin-top:20px;color:#555;font-size:13px">상대방 접속 대기중...</p>
      </div>`
    el.querySelector('#copy-btn')!.addEventListener('click', () => {
      navigator.clipboard.writeText(code).then(() => {
        const btn = el.querySelector<HTMLButtonElement>('#copy-btn')!
        btn.textContent = '복사됨 ✓'
        setTimeout(() => { btn.textContent = '코드 복사' }, 2000)
      })
    })
    return
  }

  el.innerHTML = `
    <div style="background:rgba(0,0,0,0.85);padding:32px;border-radius:12px;min-width:360px;max-width:480px">
      <h2 style="text-align:center;margin-bottom:20px">로비</h2>

      <div style="margin-bottom:16px">
        <div style="font-size:12px;color:#888;margin-bottom:8px">팀 색상</div>
        <div id="color-btns" style="display:flex;gap:8px">
          ${(['blue','red','green','yellow'] as TeamColor[]).map(c =>
            `<button data-color="${c}" style="flex:1;height:40px;border-radius:6px;border:2px solid transparent;
             background:${{blue:'#3b82f6',red:'#ef4444',green:'#16a34a',yellow:'#eab308'}[c]};
             cursor:pointer;opacity:${lobby.away?.color === c || lobby.home?.color === c ? '0.3' : '1'}">${c}</button>`
          ).join('')}
        </div>
      </div>

      <div style="margin-bottom:16px">
        <div style="font-size:12px;color:#888;margin-bottom:8px">등번호</div>
        <input id="jersey-input" type="number" min="1" max="99" value="10"
          style="width:80px;padding:8px;font-size:18px;border-radius:6px;border:1px solid #444;background:#222;color:#fff"/>
      </div>

      <div style="margin-bottom:20px">
        <div style="font-size:12px;color:#888;margin-bottom:8px">포메이션 (4개 선택)</div>
        <div id="formation-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;max-width:200px;margin:0 auto">
          ${[0,1,2,3,4,5,6,7,8].map(i => {
            const rowLabel = ['FWD','FWD','FWD','MID','MID','MID','DEF','DEF','DEF'][i]
            return `<button data-slot="${i}" style="height:44px;border-radius:8px;border:2px solid #444;
              background:#1a1a2e;color:#888;font-size:11px;cursor:pointer">${rowLabel}</button>`
          }).join('')}
        </div>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center">
        <span id="opponent-status" style="font-size:13px;color:#888">상대 대기중...</span>
        <button id="ready-btn" disabled
          style="padding:10px 24px;border-radius:8px;background:#6366f1;color:#fff;border:none;cursor:pointer;opacity:0.5">
          Ready
        </button>
      </div>
    </div>
  `

  let selectedColor: TeamColor | null = null
  let selectedSlots: number[] = []
  let jerseyNumber = 10

  const colorBtns = el.querySelectorAll<HTMLButtonElement>('[data-color]')
  const slotBtns = el.querySelectorAll<HTMLButtonElement>('[data-slot]')
  const jerseyInput = el.querySelector<HTMLInputElement>('#jersey-input')!
  const readyBtn = el.querySelector<HTMLButtonElement>('#ready-btn')!

  jerseyInput.addEventListener('change', () => {
    jerseyNumber = Math.max(1, Math.min(99, parseInt(jerseyInput.value) || 10))
    jerseyInput.value = String(jerseyNumber)
    sendLobby({ jerseyNumber })
  })

  colorBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const color = btn.dataset.color as TeamColor
      selectedColor = color
      colorBtns.forEach(b => (b.style.border = '2px solid transparent'))
      btn.style.border = '2px solid #fff'
      sendLobby({ color })
      checkReady()
    })
  })

  slotBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const slot = parseInt(btn.dataset.slot!)
      if (selectedSlots.includes(slot)) {
        selectedSlots = selectedSlots.filter(s => s !== slot)
        btn.style.background = '#1a1a2e'
        btn.style.color = '#888'
      } else if (selectedSlots.length < 4) {
        selectedSlots.push(slot)
        btn.style.background = '#3b82f6'
        btn.style.color = '#fff'
      }
      if (selectedSlots.length === 4) {
        sendLobby({ formation: { slots: selectedSlots as [number, number, number, number] } })
      }
      checkReady()
    })
  })

  readyBtn.addEventListener('click', () => {
    sendLobby({ ready: true })
    readyBtn.disabled = true
    readyBtn.textContent = 'Waiting...'
  })

  function checkReady() {
    const ok = selectedColor !== null && selectedSlots.length === 4
    readyBtn.disabled = !ok
    readyBtn.style.opacity = ok ? '1' : '0.5'
  }

  // Show countdown overlay
  if (state.phase === 'countdown' && state.countdown) {
    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:80px;font-weight:bold;color:#fff'
    overlay.textContent = String(state.countdown)
    el.appendChild(overlay)
  }
}
