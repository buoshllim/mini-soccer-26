import * as THREE from 'three'
import type { GameState } from '../types'
import { FIELD } from '../types'
import { tickCamera } from './camera'

// Scene globals
let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let animFrameId: number | null = null

// Meshes
const playerMeshes = new Map<string, THREE.Group>()
let ballMesh: THREE.Mesh | null = null
let latestState: GameState | null = null

// Team colors (lobby color → hex)
const TEAM_COLORS: Record<string, number> = {
  blue: 0x3b82f6,
  red: 0xef4444,
  green: 0x16a34a,
  yellow: 0xeab308,
}

export function startGame(initialState: GameState): void {
  latestState = initialState
  const canvas = document.getElementById('three-canvas') as HTMLCanvasElement

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.shadowMap.enabled = true

  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x1a2035)

  camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 500)
  camera.position.set(0, -55, 75)
  camera.lookAt(0, 0, 0)

  buildLighting()
  buildField()
  buildBall()
  syncPlayers(initialState)

  window.addEventListener('resize', onResize)
  animFrameId = requestAnimationFrame(renderLoop)
}

export function stopGame(): void {
  if (animFrameId !== null) {
    cancelAnimationFrame(animFrameId)
    animFrameId = null
  }
  // Clear meshes
  playerMeshes.forEach(mesh => scene?.remove(mesh))
  playerMeshes.clear()
  if (ballMesh && scene) scene.remove(ballMesh)
  ballMesh = null
  if (renderer) renderer.dispose()
  renderer = null
  scene = null
  camera = null
  latestState = null
  window.removeEventListener('resize', onResize)
}

export function updateGameState(state: GameState): void {
  latestState = state
  if (!scene) return
  syncPlayers(state)
  syncBall(state)
}

// ─── Coordinate conversion ───────────────────────────────────────────────────

function gameToWorld(gx: number, gy: number): [number, number] {
  return [gx - 50, gy - 30]
}

// ─── Scene building ───────────────────────────────────────────────────────────

function buildLighting(): void {
  if (!scene) return
  scene.add(new THREE.AmbientLight(0xffffff, 0.7))
  const sun = new THREE.DirectionalLight(0xffffff, 0.8)
  sun.position.set(0, -30, 60)
  sun.castShadow = true
  scene.add(sun)
}

function buildField(): void {
  if (!scene) return

  // Grass plane
  const grassGeo = new THREE.PlaneGeometry(100, 60)
  const grassMat = new THREE.MeshLambertMaterial({ color: 0x2d7a1f })
  const grass = new THREE.Mesh(grassGeo, grassMat)
  grass.receiveShadow = true
  scene.add(grass)

  // Darker stripe pattern (alternating stripes)
  const stripeMat = new THREE.MeshLambertMaterial({ color: 0x267318, transparent: true, opacity: 0.5 })
  for (let i = 0; i < 5; i++) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(10, 60), stripeMat)
    stripe.position.set(-40 + i * 20, 0, 0.01)
    scene.add(stripe)
  }

  // Field lines
  const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 })

  const addLine = (points: THREE.Vector3[]) => {
    const geo = new THREE.BufferGeometry().setFromPoints(points)
    scene!.add(new THREE.Line(geo, lineMat))
  }

  const z = 0.1  // slightly above grass
  // Perimeter
  addLine([new THREE.Vector3(-50, -30, z), new THREE.Vector3(50, -30, z)])
  addLine([new THREE.Vector3(-50, 30, z), new THREE.Vector3(50, 30, z)])
  addLine([new THREE.Vector3(-50, -30, z), new THREE.Vector3(-50, 30, z)])
  addLine([new THREE.Vector3(50, -30, z), new THREE.Vector3(50, 30, z)])
  // Center line
  addLine([new THREE.Vector3(0, -30, z), new THREE.Vector3(0, 30, z)])
  // Center circle (approximate with segments)
  const circlePoints: THREE.Vector3[] = []
  for (let i = 0; i <= 32; i++) {
    const angle = (i / 32) * Math.PI * 2
    circlePoints.push(new THREE.Vector3(Math.cos(angle) * 10, Math.sin(angle) * 10, z))
  }
  addLine(circlePoints)

  // Penalty areas: PA_DEPTH=16 from goal line, PA_HALF_WIDTH=18 from center
  const paHW = FIELD.PA_HALF_WIDTH  // 18 → world units: -18 to +18
  const paD = FIELD.PA_DEPTH        // 16 → starts at x=-50, ends at x=-34

  // Home PA (left side, x: -50 to -34)
  addLine([new THREE.Vector3(-50, -paHW, z), new THREE.Vector3(-50 + paD, -paHW, z)])
  addLine([new THREE.Vector3(-50 + paD, -paHW, z), new THREE.Vector3(-50 + paD, paHW, z)])
  addLine([new THREE.Vector3(-50 + paD, paHW, z), new THREE.Vector3(-50, paHW, z)])

  // Away PA (right side, x: +34 to +50)
  addLine([new THREE.Vector3(50, -paHW, z), new THREE.Vector3(50 - paD, -paHW, z)])
  addLine([new THREE.Vector3(50 - paD, -paHW, z), new THREE.Vector3(50 - paD, paHW, z)])
  addLine([new THREE.Vector3(50 - paD, paHW, z), new THREE.Vector3(50, paHW, z)])

  // Goals
  buildGoal(-50)  // Home goal (left)
  buildGoal(50)   // Away goal (right)
}

function buildGoal(x: number): void {
  if (!scene) return
  const mat = new THREE.MeshLambertMaterial({ color: 0xdddddd })
  const goalHW = FIELD.GOAL_WIDTH / 2  // 4 world units

  // Posts
  const postGeo = new THREE.CylinderGeometry(0.2, 0.2, 5, 8)
  const lPost = new THREE.Mesh(postGeo, mat)
  lPost.position.set(x, -goalHW, 2.5)
  scene.add(lPost)

  const rPost = new THREE.Mesh(postGeo, mat)
  rPost.position.set(x, goalHW, 2.5)
  scene.add(rPost)

  // Crossbar
  const crossGeo = new THREE.CylinderGeometry(0.15, 0.15, FIELD.GOAL_WIDTH, 8)
  crossGeo.rotateX(Math.PI / 2)
  const crossbar = new THREE.Mesh(crossGeo, mat)
  crossbar.position.set(x, 0, 5)
  scene.add(crossbar)
}

function buildBall(): void {
  if (!scene) return
  const geo = new THREE.SphereGeometry(0.7, 16, 12)
  const mat = new THREE.MeshLambertMaterial({ color: 0xfafafa })
  ballMesh = new THREE.Mesh(geo, mat)
  ballMesh.castShadow = true
  scene.add(ballMesh)
}

// ─── Character building ───────────────────────────────────────────────────────

function buildPlayerMesh(color: number): THREE.Group {
  const group = new THREE.Group()
  const mat = (c: number) => new THREE.MeshLambertMaterial({ color: c })

  const SKIN = 0xfbbf24  // skin color

  // Body (jersey) — raised so feet are at z=0
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 2.2), mat(color))
  body.position.set(0, 0, 3.3)
  group.add(body)

  // Head
  const head = new THREE.Mesh(new THREE.SphereGeometry(1.0, 10, 8), mat(SKIN))
  head.position.set(0, 0, 5.5)
  group.add(head)

  // Arms
  const armGeo = new THREE.BoxGeometry(0.5, 0.5, 1.6)
  const lArm = new THREE.Mesh(armGeo, mat(color))
  lArm.position.set(-1.2, 0, 3.4)
  group.add(lArm)
  const rArm = new THREE.Mesh(armGeo, mat(color))
  rArm.position.set(1.2, 0, 3.4)
  group.add(rArm)

  // Legs
  const legGeo = new THREE.BoxGeometry(0.6, 0.6, 2.0)
  const lLeg = new THREE.Mesh(legGeo, mat(0x1e293b))
  lLeg.position.set(-0.5, 0, 1.2)
  group.add(lLeg)
  const rLeg = new THREE.Mesh(legGeo, mat(0x1e293b))
  rLeg.position.set(0.5, 0, 1.2)
  group.add(rLeg)

  // Scale down to appropriate field size
  group.scale.setScalar(0.4)

  return group
}

// ─── State sync ───────────────────────────────────────────────────────────────

function getTeamColor(state: GameState, team: 'home' | 'away'): number {
  const colorName = state.lobby?.[team]?.color ?? (team === 'home' ? 'blue' : 'red')
  return TEAM_COLORS[colorName ?? 'blue'] ?? 0x3b82f6
}

function syncPlayers(state: GameState): void {
  if (!scene) return

  for (const player of state.players) {
    let mesh = playerMeshes.get(player.id)

    if (!mesh) {
      const color = getTeamColor(state, player.team)
      mesh = buildPlayerMesh(color)
      scene.add(mesh)
      playerMeshes.set(player.id, mesh)
    }

    const [wx, wy] = gameToWorld(player.pos.x, player.pos.y)
    mesh.position.set(wx, wy, 0)

    // Rotate player to face direction
    const angle = Math.atan2(player.facing.y, player.facing.x)
    mesh.rotation.z = angle - Math.PI / 2  // -90° because model faces +Y by default
  }

  // Remove meshes for players no longer in state
  for (const [id, mesh] of playerMeshes) {
    if (!state.players.find(p => p.id === id)) {
      scene.remove(mesh)
      playerMeshes.delete(id)
    }
  }
}

function syncBall(state: GameState): void {
  if (!ballMesh) return
  const [wx, wy] = gameToWorld(state.ball.pos.x, state.ball.pos.y)
  // Ball z: game z maps to world z (ball can be airborne)
  ballMesh.position.set(wx, wy, state.ball.pos.z * 0.7 + 0.5)
}

// ─── Render loop ──────────────────────────────────────────────────────────────

function renderLoop(): void {
  animFrameId = requestAnimationFrame(renderLoop)
  if (!renderer || !scene || !camera) return

  if (latestState) {
    syncBall(latestState)
    tickCamera(camera, latestState)
  }

  renderer.render(scene, camera)
}

function onResize(): void {
  if (!camera || !renderer) return
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
}
