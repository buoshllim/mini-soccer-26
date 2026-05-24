import type { GameState, TeamColor } from '../types'
import { goHome } from '../main'

export function setResultRoomId(_id: string) { /* no-op: rematch removed */ }

export function mountResult(el: HTMLElement, state: GameState) {
  const { score, stats } = state

  const colorHex: Record<TeamColor, string> = {
    blue: '#3b82f6', red: '#ef4444', green: '#16a34a', yellow: '#eab308',
  }

  const homeUsername = (state.lobby?.home as any)?.username || 'Home'
  const awayUsername = (state.lobby?.away as any)?.username || 'Away'
  const homeColor = colorHex[(state.lobby?.home?.color ?? 'blue') as TeamColor]
  const awayColor = colorHex[(state.lobby?.away?.color ?? 'red') as TeamColor]

  let winnerLabel = ''
  let winnerUsername = ''
  let winnerColor = ''

  if (score.home > score.away) {
    winnerLabel = '홈 팀 승리!'
    winnerUsername = homeUsername
    winnerColor = homeColor
  } else if (score.away > score.home) {
    winnerLabel = '어웨이 팀 승리!'
    winnerUsername = awayUsername
    winnerColor = awayColor
  } else {
    winnerLabel = '무승부!'
  }

  const homePoss = Math.round((stats.possession.home / (stats.possession.home + stats.possession.away + 1)) * 100)
  const awayPoss = 100 - homePoss

  el.innerHTML = `
    <div style="background:rgba(0,0,0,0.9);padding:clamp(20px,5vw,40px);border-radius:12px;
      text-align:center;width:min(360px,90vw);box-sizing:border-box">

      <h2 style="font-size:clamp(18px,4vw,24px);margin-bottom:6px">${winnerLabel}</h2>

      ${winnerUsername ? `
        <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:10px">
          <div style="width:14px;height:14px;border-radius:50%;background:${winnerColor};flex-shrink:0"></div>
          <span style="font-size:clamp(15px,4vw,18px);font-weight:bold;color:${winnerColor}">${winnerUsername}</span>
        </div>
      ` : '<div style="margin-bottom:10px"></div>'}

      <div style="font-size:clamp(40px,10vw,56px);font-weight:bold;margin:8px 0">${score.home} : ${score.away}</div>

      <div style="background:#1a1a2e;border-radius:8px;padding:clamp(10px,3vw,16px);
        margin:12px 0;font-size:clamp(12px,3vw,14px)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div style="display:flex;align-items:center;gap:6px">
            <div style="width:10px;height:10px;border-radius:50%;background:${homeColor}"></div>
            <span>${homeUsername}</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            <span>${awayUsername}</span>
            <div style="width:10px;height:10px;border-radius:50%;background:${awayColor}"></div>
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:6px">
          <span style="color:#888">점유율</span><span>${homePoss}% / ${awayPoss}%</span>
        </div>
        <div style="display:flex;justify-content:space-between">
          <span style="color:#888">슈팅</span><span>${stats.shots.home} / ${stats.shots.away}</span>
        </div>
      </div>

      <button id="btn-lobby" style="display:block;width:100%;padding:12px;
        border-radius:8px;background:#374151;color:#fff;border:none;
        font-size:clamp(14px,3.5vw,16px);cursor:pointer;font-weight:bold">
        처음으로
      </button>
    </div>
  `

  el.querySelector('#btn-lobby')!.addEventListener('click', () => goHome())
}
