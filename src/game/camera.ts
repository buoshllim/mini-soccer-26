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
    // 세로 모드: 최대한 줌아웃, 수평 트래킹 거의 없애서 양쪽 골대 항상 보이게
    const targetZ = 110
    camTargetX += (wx * 0.03 - camTargetX) * 0.04
    camTargetZ += (targetZ - camTargetZ) * 0.04
    camera.fov = 80
  } else {
    const ballDist = Math.abs(wx) + Math.abs(ball.pos.y - FIELD.CENTER_Y) * 0.4
    const targetZ = 40 + (ballDist / 50) * 15  // range 40–55
    camTargetX += (wx * 0.3 - camTargetX) * 0.06
    camTargetZ += (targetZ - camTargetZ) * 0.04
    camera.fov = 55
  }

  camera.updateProjectionMatrix()
  camera.position.x = camTargetX
  camera.position.y = portrait ? -77 : -38
  camera.position.z = camTargetZ
  camera.lookAt(camTargetX, portrait ? 0 : -12, 0)
}

export function resetCamera(camera: THREE.PerspectiveCamera): void {
  const portrait = window.innerHeight > window.innerWidth
  camera.position.set(0, portrait ? -77 : -38, portrait ? 110 : 45)
  camera.lookAt(0, portrait ? 0 : -12, 0)
  camTargetX = 0
  camTargetZ = portrait ? 110 : 45
}
