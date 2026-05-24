import type { GameState } from '../types'

export function mountLobby(el: HTMLElement, state: GameState) {
  el.innerHTML = `
    <div style="background:rgba(0,0,0,0.85);padding:32px;border-radius:12px;text-align:center">
      <h2>로비 준비 중...</h2>
      <p style="color:#888;margin-top:8px">Phase: ${state.phase}</p>
      ${state.countdown !== undefined ? `<div style="font-size:72px;font-weight:bold">${state.countdown}</div>` : ''}
    </div>`
}
