import nipplejs from 'nipplejs'
import type { PlayerInput } from '../types'
import { sendInput } from '../main'

let joyDx = 0, joyDy = 0
let kickStart: number | null = null
let pendingKickPower: number | null = null
const keysDown = new Set<string>()
let inputLoopId: ReturnType<typeof setInterval> | null = null
let joystickManager: ReturnType<typeof nipplejs.create> | null = null
let mobileContainer: HTMLElement | null = null

export function initInput(): void {
  if (inputLoopId !== null) return
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  if (isMobile()) setupMobileControls()
  inputLoopId = setInterval(flushInput, 50)
}

export function destroyInput(): void {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  keysDown.clear()
  if (inputLoopId !== null) { clearInterval(inputLoopId); inputLoopId = null }
  if (joystickManager) { joystickManager.destroy(); joystickManager = null }
  if (mobileContainer) { mobileContainer.remove(); mobileContainer = null }
  joyDx = 0; joyDy = 0
  kickStart = null; pendingKickPower = null
}

function isMobile(): boolean {
  return window.innerWidth < 768 || 'ontouchstart' in window
}

function onKeyDown(e: KeyboardEvent): void {
  const k = e.key.toLowerCase()
  keysDown.add(k)
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault()
  if (k === ' ' && kickStart === null) kickStart = Date.now()
}

function onKeyUp(e: KeyboardEvent): void {
  const k = e.key.toLowerCase()
  keysDown.delete(k)
  if (k === ' ' && kickStart !== null) {
    pendingKickPower = Math.min((Date.now() - kickStart) / 1200, 1)
    kickStart = null
  }
}

function getDxDy(): { dx: number; dy: number } {
  if (joyDx !== 0 || joyDy !== 0) return { dx: joyDx, dy: joyDy }
  let dx = 0, dy = 0
  if (keysDown.has('arrowleft') || keysDown.has('a')) dx -= 1
  if (keysDown.has('arrowright') || keysDown.has('d')) dx += 1
  if (keysDown.has('arrowup') || keysDown.has('w')) dy += 1
  if (keysDown.has('arrowdown') || keysDown.has('s')) dy -= 1
  if (dx !== 0 && dy !== 0) {
    const len = Math.sqrt(dx * dx + dy * dy); dx /= len; dy /= len
  }
  return { dx: Math.round(dx * 100) / 100, dy: Math.round(dy * 100) / 100 }
}

function flushInput(): void {
  const { dx, dy } = getDxDy()
  let kickPower = 0
  if (pendingKickPower !== null) {
    kickPower = pendingKickPower
    pendingKickPower = null
  }
  sendInput({ dx, dy, kickPower })
}

function setupMobileControls(): void {
  mobileContainer = document.createElement('div')
  mobileContainer.id = 'mobile-controls'
  mobileContainer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:50;user-select:none;-webkit-user-select:none;'
  document.body.appendChild(mobileContainer)

  const BTN = 132  // 버튼 크기 (킥버튼 기준)
  const MARGIN = 24

  const joyZone = document.createElement('div')
  joyZone.style.cssText = `position:absolute;left:${MARGIN}px;bottom:${MARGIN}px;width:${BTN}px;height:${BTN}px;pointer-events:all;`
  mobileContainer.appendChild(joyZone)

  joystickManager = nipplejs.create({
    zone: joyZone, mode: 'static',
    position: { left: `${BTN / 2}px`, bottom: `${BTN / 2}px` },
    color: 'rgba(255,255,255,0.3)', size: BTN * 0.85,
  })
  joystickManager.on('move', (evt) => {
    const v = (evt as any).data?.vector
    if (v) { joyDx = v.x; joyDy = v.y }
  })
  joystickManager.on('end', () => { joyDx = 0; joyDy = 0 })

  const kickBtn = document.createElement('button')
  kickBtn.textContent = '⚽'
  kickBtn.style.cssText = [
    `position:absolute;right:${MARGIN}px;bottom:${MARGIN}px;`,
    `width:${BTN}px;height:${BTN}px;border-radius:50%;`,
    'border:3px solid rgba(255,255,255,0.5);',
    'background:rgba(255,140,0,0.7);color:#fff;font-size:54px;',
    'pointer-events:all;touch-action:none;',
  ].join('')
  kickBtn.addEventListener('touchstart', () => { kickStart = Date.now() }, { passive: true })
  kickBtn.addEventListener('touchend', () => {
    if (kickStart !== null) {
      pendingKickPower = Math.min((Date.now() - kickStart) / 1200, 1)
      kickStart = null
    }
  }, { passive: true })
  mobileContainer.appendChild(kickBtn)
}
