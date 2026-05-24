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
let indicatorMesh: THREE.Mesh | null = null
let rendererMyTeam: 'home' | 'away' | null = null

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

  camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 500)
  camera.position.set(0, -38, 45)
  camera.lookAt(0, 0, 0)

  buildLighting()
  buildField()
  buildBall()
  buildIndicator()
  syncPlayers(initialState)

  window.addEventListener('resize', onResize)
  window.addEventListener('wheel', onWheel, { passive: false })
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
  if (indicatorMesh && scene) { scene.remove(indicatorMesh); indicatorMesh = null }
  rendererMyTeam = null
  if (renderer) renderer.dispose()
  renderer = null
  scene = null
  camera = null
  latestState = null
  window.removeEventListener('resize', onResize)
  window.removeEventListener('wheel', onWheel)
}

export function setRendererTeam(team: 'home' | 'away' | null): void {
  rendererMyTeam = team
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
  const mat = new THREE.MeshLambertMaterial({ color: 0xeeeeee })
  const goalHW = FIELD.GOAL_WIDTH / 2  // 4 world units
  const depth = 2.5  // goal depth in world units
  const dir = x < 0 ? 1 : -1  // direction into the field

  // Front posts (standing upright along Z)
  const postGeo = new THREE.CylinderGeometry(0.18, 0.18, 5, 8)
  postGeo.rotateX(Math.PI / 2)  // Y-axis → Z-axis (standing up)

  const lPost = new THREE.Mesh(postGeo, mat)
  lPost.position.set(x, -goalHW, 2.5)
  scene.add(lPost)

  const rPost = new THREE.Mesh(postGeo, mat)
  rPost.position.set(x, goalHW, 2.5)
  scene.add(rPost)

  // Front crossbar (horizontal along Y, connecting both posts at top)
  const crossGeo = new THREE.CylinderGeometry(0.13, 0.13, FIELD.GOAL_WIDTH, 8)
  // Default cylinder is along Y — no rotation needed
  const crossbar = new THREE.Mesh(crossGeo, mat)
  crossbar.position.set(x, 0, 5)
  scene.add(crossbar)

  // Back posts
  const lBackPost = new THREE.Mesh(postGeo.clone(), mat)
  lBackPost.position.set(x + dir * depth, -goalHW, 2.5)
  scene.add(lBackPost)

  const rBackPost = new THREE.Mesh(postGeo.clone(), mat)
  rBackPost.position.set(x + dir * depth, goalHW, 2.5)
  scene.add(rBackPost)

  // Back crossbar
  const backCross = new THREE.Mesh(crossGeo.clone(), mat)
  backCross.position.set(x + dir * depth, 0, 5)
  scene.add(backCross)

  // Side top bars (along X connecting front to back at top)
  const sideBarGeo = new THREE.CylinderGeometry(0.1, 0.1, depth, 6)
  sideBarGeo.rotateZ(Math.PI / 2)  // Y → X axis

  const lTopBar = new THREE.Mesh(sideBarGeo, mat)
  lTopBar.position.set(x + dir * depth / 2, -goalHW, 5)
  scene.add(lTopBar)

  const rTopBar = new THREE.Mesh(sideBarGeo.clone(), mat)
  rTopBar.position.set(x + dir * depth / 2, goalHW, 5)
  scene.add(rTopBar)
}

function buildBall(): void {
  if (!scene) return
  const geo = new THREE.SphereGeometry(0.7, 16, 12)
  const mat = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 80, specular: 0x999999 })
  ballMesh = new THREE.Mesh(geo, mat)
  ballMesh.castShadow = true

  // Wireframe overlay for soccer ball look
  const wireGeo = new THREE.SphereGeometry(0.73, 8, 6)
  const wireMat = new THREE.MeshBasicMaterial({ color: 0x111111, wireframe: true, transparent: true, opacity: 0.55 })
  ballMesh.add(new THREE.Mesh(wireGeo, wireMat))

  scene.add(ballMesh)
}

function buildIndicator(): void {
  if (!scene) return
  const geo = new THREE.ConeGeometry(0.45, 1.4, 4)
  geo.rotateX(Math.PI)  // point downward
  const mat = new THREE.MeshBasicMaterial({ color: 0x00ff88 })
  indicatorMesh = new THREE.Mesh(geo, mat)
  indicatorMesh.visible = false
  scene.add(indicatorMesh)
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
  group.scale.setScalar(0.65)

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

  // Indicator above controlled player (only while defending)
  if (indicatorMesh) {
    const ballOwner = state.players.find(p => p.id === state.ball.ownerId)
    const myTeamHasBall = rendererMyTeam && ballOwner?.team === rendererMyTeam
    const showIndicator = !myTeamHasBall && rendererMyTeam !== null
    const myControlled = showIndicator
      ? state.players.find(p => p.team === rendererMyTeam && p.isControlled)
      : null

    if (myControlled) {
      const [ix, iy] = gameToWorld(myControlled.pos.x, myControlled.pos.y)
      indicatorMesh.position.set(ix, iy, 7)
      indicatorMesh.visible = true
    } else {
      indicatorMesh.visible = false
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

function onWheel(e: WheelEvent): void {
  e.preventDefault()
  if (!camera) return
  camera.fov = Math.max(25, Math.min(80, camera.fov + (e.deltaY > 0 ? 4 : -4)))
  camera.updateProjectionMatrix()
}
