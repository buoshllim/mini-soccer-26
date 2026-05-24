import * as THREE from 'three'
import type { GameState } from '../types'
import { FIELD } from '../types'

let camTargetX = 0
let camTargetZ = 45

export function tickCamera(camera: THREE.PerspectiveCamera, state: GameState): void {
  const { ball } = state
  const wx = ball.pos.x - FIELD.CENTER_X
  const portrait = window.innerHeight > window.innerWidth

  if (portrait) {
    // 세로 모드: 크게 당기고 수평 트래킹 최소화해서 양쪽 골대 최대한 보이게
    const ballDist = Math.abs(wx) + Math.abs(ball.pos.y - FIELD.CENTER_Y) * 0.4
    const targetZ = 75 + (ballDist / 50) * 20  // range 75–95
    camTargetX += (wx * 0.08 - camTargetX) * 0.05
    camTargetZ += (targetZ - camTargetZ) * 0.04
    camera.fov = 70
  } else {
    const ballDist = Math.abs(wx) + Math.abs(ball.pos.y - FIELD.CENTER_Y) * 0.4
    const targetZ = 40 + (ballDist / 50) * 15  // range 40–55
    camTargetX += (wx * 0.3 - camTargetX) * 0.06
    camTargetZ += (targetZ - camTargetZ) * 0.04
    camera.fov = 55
  }

  camera.updateProjectionMatrix()
  camera.position.x = camTargetX
  camera.position.z = camTargetZ
  camera.lookAt(camTargetX, -12, 0)
}

export function resetCamera(camera: THREE.PerspectiveCamera): void {
  const portrait = window.innerHeight > window.innerWidth
  camera.position.set(0, -38, portrait ? 80 : 45)
  camera.lookAt(0, -12, 0)
  camTargetX = 0
  camTargetZ = portrait ? 80 : 45
}
