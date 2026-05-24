import type { GameState } from '../types'
import { joinRoom, goHome } from '../main'

let currentRoomId: string | null = null

export function setResultRoomId(id: string) {
  currentRoomId = id
}

export function mountResult(el: HTMLElement, state: GameState) {
  const { score, stats } = state
  const winner = score.home > score.away ? '홈 팀 승리!' : score.away > score.home ? '어웨이 팀 승리!' : '무승부!'

  const homePoss = Math.round((stats.possession.home / (stats.possession.home + stats.possession.away + 1)) * 100)
  const awayPoss = 100 - homePoss

  el.innerHTML = `
    <div style="background:rgba(0,0,0,0.9);padding:40px;border-radius:12px;text-align:center;min-width:340px">
      <h2 style="font-size:24px;margin-bottom:8px">${winner}</h2>
      <div style="font-size:56px;font-weight:bold;margin:16px 0">${score.home} : ${score.away}</div>

      <div style="background:#1a1a2e;border-radius:8px;padding:16px;margin:16px 0;text-align:left;font-size:14px">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px">
          <span>점유율</span><span>${homePoss}% / ${awayPoss}%</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:8px">
          <span>슈팅</span><span>${stats.shots.home} / ${stats.shots.away}</span>
        </div>
        <div style="display:flex;justify-content:space-between">
          <span>슈팅</span><span>${stats.shots.home} / ${stats.shots.away}</span>
        </div>
      </div>

      <button id="btn-rematch" style="display:block;width:100%;padding:12px;margin-bottom:10px;
        border-radius:8px;background:#6366f1;color:#fff;border:none;font-size:16px;cursor:pointer">
        재경기
      </button>
      <button id="btn-lobby" style="display:block;width:100%;padding:12px;
        border-radius:8px;background:#374151;color:#fff;border:none;font-size:16px;cursor:pointer">
        로비로 돌아가기
      </button>
    </div>
  `

  el.querySelector('#btn-rematch')!.addEventListener('click', () => {
    if (currentRoomId) joinRoom(currentRoomId)
  })
  el.querySelector('#btn-lobby')!.addEventListener('click', () => {
    goHome()
  })
}
