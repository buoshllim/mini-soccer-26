import * as THREE from 'three'
import type { GameState } from '../types'
import { FIELD } from '../types'

let camTargetX = 0
let camTargetZ = 75

export function tickCamera(camera: THREE.PerspectiveCamera, state: GameState): void {
  const { ball } = state
  // Ball in game coords → world x
  const wx = ball.pos.x - FIELD.CENTER_X  // -50 to +50

  // Zoom out when ball is far from center
  const ballDist = Math.abs(wx) + Math.abs(ball.pos.y - FIELD.CENTER_Y) * 0.5
  const targetZ = 70 + (ballDist / 50) * 20

  // Camera follows ball x with damping
  camTargetX += (wx * 0.3 - camTargetX) * 0.06
  camTargetZ += (targetZ - camTargetZ) * 0.04

  camera.position.x = camTargetX
  camera.position.z = camTargetZ
  camera.lookAt(camTargetX, 0, 0)
}

export function resetCamera(camera: THREE.PerspectiveCamera): void {
  camera.position.set(0, -55, 75)
  camera.lookAt(0, 0, 0)
  camTargetX = 0
  camTargetZ = 75
}
