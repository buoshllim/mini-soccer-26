import type { GameState, TeamColor } from '../types'
import { sendLobby, getCurrentRoomId, getMyTeam } from '../main'

let _color: TeamColor | null = null
let _slots: number[] = []
let _jerseys: number[] = []
let _gkJersey = rnd()

export function resetLobbyLocalState() {
  _color = null
  _slots = []
  _jerseys = []
  _gkJersey = rnd()
}

function rnd() { return Math.floor(Math.random() * 99) + 1 }

function buildJerseyNumbers(): [number, number, number, number, number] {
  const j = [..._jerseys]
  while (j.length < 4) j.push(rnd())
  return [_gkJersey, j[0], j[1], j[2], j[3]]
}

const ROW_LABELS = ['FWD', 'FWD', 'FWD', 'MID', 'MID', 'MID', 'DEF', 'DEF', 'DEF']
const COLOR_BG: Record<TeamColor, string> = {
  blue: '#3b82f6', red: '#ef4444', green: '#16a34a', yellow: '#eab308',
}
const COLORS: TeamColor[] = ['blue', 'red', 'green', 'yellow']

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

  const myTeam = getMyTeam()
  const oppTeam = myTeam === 'home' ? 'away' : 'home'
  const myLobby = myTeam ? lobby[myTeam] : null
  const oppLobby = myTeam ? lobby[oppTeam] : null

  el.innerHTML = `
    <div style="background:rgba(0,0,0,0.85);padding:24px 28px;border-radius:12px;min-width:360px;max-width:500px">
      <h2 style="text-align:center;margin-bottom:16px">로비</h2>

      <div style="margin-bottom:14px">
        <div style="font-size:12px;color:#888;margin-bottom:6px">팀 색상</div>
        <div id="color-btns" style="display:flex;gap:8px">
          ${COLORS.map(c => `
            <button data-color="${c}" style="flex:1;height:36px;border-radius:6px;
              border:2px solid ${_color === c ? '#fff' : 'transparent'};
              background:${COLOR_BG[c]};cursor:pointer;font-size:12px;font-weight:bold;
              opacity:${oppLobby?.color === c ? '0.25' : '1'}">
              ${c[0].toUpperCase() + c.slice(1)}
            </button>`).join('')}
        </div>
      </div>

      <div style="display:flex;gap:14px;margin-bottom:16px;align-items:flex-start">
        <div style="flex:1">
          <div style="font-size:12px;color:#888;margin-bottom:6px">포메이션 (4개 선택)</div>
          <div id="formation-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px"></div>
        </div>
        <div id="jersey-list" style="min-width:130px">
          <div style="font-size:12px;color:#888;margin-bottom:6px">등번호</div>
        </div>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center">
        <span id="opponent-status" style="font-size:13px;color:#888">상대방 대기중...</span>
        <button id="ready-btn" disabled
          style="padding:10px 24px;border-radius:8px;background:#6366f1;color:#fff;border:none;cursor:pointer;opacity:0.5;font-size:14px">
          Ready
        </button>
      </div>
    </div>`

  function renderFormationGrid() {
    const gridEl = el.querySelector<HTMLDivElement>('#formation-grid')!
    gridEl.innerHTML = Array.from({ length: 9 }, (_, i) => {
      const idx = _slots.indexOf(i)
      const sel = idx >= 0
      return `<button data-slot="${i}" style="height:40px;border-radius:6px;
        border:2px solid ${sel ? '#3b82f6' : '#444'};
        background:${sel ? '#1e3a5f' : '#1a1a2e'};
        color:${sel ? '#93c5fd' : '#888'};font-size:11px;cursor:pointer;line-height:1.2">
        ${sel ? `<b style="color:#60a5fa">${idx + 1}</b><br>` : ''}${ROW_LABELS[i]}
      </button>`
    }).join('')

    gridEl.querySelectorAll<HTMLButtonElement>('[data-slot]').forEach(btn => {
      btn.addEventListener('click', () => {
        const slot = parseInt(btn.dataset.slot!)
        const idx = _slots.indexOf(slot)
        if (idx >= 0) {
          _slots.splice(idx, 1)
          _jerseys.splice(idx, 1)
        } else if (_slots.length < 4) {
          _slots.push(slot)
          _jerseys.push(rnd())
        }
        if (_slots.length === 4) {
          sendLobby({
            formation: { slots: _slots as [number, number, number, number] },
            jerseyNumbers: buildJerseyNumbers(),
          })
        }
        checkReady()
        renderFormationGrid()
        renderJerseyList()
      })
    })
  }

  function renderJerseyList() {
    const listEl = el.querySelector<HTMLDivElement>('#jersey-list')!
    listEl.innerHTML = `
      <div style="font-size:12px;color:#888;margin-bottom:6px">등번호</div>
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px">
        <span style="font-size:11px;color:#aaa;width:36px">GK</span>
        <input data-gk type="number" min="1" max="99" value="${_gkJersey}"
          style="width:52px;padding:3px 6px;border-radius:4px;border:1px solid #444;background:#222;color:#fff;font-size:13px"/>
      </div>
      ${_slots.map((slot, i) => `
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px">
          <span style="font-size:11px;color:#aaa;width:36px">${ROW_LABELS[slot]}</span>
          <input data-jidx="${i}" type="number" min="1" max="99" value="${_jerseys[i]}"
            style="width:52px;padding:3px 6px;border-radius:4px;border:1px solid #444;background:#222;color:#fff;font-size:13px"/>
        </div>`).join('')}`

    listEl.querySelector<HTMLInputElement>('[data-gk]')!.addEventListener('change', e => {
      const v = Math.max(1, Math.min(99, parseInt((e.target as HTMLInputElement).value) || rnd()))
      ;(e.target as HTMLInputElement).value = String(v)
      _gkJersey = v
      if (_slots.length === 4) sendLobby({ jerseyNumbers: buildJerseyNumbers() })
    })

    listEl.querySelectorAll<HTMLInputElement>('[data-jidx]').forEach(input => {
      input.addEventListener('change', () => {
        const i = parseInt(input.dataset.jidx!)
        const v = Math.max(1, Math.min(99, parseInt(input.value) || rnd()))
        input.value = String(v)
        _jerseys[i] = v
        if (_slots.length === 4) sendLobby({ jerseyNumbers: buildJerseyNumbers() })
      })
    })
  }

  function checkReady() {
    const btn = el.querySelector<HTMLButtonElement>('#ready-btn')!
    const ok = _color !== null && _slots.length === 4
    if (!myLobby?.ready) {
      btn.disabled = !ok
      btn.style.opacity = ok ? '1' : '0.5'
    }
  }

  // Color buttons
  el.querySelectorAll<HTMLButtonElement>('[data-color]').forEach(btn => {
    btn.addEventListener('click', () => {
      const color = btn.dataset.color as TeamColor
      if (oppLobby?.color === color) return
      _color = color
      el.querySelectorAll<HTMLButtonElement>('[data-color]').forEach(b => {
        b.style.border = `2px solid ${b.dataset.color === color ? '#fff' : 'transparent'}`
      })
      sendLobby({ color })
      checkReady()
    })
  })

  // Ready button
  el.querySelector<HTMLButtonElement>('#ready-btn')!.addEventListener('click', () => {
    sendLobby({ ready: true })
    const btn = el.querySelector<HTMLButtonElement>('#ready-btn')!
    btn.disabled = true
    btn.textContent = 'Waiting...'
  })

  // Opponent status
  const statusEl = el.querySelector<HTMLSpanElement>('#opponent-status')!
  if (oppLobby?.ready) {
    statusEl.textContent = '상대방 준비 완료 ✓'
    statusEl.style.color = '#22c55e'
  }

  // Restore ready button if already submitted
  if (myLobby?.ready) {
    const btn = el.querySelector<HTMLButtonElement>('#ready-btn')!
    btn.disabled = true
    btn.textContent = 'Waiting...'
    btn.style.opacity = '1'
  }

  renderFormationGrid()
  renderJerseyList()
  checkReady()

  if (state.phase === 'countdown' && state.countdown) {
    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:80px;font-weight:bold;color:#fff'
    overlay.textContent = String(state.countdown)
    el.appendChild(overlay)
  }
}
