import type { GameState } from '../types'
import { goHome } from '../main'

export function setResultRoomId(_id: string) { /* no-op: rematch removed */ }

export function mountResult(el: HTMLElement, state: GameState) {
  const { score, stats } = state
  const winner = score.home > score.away ? '홈 팀 승리!' : score.away > score.home ? '어웨이 팀 승리!' : '무승부!'

  const homePoss = Math.round((stats.possession.home / (stats.possession.home + stats.possession.away + 1)) * 100)
  const awayPoss = 100 - homePoss

  el.innerHTML = `
    <div style="background:rgba(0,0,0,0.9);padding:clamp(20px,5vw,40px);border-radius:12px;
      text-align:center;width:min(360px,90vw);box-sizing:border-box">
      <h2 style="font-size:clamp(18px,4vw,24px);margin-bottom:8px">${winner}</h2>
      <div style="font-size:clamp(40px,10vw,56px);font-weight:bold;margin:12px 0">${score.home} : ${score.away}</div>

      <div style="background:#1a1a2e;border-radius:8px;padding:clamp(10px,3vw,16px);
        margin:12px 0;text-align:left;font-size:clamp(12px,3vw,14px)">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px">
          <span>점유율</span><span>${homePoss}% / ${awayPoss}%</span>
        </div>
        <div style="display:flex;justify-content:space-between">
          <span>슈팅</span><span>${stats.shots.home} / ${stats.shots.away}</span>
        </div>
      </div>

      <button id="btn-lobby" style="display:block;width:100%;padding:12px;
        border-radius:8px;background:#374151;color:#fff;border:none;
        font-size:clamp(14px,3.5vw,16px);cursor:pointer;font-weight:bold">
        처음으로
      </button>
    </div>
  `

  el.querySelector('#btn-lobby')!.addEventListener('click', () => {
    goHome()
  })
}
