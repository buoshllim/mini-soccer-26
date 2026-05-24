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
    <div style="background:rgba(0,0,0,0.9);padding:clamp(10px,3vw,24px) clamp(12px,4vw,28px);
      border-radius:12px;text-align:center;width:min(320px,90vw);box-sizing:border-box;
      max-height:92vh;overflow-y:auto">

      <div style="display:flex;align-items:center;justify-content:center;gap:7px;margin-bottom:6px">
        ${winnerUsername ? `<div style="width:10px;height:10px;border-radius:50%;background:${winnerColor};flex-shrink:0"></div>` : ''}
        <h2 style="font-size:clamp(14px,4vw,20px);margin:0;color:${winnerColor || '#fff'}">
          ${winnerUsername ? `${winnerUsername} ${winnerLabel}` : winnerLabel}
        </h2>
      </div>

      <div style="font-size:clamp(32px,8vw,52px);font-weight:bold;margin:4px 0">${score.home} : ${score.away}</div>

      <div style="background:#1a1a2e;border-radius:8px;padding:clamp(6px,2vw,12px);
        margin:8px 0;font-size:clamp(11px,2.8vw,13px)">
        <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:3px 6px;align-items:center">
          <div style="display:flex;align-items:center;gap:4px;justify-content:flex-end">
            <span>${homeUsername}</span>
            <div style="width:7px;height:7px;border-radius:50%;background:${homeColor};flex-shrink:0"></div>
          </div>
          <span style="color:#555;font-size:clamp(9px,2.2vw,11px)">팀</span>
          <div style="display:flex;align-items:center;gap:4px">
            <div style="width:7px;height:7px;border-radius:50%;background:${awayColor};flex-shrink:0"></div>
            <span>${awayUsername}</span>
          </div>

          <span style="text-align:right">${homePoss}%</span>
          <span style="color:#555;font-size:clamp(9px,2.2vw,11px)">점유율</span>
          <span style="text-align:left">${awayPoss}%</span>

          <span style="text-align:right">${stats.shots.home}</span>
          <span style="color:#555;font-size:clamp(9px,2.2vw,11px)">슈팅</span>
          <span style="text-align:left">${stats.shots.away}</span>
        </div>
      </div>

      <button id="btn-lobby" style="display:block;width:100%;padding:clamp(7px,2vw,10px);
        border-radius:8px;background:#374151;color:#fff;border:none;
        font-size:clamp(13px,3.5vw,15px);cursor:pointer;font-weight:bold">
        처음으로
      </button>
    </div>
  `

  el.querySelector('#btn-lobby')!.addEventListener('click', () => goHome())
}
