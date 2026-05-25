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
const indicatorMeshes = new Map<string, THREE.Mesh>()
let ballMesh: THREE.Mesh | null = null
let ballShadow: THREE.Mesh | null = null
let kickTime: number | null = null       // timestamp when ball was last kicked
let kickSpeed = 0                        // speed at kick moment
let prevBallOwnerId: string | null | undefined = undefined
let latestState: GameState | null = null
let rendererMyTeam: 'home' | 'away' | null = null

// Team colors (lobby color → hex)
const TEAM_COLORS: Record<string, number> = {
  blue: 0x3b82f6,
  red: 0xef4444,
  green: 0x16a34a,
  yellow: 0xfacc15,
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
  camera.lookAt(0, -12, 0)

  buildLighting()
  buildField()
  buildBall()
  syncPlayers(initialState)

  const threeCanvas = document.getElementById('three-canvas') as HTMLCanvasElement
  if (threeCanvas) threeCanvas.style.display = 'block'

  window.addEventListener('resize', onResize)
  window.addEventListener('wheel', onWheel, { passive: false })
  window.addEventListener('touchstart', onTouchStart, { passive: true })
  window.addEventListener('touchmove', onTouchMove, { passive: false })
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
  indicatorMeshes.forEach(mesh => scene?.remove(mesh))
  indicatorMeshes.clear()
  if (ballMesh && scene) scene.remove(ballMesh)
  ballMesh = null
  if (ballShadow && scene) scene.remove(ballShadow)
  ballShadow = null
  rendererMyTeam = null
  if (renderer) {
    renderer.clear()
    renderer.dispose()
  }
  renderer = null
  window.removeEventListener('touchstart', onTouchStart)
  window.removeEventListener('touchmove', onTouchMove)
  scene = null
  camera = null
  latestState = null
  lastRenderTime = 0
  kickTime = null; kickSpeed = 0; prevBallOwnerId = undefined
  window.removeEventListener('resize', onResize)
  window.removeEventListener('wheel', onWheel)
  // Hide canvas so the soccer field doesn't linger behind other screens
  const threeCanvas = document.getElementById('three-canvas') as HTMLCanvasElement
  if (threeCanvas) threeCanvas.style.display = 'none'
}

export function setRendererTeam(team: 'home' | 'away' | null): void {
  rendererMyTeam = team
}

export function updateGameState(state: GameState): void {
  latestState = state
  if (!scene) return
  syncPlayers(state)
  syncBall(state)
  syncIndicators(state)
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
  const goalHW = FIELD.GOAL_WIDTH / 2  // world units
  const depth = 3.0  // goal depth in world units
  const dir = x < 0 ? -1 : 1  // direction away from field (outside)
  const backX = x + dir * depth

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
  const crossbar = new THREE.Mesh(crossGeo, mat)
  crossbar.position.set(x, 0, 5)
  scene.add(crossbar)

  // Back posts (outside field)
  const lBackPost = new THREE.Mesh(postGeo.clone(), mat)
  lBackPost.position.set(backX, -goalHW, 2.5)
  scene.add(lBackPost)

  const rBackPost = new THREE.Mesh(postGeo.clone(), mat)
  rBackPost.position.set(backX, goalHW, 2.5)
  scene.add(rBackPost)

  // Back crossbar
  const backCross = new THREE.Mesh(crossGeo.clone(), mat)
  backCross.position.set(backX, 0, 5)
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

  // Net
  buildGoalNet(x, dir, goalHW, depth, backX)
}

function buildGoalNet(frontX: number, dir: number, goalHW: number, depth: number, backX: number): void {
  if (!scene) return
  const netMat = new THREE.LineBasicMaterial({ color: 0xdddddd, transparent: true, opacity: 0.45 })
  const zTop = 5
  const NX = 6   // divisions front-to-back
  const NZ = 5   // divisions bottom-to-top
  const NY = 8   // divisions side-to-side

  const pts: THREE.Vector3[] = []

  // Left side panel (y = -goalHW): vertical and horizontal lines
  for (let i = 0; i <= NX; i++) {
    const nx = frontX + dir * (depth * i / NX)
    pts.push(new THREE.Vector3(nx, -goalHW, 0), new THREE.Vector3(nx, -goalHW, zTop))
  }
  for (let j = 0; j <= NZ; j++) {
    const nz = zTop * j / NZ
    pts.push(new THREE.Vector3(frontX, -goalHW, nz), new THREE.Vector3(backX, -goalHW, nz))
  }

  // Right side panel (y = +goalHW)
  for (let i = 0; i <= NX; i++) {
    const nx = frontX + dir * (depth * i / NX)
    pts.push(new THREE.Vector3(nx, goalHW, 0), new THREE.Vector3(nx, goalHW, zTop))
  }
  for (let j = 0; j <= NZ; j++) {
    const nz = zTop * j / NZ
    pts.push(new THREE.Vector3(frontX, goalHW, nz), new THREE.Vector3(backX, goalHW, nz))
  }

  // Top panel (z = zTop): front to back, left to right
  for (let i = 0; i <= NX; i++) {
    const nx = frontX + dir * (depth * i / NX)
    pts.push(new THREE.Vector3(nx, -goalHW, zTop), new THREE.Vector3(nx, goalHW, zTop))
  }
  for (let j = 0; j <= NY; j++) {
    const ny = -goalHW + (goalHW * 2 * j / NY)
    pts.push(new THREE.Vector3(frontX, ny, zTop), new THREE.Vector3(backX, ny, zTop))
  }

  // Back panel: vertical rectangle at backX (outside field)
  for (let j = 0; j <= NY; j++) {
    const ny = -goalHW + (goalHW * 2 * j / NY)
    pts.push(new THREE.Vector3(backX, ny, 0), new THREE.Vector3(backX, ny, zTop))
  }
  for (let i = 0; i <= NZ; i++) {
    const nz = zTop * i / NZ
    pts.push(new THREE.Vector3(backX, -goalHW, nz), new THREE.Vector3(backX, goalHW, nz))
  }

  const geo = new THREE.BufferGeometry().setFromPoints(pts)
  scene.add(new THREE.LineSegments(geo, netMat))
}

function buildBall(): void {
  if (!scene) return
  // Matte white base — no shininess
  const geo = new THREE.SphereGeometry(0.7, 20, 16)
  const mat = new THREE.MeshLambertMaterial({ color: 0xeeeeee })
  ballMesh = new THREE.Mesh(geo, mat)
  ballMesh.castShadow = true

  // Soccer ball seam pattern — dodecahedron edges approximate pentagon patches
  const seamGeo = new THREE.EdgesGeometry(new THREE.DodecahedronGeometry(0.73, 0))
  const seamMat = new THREE.LineBasicMaterial({ color: 0x111111 })
  ballMesh.add(new THREE.LineSegments(seamGeo, seamMat))

  scene.add(ballMesh)

  // Ground shadow — scales down and fades as ball rises
  const shadowGeo = new THREE.CircleGeometry(0.7, 16)
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 })
  ballShadow = new THREE.Mesh(shadowGeo, shadowMat)
  ballShadow.position.z = 0.05
  scene.add(ballShadow)
}

// ─── Character building ───────────────────────────────────────────────────────

function buildPlayerMesh(color: number, isGK = false, gloveColor = color): THREE.Group {
  const group = new THREE.Group()
  const mat = (c: number) => new THREE.MeshLambertMaterial({ color: c })
  const gloveMat = () => new THREE.MeshLambertMaterial({ color: gloveColor, emissive: gloveColor, emissiveIntensity: 1.0 })
  const SKIN = 0xfbbf24

  // Body
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 2.2), mat(color))
  body.position.set(0, 0, 3.3)
  group.add(body)

  // Head
  const head = new THREE.Mesh(new THREE.SphereGeometry(1.0, 10, 8), mat(SKIN))
  head.position.set(0, 0, 5.5)
  group.add(head)

  // Face features on the +Y side (player's forward direction)
  const faceMat = new THREE.MeshLambertMaterial({ color: 0x111111 })
  // Left eye
  const lEye = new THREE.Mesh(new THREE.SphereGeometry(0.13, 6, 6), faceMat)
  lEye.position.set(-0.32, 0.9, 5.72)
  group.add(lEye)
  // Right eye
  const rEye = new THREE.Mesh(new THREE.SphereGeometry(0.13, 6, 6), faceMat)
  rEye.position.set(0.32, 0.9, 5.72)
  group.add(rEye)
  // Smile — 3 small dots in an arc
  const smileMat = new THREE.MeshLambertMaterial({ color: 0x331100 })
  const smilePositions: [number, number, number][] = [
    [-0.3, 0.93, 5.3], [0, 0.97, 5.22], [0.3, 0.93, 5.3],
  ]
  for (const [sx, sy, sz] of smilePositions) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.09, 5, 5), smileMat)
    dot.position.set(sx, sy, sz)
    group.add(dot)
  }

  // Arm pivots at shoulder (z=4.2) — mesh hangs down so rotation swings like a pendulum
  const armW = isGK ? 0.75 : 0.5
  const armLen = isGK ? 2.0 : 1.6
  const armX = isGK ? 1.3 : 1.2

  const lArmPivot = new THREE.Group()
  lArmPivot.position.set(-armX, 0, 4.2)
  const lArmMesh = new THREE.Mesh(new THREE.BoxGeometry(armW, armW, armLen), mat(color))
  lArmMesh.position.set(0, 0, -armLen / 2)
  lArmPivot.add(lArmMesh)
  if (isGK) {
    const lGlove = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 0.8), gloveMat())
    lGlove.position.set(0, 0, -armLen - 0.4)
    lArmPivot.add(lGlove)
  }
  group.add(lArmPivot)

  const rArmPivot = new THREE.Group()
  rArmPivot.position.set(armX, 0, 4.2)
  const rArmMesh = new THREE.Mesh(new THREE.BoxGeometry(armW, armW, armLen), mat(color))
  rArmMesh.position.set(0, 0, -armLen / 2)
  rArmPivot.add(rArmMesh)
  if (isGK) {
    const rGlove = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 0.8), gloveMat())
    rGlove.position.set(0, 0, -armLen - 0.4)
    rArmPivot.add(rGlove)
  }
  group.add(rArmPivot)

  // Leg pivots at hip (z=2.2)
  const lLegPivot = new THREE.Group()
  lLegPivot.position.set(-0.5, 0, 2.2)
  const lLegMesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 2.0), mat(0x1e293b))
  lLegMesh.position.set(0, 0, -1.0)
  lLegPivot.add(lLegMesh)
  group.add(lLegPivot)

  const rLegPivot = new THREE.Group()
  rLegPivot.position.set(0.5, 0, 2.2)
  const rLegMesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 2.0), mat(0x1e293b))
  rLegMesh.position.set(0, 0, -1.0)
  rLegPivot.add(rLegMesh)
  group.add(rLegPivot)

  // Store pivots so renderLoop can animate them
  group.userData.lArmPivot = lArmPivot
  group.userData.rArmPivot = rArmPivot
  group.userData.lLegPivot = lLegPivot
  group.userData.rLegPivot = rLegPivot

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
      mesh = buildPlayerMesh(color, player.role === 'gk', color)
      scene.add(mesh)
      playerMeshes.set(player.id, mesh)
    }

    const [wx, wy] = gameToWorld(player.pos.x, player.pos.y)
    mesh.position.set(wx, wy, 0)

    // Rotate player to face direction
    const angle = Math.atan2(player.facing.y, player.facing.x)
    mesh.rotation.z = angle - Math.PI / 2  // -90° because model faces +Y by default

    // Stumble tilt when stunned
    const stuntFraction = Math.min(player.stunTimer / FIELD.STUN_DURATION, 1)
    mesh.rotation.x = stuntFraction * 0.7
    mesh.rotation.y = stuntFraction * (Math.sin(Date.now() * 0.015) * 0.5)
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

  // Detect kick: owner → free with high speed
  const curOwnerId = state.ball.ownerId
  if (prevBallOwnerId !== undefined && prevBallOwnerId !== null && curOwnerId === null) {
    const spd = Math.hypot(state.ball.vel.x, state.ball.vel.y)
    if (spd > FIELD.KICK_MIN_SPEED) {
      kickTime = performance.now()
      kickSpeed = spd
    }
  }
  if (curOwnerId !== null) kickTime = null  // dribbling: reset
  prevBallOwnerId = curOwnerId

  // Time-based parabolic arc — only strong kicks get visible arc
  let z = 0.7
  if (kickTime !== null) {
    const elapsed = (performance.now() - kickTime) / 1000
    const threshold = FIELD.KICK_MIN_SPEED * 1.6  // ~35: weak kicks stay flat
    const powerRatio = Math.max(0, (kickSpeed - threshold) / (FIELD.KICK_MAX_SPEED - threshold))
    const maxHeight = Math.pow(powerRatio, 1.5) * 5.5  // 1.5 power: weak kicks get some arc, strong kicks peak at 5.5
    const flightDuration = 0.3 + powerRatio * 0.45  // 0.3s~0.75s
    const t = Math.min(elapsed / flightDuration, 1)
    // Strong kicks travel flat first, then arc — flatPhase scales with power
    const flatPhase = powerRatio * 0.3
    const arcZ = t < flatPhase
      ? 0
      : maxHeight * Math.sin(((t - flatPhase) / (1 - flatPhase)) * Math.PI)
    z = 0.7 + arcZ
    if (t >= 1) kickTime = null
  }

  ballMesh.position.set(wx, wy, z)

  if (ballShadow) {
    ballShadow.position.set(wx, wy, 0.05)
    const lift = z - 0.7
    const scale = Math.max(0.35, 1 - lift / 10)
    ballShadow.scale.setScalar(scale);
    (ballShadow.material as THREE.MeshBasicMaterial).opacity = scale * 0.35
  }
}

// Floating cone above controlled field players — uses team uniform color with glow
function syncIndicators(state: GameState): void {
  if (!scene) return
  const controlledIds = new Set<string>()

  for (const player of state.players) {
    if (!player.isControlled || player.role === 'gk') continue
    controlledIds.add(player.id)

    const color = getTeamColor(state, player.team)

    let mesh = indicatorMeshes.get(player.id)
    if (!mesh) {
      const geo = new THREE.ConeGeometry(0.5, 1.2, 6)
      geo.rotateX(Math.PI)  // tip points downward
      mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 1.0 }))
      scene.add(mesh)
      indicatorMeshes.set(player.id, mesh)
    } else {
      const mat = mesh.material as THREE.MeshLambertMaterial
      mat.color.setHex(color)
      mat.emissive.setHex(color)
      mat.emissiveIntensity = 1.0
    }

    const [wx, wy] = gameToWorld(player.pos.x, player.pos.y)
    mesh.userData.wx = wx
    mesh.userData.wy = wy
  }

  for (const [id, mesh] of indicatorMeshes) {
    if (!controlledIds.has(id)) {
      scene.remove(mesh)
      indicatorMeshes.delete(id)
    }
  }
}

// ─── Render loop ──────────────────────────────────────────────────────────────

let lastRenderTime = 0

function renderLoop(): void {
  animFrameId = requestAnimationFrame(renderLoop)
  if (!renderer || !scene || !camera) return

  const now = performance.now()
  const dt = lastRenderTime ? Math.min((now - lastRenderTime) / 1000, 0.05) : 0.016
  lastRenderTime = now

  if (latestState) {
    syncBall(latestState)
    rollBall(latestState, dt)
    tickCamera(camera, latestState)
  }

  // Bob indicators every frame for smooth animation
  const bobZ = 5.2 + Math.sin(now * 0.004) * 0.55
  for (const mesh of indicatorMeshes.values()) {
    mesh.position.set(mesh.userData.wx, mesh.userData.wy, bobZ)
  }

  // Running animation — visible from top-down camera via Z-bobbing + leg lift
  if (latestState) {
    for (const player of latestState.players) {
      const mesh = playerMeshes.get(player.id)
      if (!mesh) continue
      const { lArmPivot, rArmPivot, lLegPivot, rLegPivot } = mesh.userData
      if (!lLegPivot) continue

      if (player.stunTimer > 0) {
        mesh.position.z = 0
        lLegPivot.position.z = 2.2; rLegPivot.position.z = 2.2
        if (lArmPivot) { lArmPivot.rotation.x = 0; rArmPivot.rotation.x = 0 }
      } else {
        const speed = Math.sqrt(player.vel.x ** 2 + player.vel.y ** 2)
        const amp = Math.min(speed / 13, 1)
        const t = now * (0.006 + amp * 0.010)

        // Body bounce (up/down, clearly visible from above)
        mesh.position.z = amp * Math.abs(Math.sin(t)) * 0.35

        // Alternate leg lift — one goes up while other stays down
        const phase = Math.sin(t)
        lLegPivot.position.z = 2.2 + (phase > 0 ? phase * amp * 0.9 : 0)
        rLegPivot.position.z = 2.2 + (phase < 0 ? -phase * amp * 0.9 : 0)

        // Arm counter-swing (rotation.x, adds subtle depth motion)
        if (lArmPivot) {
          lArmPivot.rotation.x = phase * amp * 0.45
          rArmPivot.rotation.x = -phase * amp * 0.45
        }
      }
    }
  }

  renderer.render(scene, camera)
}

function rollBall(state: GameState, dt: number): void {
  if (!ballMesh) return
  const vel = state.ball.ownerId !== null
    ? (state.players.find(p => p.id === state.ball.ownerId)?.vel ?? { x: 0, y: 0 })
    : state.ball.vel
  const speed = Math.sqrt(vel.x ** 2 + vel.y ** 2)
  if (speed < 0.2) return

  const radius = 0.7
  const angle = (speed / radius) * dt
  // Rotation axis: perpendicular to velocity direction in the XY ground plane
  const axisX = -vel.y / speed
  const axisY = vel.x / speed
  const halfAngle = angle * 0.5
  const sinH = Math.sin(halfAngle)
  const q = new THREE.Quaternion(axisX * sinH, axisY * sinH, 0, Math.cos(halfAngle))
  ballMesh.quaternion.multiply(q)
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

let pinchDist0 = 0

function getTouchDist(e: TouchEvent): number {
  const dx = e.touches[0].clientX - e.touches[1].clientX
  const dy = e.touches[0].clientY - e.touches[1].clientY
  return Math.sqrt(dx * dx + dy * dy)
}

function onTouchStart(e: TouchEvent): void {
  if (e.touches.length === 2) pinchDist0 = getTouchDist(e)
}

function onTouchMove(e: TouchEvent): void {
  if (e.touches.length !== 2 || !camera || pinchDist0 === 0) return
  e.preventDefault()
  const dist = getTouchDist(e)
  const delta = pinchDist0 - dist
  camera.fov = Math.max(25, Math.min(80, camera.fov + delta * 0.05))
  camera.updateProjectionMatrix()
  pinchDist0 = dist
}
