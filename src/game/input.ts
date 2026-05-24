import nipplejs from 'nipplejs'
import type { PlayerInput } from '../types'
import { sendInput } from '../main'

// Key state
const keysDown = new Set<string>()

// Joystick state
let joyDx = 0
let joyDy = 0

// Action state
let actionStart: number | null = null
let pendingAction: PlayerInput['action'] = null

// Flags
let sprintActive = false
let switchActive = false

// Timer
let inputLoopId: ReturnType<typeof setInterval> | null = null
let joystickManager: ReturnType<typeof nipplejs.create> | null = null
let mobileContainer: HTMLElement | null = null

export function initInput(): void {
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)

  if (isMobile()) {
    setupMobileControls()
  }

  inputLoopId = setInterval(flushInput, 50)  // 20Hz
}

export function destroyInput(): void {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  keysDown.clear()

  if (inputLoopId !== null) {
    clearInterval(inputLoopId)
    inputLoopId = null
  }

  if (joystickManager) {
    joystickManager.destroy()
    joystickManager = null
  }

  if (mobileContainer) {
    mobileContainer.remove()
    mobileContainer = null
  }

  // Reset state
  joyDx = 0; joyDy = 0
  actionStart = null; pendingAction = null
  sprintActive = false; switchActive = false
}

function isMobile(): boolean {
  return window.innerWidth < 768 || 'ontouchstart' in window
}

function onKeyDown(e: KeyboardEvent): void {
  const key = e.key.toLowerCase()
  keysDown.add(e.key)
  keysDown.add(key)

  // Prevent default for game keys
  if (['arrowup','arrowdown','arrowleft','arrowright',' ','tab'].includes(key)) {
    e.preventDefault()
  }

  // Action keys: register press start (action fires on release or per-tick while held)
  if (!actionStart && isActionKey(e.key)) {
    actionStart = Date.now()
    pendingAction = keyToAction(e.key, true)  // assume has ball
  }

  if (key === 'tab') {
    switchActive = true
    e.preventDefault()
  }
}

function onKeyUp(e: KeyboardEvent): void {
  keysDown.delete(e.key)
  keysDown.delete(e.key.toLowerCase())

  if (isActionKey(e.key) && actionStart !== null) {
    // Action fires on key release with accumulated power
    actionStart = null
    // pendingAction stays set for this flush tick, then cleared
  }
}

function isActionKey(key: string): boolean {
  return [' ', 'c', 'C', 'x', 'X', 'z', 'Z'].includes(key)
}

function keyToAction(key: string, hasBall: boolean): PlayerInput['action'] {
  const k = key.toLowerCase()
  if (k === ' ') return hasBall ? 'shoot' : null
  if (k === 'c') return hasBall ? 'lowpass' : 'tackle'
  if (k === 'x') return hasBall ? 'loftedpass' : 'slidetackle'
  if (k === 'z') return hasBall ? 'throughpass' : 'gkrush'
  return null
}

function getDxDy(): { dx: number; dy: number } {
  // Joystick takes priority on mobile
  if (joyDx !== 0 || joyDy !== 0) return { dx: joyDx, dy: joyDy }

  let dx = 0, dy = 0
  if (keysDown.has('ArrowLeft')  || keysDown.has('a')) dx -= 1
  if (keysDown.has('ArrowRight') || keysDown.has('d')) dx += 1
  if (keysDown.has('ArrowUp')    || keysDown.has('w')) dy -= 1
  if (keysDown.has('ArrowDown')  || keysDown.has('s')) dy += 1

  // Normalize diagonal
  if (dx !== 0 && dy !== 0) {
    const len = Math.sqrt(dx * dx + dy * dy)
    dx /= len; dy /= len
  }

  return { dx: Math.round(dx * 10) / 10, dy: Math.round(dy * 10) / 10 }
}

function flushInput(): void {
  const { dx, dy } = getDxDy()
  const sprint = sprintActive || keysDown.has('Shift')

  let action: PlayerInput['action'] = null
  let power = 0

  if (pendingAction !== null) {
    if (actionStart !== null) {
      // Button still held: send hold action with growing power
      power = Math.min((Date.now() - actionStart) / 1500, 1)
      action = pendingAction

      // Chip shot combo: Space + X pressed simultaneously
      const spaceHeld = keysDown.has(' ')
      const xHeld = keysDown.has('x') || keysDown.has('X')
      if (spaceHeld && xHeld) {
        action = 'chipshot'
        power = 1
      }
    } else {
      // Key was released this tick — fire the final action
      action = pendingAction
      power = 1
      pendingAction = null
    }
  }

  const input: PlayerInput = {
    dx: Math.round(dx * 100) / 100,
    dy: Math.round(dy * 100) / 100,
    sprint,
    switchPlayer: switchActive,
    action,
    power,
  }

  sendInput(input)

  // Reset per-tick flags
  switchActive = false
  // Note: pendingAction cleared on key release, not here
}

function setupMobileControls(): void {
  // Container for all mobile UI
  mobileContainer = document.createElement('div')
  mobileContainer.id = 'mobile-controls'
  mobileContainer.style.cssText = `
    position: fixed; inset: 0; pointer-events: none; z-index: 50;
    user-select: none; -webkit-user-select: none;
  `
  document.body.appendChild(mobileContainer)

  // Joystick zone (left side)
  const joyZone = document.createElement('div')
  joyZone.style.cssText = `
    position: absolute; left: 0; bottom: 0; width: 160px; height: 160px;
    pointer-events: all;
  `
  mobileContainer.appendChild(joyZone)

  joystickManager = nipplejs.create({
    zone: joyZone,
    mode: 'static',
    position: { left: '80px', bottom: '80px' },
    color: 'rgba(255,255,255,0.3)',
    size: 100,
  })

  joystickManager.on('move', (evt) => {
    const vector = evt.data?.vector
    if (vector) {
      joyDx = vector.x
      joyDy = -vector.y  // nipplejs y is inverted
    }
  })
  joystickManager.on('end', () => { joyDx = 0; joyDy = 0 })

  // Action buttons (right side)
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
    const startAction = () => {
      if (!actionStart) {
        actionStart = Date.now()
        pendingAction = keyToAction(key, true)
      }
    }
    const endAction = () => { actionStart = null }
    btn.addEventListener('touchstart', startAction, { passive: true })
    btn.addEventListener('touchend', endAction, { passive: true })
    btnArea.appendChild(btn)
    return btn
  }

  addBtn('Shoot', ' ')
  addBtn('C', 'c')
  addBtn('X', 'x')
  addBtn('Z', 'z')

  // Sprint button
  const sprintBtn = document.createElement('button')
  sprintBtn.textContent = '⚡'
  sprintBtn.style.cssText = `
    position: absolute; right: 188px; bottom: 16px;
    width: 52px; height: 52px; border-radius: 50%; border: 2px solid rgba(255,200,0,0.5);
    background: rgba(0,0,0,0.5); color: #ff0; font-size: 20px;
    pointer-events: all; touch-action: none;
  `
  sprintBtn.addEventListener('touchstart', () => { sprintActive = true }, { passive: true })
  sprintBtn.addEventListener('touchend', () => { sprintActive = false }, { passive: true })
  mobileContainer.appendChild(sprintBtn)

  // Switch button
  const switchBtn = document.createElement('button')
  switchBtn.textContent = '↔'
  switchBtn.style.cssText = `
    position: absolute; right: 188px; bottom: 76px;
    width: 52px; height: 52px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.4);
    background: rgba(0,0,0,0.5); color: #fff; font-size: 20px;
    pointer-events: all; touch-action: none;
  `
  switchBtn.addEventListener('touchstart', () => { switchActive = true }, { passive: true })
  mobileContainer.appendChild(switchBtn)
}
