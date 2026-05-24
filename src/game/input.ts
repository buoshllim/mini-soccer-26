import nipplejs from 'nipplejs'
import type { PlayerInput } from '../types'
import { sendInput } from '../main'

const keysDown = new Set<string>()

let joyDx = 0
let joyDy = 0

let actionStart: number | null = null
let releasedPower: number | null = null
let pendingAction: PlayerInput['action'] = null

let sprintActive = false
let switchActive = false

let inputLoopId: ReturnType<typeof setInterval> | null = null
let joystickManager: ReturnType<typeof nipplejs.create> | null = null
let mobileContainer: HTMLElement | null = null

export function initInput(): void {
  if (inputLoopId !== null) return  // guard against double-init
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
  actionStart = null; releasedPower = null; pendingAction = null
  sprintActive = false; switchActive = false
}

function isMobile(): boolean {
  return window.innerWidth < 768 || 'ontouchstart' in window
}

function onKeyDown(e: KeyboardEvent): void {
  const k = e.key.toLowerCase()
  keysDown.add(k)

  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'tab'].includes(k)) {
    e.preventDefault()
  }

  if (!actionStart && isActionKey(k)) {
    actionStart = Date.now()
    pendingAction = keyToAction(k)
  }

  if (k === 'tab') switchActive = true
}

function onKeyUp(e: KeyboardEvent): void {
  const k = e.key.toLowerCase()
  keysDown.delete(k)

  if (isActionKey(k) && actionStart !== null) {
    releasedPower = Math.min((Date.now() - actionStart) / 1500, 1)
    actionStart = null
  }
}

function isActionKey(k: string): boolean {
  return [' ', 'c', 'x', 'z'].includes(k)
}

// hasBall context not available client-side; server resolves ownership.
// C/X/Z default to tackle/slidetackle/gkrush — server upgrades to pass when ball is attached.
function keyToAction(k: string): PlayerInput['action'] {
  if (k === ' ') return 'shoot'
  if (k === 'c') return 'tackle'
  if (k === 'x') return 'slidetackle'
  if (k === 'z') return 'gkrush'
  return null
}

function getDxDy(): { dx: number; dy: number } {
  if (joyDx !== 0 || joyDy !== 0) return { dx: joyDx, dy: joyDy }

  let dx = 0, dy = 0
  if (keysDown.has('arrowleft')  || keysDown.has('a')) dx -= 1
  if (keysDown.has('arrowright') || keysDown.has('d')) dx += 1
  if (keysDown.has('arrowup')    || keysDown.has('w')) dy += 1
  if (keysDown.has('arrowdown')  || keysDown.has('s')) dy -= 1

  if (dx !== 0 && dy !== 0) {
    const len = Math.sqrt(dx * dx + dy * dy)
    dx /= len; dy /= len
  }

  return { dx: Math.round(dx * 100) / 100, dy: Math.round(dy * 100) / 100 }
}

function flushInput(): void {
  const { dx, dy } = getDxDy()
  const sprint = sprintActive || keysDown.has('shift')

  let action: PlayerInput['action'] = null
  let power = 0

  if (pendingAction !== null) {
    if (actionStart !== null) {
      power = Math.min((Date.now() - actionStart) / 1500, 1)
      action = pendingAction

      // Chip shot: Space + X held simultaneously
      if (keysDown.has(' ') && keysDown.has('x')) {
        action = 'chipshot'
        power = 1
      }
    } else if (releasedPower !== null) {
      action = pendingAction
      power = releasedPower
      releasedPower = null
      pendingAction = null
    }
  }

  sendInput({ dx, dy, sprint, switchPlayer: switchActive, action, power })
  switchActive = false
}

function setupMobileControls(): void {
  mobileContainer = document.createElement('div')
  mobileContainer.id = 'mobile-controls'
  mobileContainer.style.cssText = `
    position: fixed; inset: 0; pointer-events: none; z-index: 50;
    user-select: none; -webkit-user-select: none;
  `
  document.body.appendChild(mobileContainer)

  const joyZone = document.createElement('div')
  joyZone.style.cssText = `
    position: absolute; left: 0; bottom: 0; width: 160px; height: 160px;
    pointer-events: all;
  `
  mobileContainer.appendChild(joyZone)

  joystickManager = nipplejs.create({
    zone: joyZone, mode: 'static',
    position: { left: '80px', bottom: '80px' },
    color: 'rgba(255,255,255,0.3)', size: 100,
  })

  joystickManager.on('move', (evt) => {
    const vector = evt.data?.vector
    if (vector) { joyDx = vector.x; joyDy = vector.y }
  })
  joystickManager.on('end', () => { joyDx = 0; joyDy = 0 })

  const btnArea = document.createElement('div')
  btnArea.style.cssText = `
    position: absolute; right: 16px; bottom: 16px;
    display: grid; grid-template-columns: repeat(3, 52px); grid-template-rows: repeat(2, 52px);
    gap: 8px; pointer-events: all;
  `
  mobileContainer.appendChild(btnArea)

  const addBtn = (label: string, key: string) => {
    const btn = document.createElement('button')
    btn.textContent = label
    btn.style.cssText = `
      width: 52px; height: 52px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.4);
      background: rgba(0,0,0,0.5); color: #fff; font-size: 13px; font-weight: bold;
      touch-action: none;
    `
    btn.addEventListener('touchstart', () => {
      if (!actionStart) { actionStart = Date.now(); pendingAction = keyToAction(key) }
    }, { passive: true })
    btn.addEventListener('touchend', () => {
      if (actionStart !== null) {
        releasedPower = Math.min((Date.now() - actionStart) / 1500, 1)
        actionStart = null
      }
    }, { passive: true })
    btnArea.appendChild(btn)
  }

  addBtn('슛', ' ')
  addBtn('패스', 'c')
  addBtn('로프트', 'x')
  addBtn('스루', 'z')

  const sprintBtn = document.createElement('button')
  sprintBtn.textContent = '달리기'
  sprintBtn.style.cssText = `
    position: absolute; right: 188px; bottom: 16px;
    width: 52px; height: 52px; border-radius: 50%; border: 2px solid rgba(255,200,0,0.5);
    background: rgba(0,0,0,0.5); color: #ff0; font-size: 20px;
    pointer-events: all; touch-action: none;
  `
  sprintBtn.addEventListener('touchstart', () => { sprintActive = true }, { passive: true })
  sprintBtn.addEventListener('touchend', () => { sprintActive = false }, { passive: true })
  mobileContainer.appendChild(sprintBtn)

  const switchBtn = document.createElement('button')
  switchBtn.textContent = '교체'
  switchBtn.style.cssText = `
    position: absolute; right: 188px; bottom: 76px;
    width: 52px; height: 52px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.4);
    background: rgba(0,0,0,0.5); color: #fff; font-size: 20px;
    pointer-events: all; touch-action: none;
  `
  switchBtn.addEventListener('touchstart', () => { switchActive = true }, { passive: true })
  mobileContainer.appendChild(switchBtn)
}
