import type { GameState } from '../types'

export function mountResult(el: HTMLElement, state: GameState) {
  const { score } = state
  el.innerHTML = `
    <div style="background:rgba(0,0,0,0.85);padding:32px;border-radius:12px;text-align:center">
      <h2>게임 종료</h2>
      <div style="font-size:48px;font-weight:bold;margin:16px 0">${score.home} : ${score.away}</div>
    </div>`
}
