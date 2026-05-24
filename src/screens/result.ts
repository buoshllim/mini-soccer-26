import type { GameState, TeamColor } from '../types'
import { goHome } from '../main'

export function setResultRoomId(_id: string) { /* no-op: rematch removed */ }

export function mountResult(el: HTMLElement, state: GameState) {
  const { score, stats } = state

  const colorHex: Record<TeamColor, string> = {
    blue: '#3b82f6', red: '#ef4444', green: '#16a34a', yellow: '#facc15',
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
    <div style="background:rgba(0,0,0,0.9);padding:clamp(12px,3vw,36px);border-radius:12px;
      text-align:center;width:min(340px,90vw);box-sizing:border-box;
      max-height:90vh;overflow-y:auto">

      <h2 style="font-size:clamp(15px,4vw,24px);margin:0 0 4px">${winnerLabel}</h2>

      ${winnerUsername ? `
        <div style="display:flex;align-items:center;justify-content:center;gap:6px;margin-bottom:6px">
          <div style="width:10px;height:10px;border-radius:50%;background:${winnerColor};flex-shrink:0"></div>
          <span style="font-size:clamp(13px,3.5vw,18px);font-weight:bold;color:${winnerColor}">${winnerUsername}</span>
        </div>
      ` : '<div style="margin-bottom:6px"></div>'}

      <div style="font-size:clamp(32px,8vw,56px);font-weight:bold;margin:4px 0">${score.home} : ${score.away}</div>

      <div style="background:#1a1a2e;border-radius:8px;padding:clamp(6px,2vw,14px);
        margin:8px 0;font-size:clamp(11px,2.8vw,14px)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
          <div style="display:flex;align-items:center;gap:5px">
            <div style="width:8px;height:8px;border-radius:50%;background:${homeColor}"></div>
            <span>${homeUsername}</span>
          </div>
          <div style="display:flex;align-items:center;gap:5px">
            <span>${awayUsername}</span>
            <div style="width:8px;height:8px;border-radius:50%;background:${awayColor}"></div>
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <span style="color:#888">점유율</span><span>${homePoss}% / ${awayPoss}%</span>
        </div>
        <div style="display:flex;justify-content:space-between">
          <span style="color:#888">슈팅</span><span>${stats.shots.home} / ${stats.shots.away}</span>
        </div>
      </div>

      <button id="btn-lobby" style="display:block;width:100%;padding:clamp(8px,2vw,12px);
        border-radius:8px;background:#374151;color:#fff;border:none;
        font-size:clamp(13px,3.5vw,16px);cursor:pointer;font-weight:bold">
        처음으로
      </button>
    </div>
  `

  el.querySelector('#btn-lobby')!.addEventListener('click', () => goHome())
}
