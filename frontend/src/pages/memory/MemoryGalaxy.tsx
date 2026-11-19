import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { MemoryItem } from '../../api/client'
import { AppIcon } from '../../components/AppIcon'
import { time } from './model'

export type GalaxyCluster = {
  id: string
  name: string
  avatar?: string | null
  items: MemoryItem[]
  /** 创建顺序：决定谁进入中心轨道，以及外围星星的分布顺序。 */
  order?: number
  /** 共享记忆不是 Agent，不占中心轨道名额。 */
  isAgent?: boolean
}

type Props = {
  clusters: GalaxyCluster[]
  matchingIds: ReadonlySet<number> | null
  dueIds: ReadonlySet<number>
  focus: string | null
  onFocus: (id: string | null) => void
  onOpen: (item: MemoryItem) => void
}

/* ============================== 3D 场景参数 ============================== */

/** 中心轨道最多 5 位 Agent；同轨共用同一个角速度。 */
const ORBIT_CAPACITY = 5
const ORBIT_SPEED = 0.12
/** 超过中心轨道的 Agent 停在四周的固定 3D 坐标，像星星一样不公转。 */
const STAR_ORBIT_RADIUS = 1.75
const FOV = 45
/** 俯视角：相机绕 Y 轴左倾 15°，从大约 57° 仰角俯视。 */
const VIEW_PHI = THREE.MathUtils.degToRad(58)
const VIEW_THETA = THREE.MathUtils.degToRad(-15)
const VIEW_OFFSET_X = 0.018
const VIEW_OFFSET_Y = -0.012
/** Agent 头像纹理与圆心的相对位置。 */
const AGENT_TEX_W = 768
const AGENT_TEX_H = 540
const AGENT_AVATAR_PX = 300
const AGENT_AVATAR_CY = 370

const WEIGHT_RADIUS = [11.2, 13.0, 14.8, 16.6]
const MIN_RADIUS = 10.9
const PALETTE = {
  fg: '#ecf1ee', muted: '#9caeaa',
  brand: '#c8ff8a', info: '#80d8ff', extra: '#cbb2ff', faint: '#a8bcb2', warn: '#f5be69',
}

function hash(n: number) {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

/** 展示用权重：固定 / 用户画像 / 全局规则最内，其次 L1·L4，再是普通 L2，最后临时材料。 */
function weightOf(item: MemoryItem) {
  if (item.pinned || item.scope === 'directive' || item.scope === 'open_issue') return 0
  if (item.owner === 'USER' && item.domain === 'USER_PROFILE') return 0
  if (item.layer === 'L1' || item.layer === 'L4') return 1
  if (item.layer === 'L3' || item.scope === 'episode' || item.retention === 'ephemeral') return 3
  return 2
}

function colorRgba(hex: string, alpha: number) {
  const value = hex.replace('#', '')
  const full = value.length === 3 ? value.split('').map(ch => ch + ch).join('') : value
  const n = Number.parseInt(full, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/** 用同一套权重决定外围星星的轻量轨道半径。 */
function orbitRadiusOf(item: MemoryItem, index: number, total: number, ring: number) {
  const base = WEIGHT_RADIUS[weightOf(item)]
  const age = total > 1 ? index / (total - 1) : 0
  const relative = Math.max(MIN_RADIUS, base - 1.2 * age) + (hash(item.id) - 0.5) * 0.6
  return relative / 14 * ring * 0.25
}

/* ============================== 纹理绘制 ============================== */

function makeCanvas(w: number, h: number) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  return canvas
}

function paintAgentCanvas(
  canvas: HTMLCanvasElement,
  cluster: GalaxyCluster,
  color: string,
  image: HTMLImageElement | null,
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  const cx = w / 2
  const cy = AGENT_AVATAR_CY
  const r = AGENT_AVATAR_PX / 2
  ctx.clearRect(0, 0, w, h)

  /* 外圈光晕。 */
  const halo = ctx.createRadialGradient(cx, cy, r * 0.55, cx, cy, r * 1.55)
  halo.addColorStop(0, colorRgba(color, 0.36))
  halo.addColorStop(1, colorRgba(color, 0))
  ctx.fillStyle = halo
  ctx.beginPath()
  ctx.arc(cx, cy, r * 1.55, 0, Math.PI * 2)
  ctx.fill()

  /* 头像本体。 */
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.clip()
  if (image && image.complete && image.naturalWidth > 0) {
    const cover = Math.max((r * 2) / image.naturalWidth, (r * 2) / image.naturalHeight)
    const dw = image.naturalWidth * cover
    const dh = image.naturalHeight * cover
    ctx.drawImage(image, cx - dw / 2, cy - dh / 2, dw, dh)
  } else {
    ctx.fillStyle = colorRgba(color, 0.2)
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
    ctx.fillStyle = PALETTE.fg
    ctx.font = `600 ${r * 1.05}px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(([...cluster.name.trim()][0] ?? '?').toUpperCase(), cx, cy + 4)
  }
  ctx.restore()

  /* 头像描边。 */
  ctx.lineWidth = 10
  ctx.strokeStyle = color
  ctx.beginPath()
  ctx.arc(cx, cy, r - 5, 0, Math.PI * 2)
  ctx.stroke()
  ctx.lineWidth = 4
  ctx.strokeStyle = 'rgba(0,0,0,.55)'
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()

  /* 数量角标。 */
  const count = cluster.items.length
  if (count > 0) {
    const br = 42
    const bx = cx + r * 0.68
    const by = cy + r * 0.72
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(bx, by, br, 0, Math.PI * 2)
    ctx.fill()
    ctx.lineWidth = 8
    ctx.strokeStyle = '#101719'
    ctx.beginPath()
    ctx.arc(bx, by, br, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = '#101719'
    ctx.font = '600 42px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(count), bx, by + 1)
  }

  /* 名字胶囊。 */
  const fontSize = 86
  ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const maxLabelWidth = w - 40
  let label = cluster.name
  while (label.length > 1 && ctx.measureText(label).width > maxLabelWidth - 56) label = label.slice(0, -1)
  if (label !== cluster.name) label = `${label.slice(0, -1)}…`
  const textWidth = ctx.measureText(label).width
  const pillW = Math.min(maxLabelWidth, textWidth + 64)
  const pillH = 112
  const pillY = 92
  ctx.fillStyle = 'rgba(15, 23, 25, .92)'
  ctx.strokeStyle = 'rgba(91, 115, 107, .9)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.roundRect(cx - pillW / 2, pillY - pillH / 2, pillW, pillH, pillH / 2)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = PALETTE.fg
  ctx.fillText(label, cx, pillY + 2)
}

function makeAgentSprite(cluster: GalaxyCluster, color: string, avatarWorld: number) {
  const canvas = makeCanvas(AGENT_TEX_W, AGENT_TEX_H)
  paintAgentCanvas(canvas, cluster, color, null)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.needsUpdate = true
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
  })
  const sprite = new THREE.Sprite(material)
  const scale = avatarWorld / AGENT_AVATAR_PX
  sprite.scale.set(AGENT_TEX_W * scale, AGENT_TEX_H * scale, 1)
  sprite.center.set(0.5, (AGENT_TEX_H - AGENT_AVATAR_CY) / AGENT_TEX_H)
  sprite.renderOrder = 20
  return { sprite, material, texture, canvas }
}

function makeRadialTexture(stops: [number, string][], size = 512, power = 1) {
  const canvas = makeCanvas(size, size)
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    for (const [at, color] of stops) g.addColorStop(Math.pow(at, power), color)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}

function makeRingTexture(color: string, alpha: number, inner = 0.74, outer = 0.84) {
  const size = 512
  const canvas = makeCanvas(size, size)
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const c = size / 2
    const g = ctx.createRadialGradient(c, c, 0, c, c, c)
    g.addColorStop(0, colorRgba(color, 0))
    g.addColorStop(inner, colorRgba(color, 0))
    g.addColorStop((inner + outer) / 2, colorRgba(color, alpha))
    g.addColorStop(outer, colorRgba(color, 0))
    g.addColorStop(1, colorRgba(color, 0))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}

/** 吸积盘纹理：暖色内缘、品牌色中部、蓝色外缘，带旋转亮条纹。 */
function makeDiskTexture() {
  const size = 1024
  const canvas = makeCanvas(size, size)
  const ctx = canvas.getContext('2d')
  if (!ctx) return new THREE.CanvasTexture(canvas)
  const c = size / 2
  const outer = size * 0.44
  const inner = outer * 0.18
  ctx.clearRect(0, 0, size, size)
  ctx.save()
  ctx.translate(c, c)
  const fill = ctx.createRadialGradient(0, 0, inner, 0, 0, outer)
  fill.addColorStop(0, 'rgba(8, 10, 12, .62)')
  fill.addColorStop(0.24, 'rgba(14, 16, 18, .45)')
  fill.addColorStop(0.5, colorRgba(PALETTE.brand, 0.09))
  fill.addColorStop(0.8, colorRgba(PALETTE.info, 0.055))
  fill.addColorStop(1, colorRgba(PALETTE.info, 0))
  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.arc(0, 0, outer, 0, Math.PI * 2)
  ctx.arc(0, 0, inner, 0, Math.PI * 2, true)
  ctx.fill()
  /* 内缘亮环，近侧会真实地压在黑洞球体前面。 */
  ctx.globalCompositeOperation = 'lighter'
  ctx.strokeStyle = colorRgba('#ffe6bf', 0.82)
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.arc(0, 0, inner + 1.5, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = colorRgba(PALETTE.brand, 0.38)
  ctx.lineWidth = 12
  ctx.beginPath()
  ctx.arc(0, 0, inner + 10, 0, Math.PI * 2)
  ctx.stroke()
  /* 窄的暗缝，让吸积盘有层次而不是一张均匀的圆饼。 */
  ctx.globalCompositeOperation = 'destination-out'
  for (let i = 0; i < 7; i++) {
    const radius = inner + (outer - inner) * (0.12 + i * 0.12 + hash(i + 4.2) * 0.03)
    ctx.strokeStyle = 'rgba(0,0,0,.35)'
    ctx.lineWidth = 1.5 + hash(i + 2.5) * 4
    ctx.beginPath()
    ctx.arc(0, 0, radius, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 90; i++) {
    const t = i / 89
    const radius = inner + (outer - inner) * t
    const alpha = (0.22 * Math.pow(1 - t, 0.7) + 0.025) * (0.7 + hash(i + 9.1) * 0.6)
    const color = t < 0.38 ? '#fff0c8' : t < 0.7 ? PALETTE.warn : PALETTE.info
    ctx.strokeStyle = colorRgba(color, alpha)
    ctx.lineWidth = 1.2 + (1 - t) * 2.6
    ctx.beginPath()
    ctx.arc(0, 0, radius, 0, Math.PI * 2)
    ctx.stroke()
  }
  /* 几条更亮的物质流，旋转盘子时会看得出来。 */
  for (let s = 0; s < 7; s++) {
    const radius = inner + (outer - inner) * (0.18 + hash(s + 3.3) * 0.68)
    const start = hash(s + 8.8) * Math.PI * 2
    const span = 0.28 + hash(s + 2.2) * 0.55
    ctx.strokeStyle = colorRgba(s < 3 ? '#fff5dd' : PALETTE.brand, 0.42)
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(0, 0, radius, start, start + span)
    ctx.stroke()
  }
  ctx.restore()
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.anisotropy = 4
  texture.needsUpdate = true
  return texture
}

/* ============================== 场景对象 ============================== */

type AgentPlan = {
  cluster: GalaxyCluster
  orbit: boolean
  radius: number
  angle: number
  speed: number
  fixed: THREE.Vector3 | null
  world: THREE.Vector3
  color: string
  sprite: THREE.Sprite
  material: THREE.SpriteMaterial
  texture: THREE.CanvasTexture
  canvas: HTMLCanvasElement
  avatarWorld: number
  dots: DotPlan[]
}

type DotPlan = {
  item: MemoryItem
  agentIndex: number
  agentName: string
  color: string
  radius: number
  angle: number
  speed: number
  tilt: number
  age: number
  world: THREE.Vector3
  alpha: number
  index: number
}

type Engine = {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  content: THREE.Group
  raycaster: THREE.Raycaster
  agents: AgentPlan[]
  dots: DotPlan[]
  points: THREE.Points | null
  dotGeometry: THREE.BufferGeometry | null
  dotMaterial: THREE.ShaderMaterial | null
  dotPositions: Float32Array
  dotColors: Float32Array
  dotAlphas: Float32Array
  dotSizes: Float32Array
  blackHoleSphere: THREE.Mesh | null
  blackHoleDisk: THREE.Mesh | null
  blackHoleSpin: THREE.Group | null
  hoverRing: THREE.Sprite | null
  focusRing: THREE.Sprite | null
  disposables: (() => void)[]
  ring: number
  width: number
  height: number
  userMoved: boolean
}

type Spot = { item: MemoryItem; x: number; y: number; agentName: string; color: string }

const DOT_VERTEX = `
attribute vec3 aColor;
attribute float aAlpha;
attribute float aSize;
varying vec3 vColor;
varying float vAlpha;
uniform float uPixelRatio;
uniform float uHeight;
uniform float uFovTan;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (uHeight / (2.0 * uFovTan)) / max(-mv.z, 0.001) * uPixelRatio;
  gl_Position = projectionMatrix * mv;
}
`

const DOT_FRAGMENT = `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 p = gl_PointCoord - vec2(0.5);
  float d = length(p);
  if (d > 0.5) discard;
  float edge = 1.0 - smoothstep(0.40, 0.5, d);
  gl_FragColor = vec4(vColor, vAlpha * edge);
  #include <colorspace_fragment>
}
`

export default function MemoryGalaxy({ clusters, matchingIds, dueIds, focus, onFocus, onOpen }: Props) {
  const stageRef = useRef<HTMLDivElement>(null)
  const mountRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<Engine | null>(null)
  const [hover, setHover] = useState<Spot | null>(null)
  const [picked, setPicked] = useState<Spot | null>(null)
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 })
  const [unavailable, setUnavailable] = useState(false)
  const [paused, setPaused] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const matchingRef = useRef(matchingIds)
  const focusRef = useRef(focus)
  const pausedRef = useRef(paused)
  const onOpenRef = useRef(onOpen)
  const onFocusRef = useRef(onFocus)
  const hoverIdRef = useRef<number | null>(null)
  const pickedIdRef = useRef<number | null>(null)
  const pressedRef = useRef(false)
  const pointerStart = useRef<{ x: number; y: number } | null>(null)
  const movedRef = useRef(false)
  const hoverFrame = useRef(0)
  const orbitClock = useRef(0)
  const avatarCache = useRef(new Map<string, HTMLImageElement>())
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = (event: MediaQueryListEvent) => setPaused(event.matches)
    preference.addEventListener('change', sync)
    return () => preference.removeEventListener('change', sync)
  }, [])
  useEffect(() => {
    matchingRef.current = matchingIds
    focusRef.current = focus
    pausedRef.current = paused
  }, [matchingIds, focus, paused])
  useEffect(() => {
    onOpenRef.current = onOpen
    onFocusRef.current = onFocus
  }, [onOpen, onFocus])
  useEffect(() => {
    hoverIdRef.current = hover?.item.id ?? null
  }, [hover])
  useEffect(() => {
    pickedIdRef.current = picked?.item.id ?? null
  }, [picked])

  /* ============================ 初始化 WebGL ============================ */
  useEffect(() => {
    const mount = mountRef.current
    const stage = stageRef.current
    if (!mount || !stage) return

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    } catch {
      // oxlint-disable-next-line react/set-state-in-effect -- 画布初始化失败时显示占位。
      setUnavailable(true)
      return
    }
    const canvas = renderer.domElement
    const contextLost = () => setUnavailable(true)
    const contextRestored = () => setUnavailable(false)
    canvas.addEventListener('webglcontextlost', contextLost)
    canvas.addEventListener('webglcontextrestored', contextRestored)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setClearColor(0x000000, 0)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    mount.appendChild(canvas)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 4000)
    const content = new THREE.Group()
    scene.add(content)
    const controls = new OrbitControls(camera, canvas)
    controls.enablePan = false
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.rotateSpeed = 0.7
    controls.zoomSpeed = 0.8
    controls.minPolarAngle = THREE.MathUtils.degToRad(18)
    controls.maxPolarAngle = THREE.MathUtils.degToRad(78)
    controls.target.set(0, 0, 0)

    const engine: Engine = {
      renderer, scene, camera, controls, content,
      raycaster: new THREE.Raycaster(),
      agents: [], dots: [], points: null, dotGeometry: null, dotMaterial: null,
      dotPositions: new Float32Array(0), dotColors: new Float32Array(0),
      dotAlphas: new Float32Array(0), dotSizes: new Float32Array(0),
      blackHoleSphere: null, blackHoleDisk: null, blackHoleSpin: null, hoverRing: null, focusRing: null,
      disposables: [], ring: 34, width: 1, height: 1, userMoved: false,
    }
    engineRef.current = engine

    const resize = () => {
      const width = Math.max(1, stage.clientWidth)
      const height = Math.max(1, stage.clientHeight)
      engine.width = width
      engine.height = height
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.setViewOffset(width, height, width * VIEW_OFFSET_X, height * VIEW_OFFSET_Y, width, height)
      camera.updateProjectionMatrix()
      setStageSize(previous => previous.width === width && previous.height === height ? previous : { width, height })
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(stage)

    controls.addEventListener('start', () => { engine.userMoved = true })

    let frame = 0
    let last = performance.now()
    const render = (now: number) => {
      frame = requestAnimationFrame(render)
      const dt = Math.min(0.06, Math.max(0, (now - last) / 1000))
      last = now
      const pointing = pressedRef.current || hoverIdRef.current != null || pickedIdRef.current != null
      if (!pausedRef.current && !pointing) orbitClock.current += dt
      updateScene(engine, orbitClock.current, {
        matchingIds: matchingRef.current,
        focus: focusRef.current,
        hoverId: hoverIdRef.current,
        pickedId: pickedIdRef.current,
      })
      controls.update()
      renderer.render(scene, camera)
    }
    frame = requestAnimationFrame(render)

    return () => {
      cancelAnimationFrame(frame)
      cancelAnimationFrame(hoverFrame.current)
      hoverFrame.current = 0
      observer.disconnect()
      canvas.removeEventListener('webglcontextlost', contextLost)
      canvas.removeEventListener('webglcontextrestored', contextRestored)
      clearContent(engine)
      controls.dispose()
      renderer.dispose()
      renderer.domElement.remove()
      engineRef.current = null
    }
  }, [])

  /* ============================ 构建 / 重建场景 ============================ */
  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    clearContent(engine)
    const ordered = [...clusters].sort((a, b) => {
      const aa = a.isAgent ?? a.id !== 'shared'
      const bb = b.isAgent ?? b.id !== 'shared'
      if (aa !== bb) return aa ? -1 : 1
      return (a.order ?? 0) - (b.order ?? 0)
    })
    const agentClusters = ordered.filter(c => c.isAgent ?? c.id !== 'shared')
    const orbitClusters = agentClusters.slice(0, ORBIT_CAPACITY)
    const stars = [...agentClusters.slice(ORBIT_CAPACITY), ...ordered.filter(c => !(c.isAgent ?? c.id !== 'shared'))]
    const orbitCount = Math.max(1, orbitClusters.length)
    const ring = Math.min(64, Math.max(34, orbitCount * 12))

    /* 中心轨道外的 Agent 使用固定 3D 坐标，像背景星星一样不公转。 */
    const starPoints = stars.map((cluster, index) => {
      const seed = [...cluster.id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0)
      const angle = -0.8 + index * 2.399963 + hash(seed + 2.1) * 0.55
      const radius = ring * (STAR_ORBIT_RADIUS + hash(seed + 5.7) * 0.22)
      const y = (hash(seed + 9.2) - 0.5) * ring * 0.38
      return new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius)
    })

    const maxStarRadius = starPoints.reduce((max, p) => Math.max(max, Math.hypot(p.x, p.z)), ring)
    const avatarWorld = ring * 0.26
    const dotOrbit = avatarWorld * 1.15
    const fitRadius = maxStarRadius + dotOrbit * 1.15 + avatarWorld * 0.6
    engine.ring = ring

    /* 黑洞。 */
    buildBlackHole(engine, ring)

    /* 真实 3D 的星环轨道线，给中心轨道一个可读的几何参照。 */
    const orbitPoints: THREE.Vector3[] = []
    for (let i = 0; i < 160; i++) {
      const angle = (i / 160) * Math.PI * 2
      orbitPoints.push(new THREE.Vector3(Math.cos(angle) * ring, 0, Math.sin(angle) * ring))
    }
    const orbitGeometry = new THREE.BufferGeometry().setFromPoints(orbitPoints)
    const orbitMaterial = new THREE.LineBasicMaterial({
      color: new THREE.Color(PALETTE.muted),
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
    })
    const orbitLine = new THREE.LineLoop(orbitGeometry, orbitMaterial)
    orbitLine.renderOrder = 5
    engine.content.add(orbitLine)
    engine.disposables.push(() => {
      engine.content.remove(orbitLine)
      orbitGeometry.dispose()
      orbitMaterial.dispose()
    })

    /* Agent 与卫星。 */
    const agents: AgentPlan[] = []
    const dots: DotPlan[] = []
    agents.length = 0
    const addAgent = (cluster: GalaxyCluster, role: 'orbit' | 'star', index: number, fixed: THREE.Vector3 | null) => {
      const color = cluster.id === 'shared'
        ? PALETTE.muted
        : [PALETTE.brand, PALETTE.info, PALETTE.extra, PALETTE.warn][index % 4]
      const { sprite, material, texture, canvas } = makeAgentSprite(cluster, color, avatarWorld)
      if (cluster.avatar) {
        const cached = avatarCache.current.get(cluster.avatar)
        if (cached) {
          paintAgentCanvas(canvas, cluster, color, cached)
          texture.needsUpdate = true
        } else {
          const image = new Image()
          image.onload = () => {
            if (!sprite.parent) return
            avatarCache.current.set(cluster.avatar!, image)
            paintAgentCanvas(canvas, cluster, color, image)
            texture.needsUpdate = true
          }
          image.src = cluster.avatar
        }
      }
      const angle = role === 'orbit' ? -Math.PI / 2 + (index / orbitCount) * Math.PI * 2 : 0
      const world = role === 'orbit'
        ? new THREE.Vector3(Math.cos(angle) * ring, 0, Math.sin(angle) * ring)
        : fixed!.clone()
      sprite.position.copy(world)
      engine.content.add(sprite)
      engine.disposables.push(() => {
        engine.content.remove(sprite)
        material.dispose()
        texture.dispose()
      })
      const agent: AgentPlan = {
        cluster,
        orbit: role === 'orbit',
        radius: ring,
        angle,
        speed: role === 'orbit' ? ORBIT_SPEED : 0,
        fixed,
        world,
        color,
        sprite,
        material,
        texture,
        canvas,
        avatarWorld,
        dots: [],
      }
      agents.push(agent)

      const direction = hash([...cluster.id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) + 1.7) > 0.5 ? 1 : -1
      const tilt = 0.18 + ([...cluster.id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 3) * 0.12
      const total = cluster.items.length
      cluster.items.forEach((item, itemIndex) => {
        const age = total > 1 ? itemIndex / (total - 1) : 0
        const orbit = orbitRadiusOf(item, itemIndex, total, ring)
        const dot: DotPlan = {
          item,
          agentIndex: agents.length - 1,
          agentName: cluster.name,
          color: dueIds.has(item.id) ? PALETTE.warn : cluster.id === 'shared' ? PALETTE.muted : [PALETTE.brand, PALETTE.info, PALETTE.extra, PALETTE.faint][itemIndex % 4],
          radius: orbit,
          angle: (itemIndex / Math.max(1, total)) * Math.PI * 2 + (hash(item.id * 3.7 + 1) - 0.5) * 0.9,
          speed: direction * (0.22 + 0.2 * hash(item.id * 7.31)),
          tilt,
          age,
          world: new THREE.Vector3(),
          alpha: 1,
          index: dots.length,
        }
        dots.push(dot)
        agent.dots.push(dot)
      })
    }

    orbitClusters.forEach((cluster, index) => addAgent(cluster, 'orbit', index, null))
    stars.forEach((cluster, index) => addAgent(cluster, 'star', orbitClusters.length + index, starPoints[index]))

    /* 一个 Points 网格承载所有记忆点，位置/颜色/透明度逐帧更新。 */
    const dotGeometry = new THREE.BufferGeometry()
    const positions = new Float32Array(dots.length * 3)
    const colors = new Float32Array(dots.length * 3)
    const alphas = new Float32Array(dots.length)
    const sizes = new Float32Array(dots.length)
    const color = new THREE.Color()
    dots.forEach((dot, index) => {
      color.set(dot.color)
      colors[index * 3] = color.r
      colors[index * 3 + 1] = color.g
      colors[index * 3 + 2] = color.b
      alphas[index] = dot.alpha
      sizes[index] = ring * 0.04
    })
    dotGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    dotGeometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3))
    dotGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1))
    dotGeometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
    dotGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), fitRadius)
    const dotMaterial = new THREE.ShaderMaterial({
      vertexShader: DOT_VERTEX,
      fragmentShader: DOT_FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      uniforms: {
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
        uHeight: { value: engine.height },
        uFovTan: { value: Math.tan(THREE.MathUtils.degToRad(FOV / 2)) },
      },
    })
    const points = new THREE.Points(dotGeometry, dotMaterial)
    points.frustumCulled = false
    points.renderOrder = 30
    engine.content.add(points)
    engine.points = points
    engine.dotGeometry = dotGeometry
    engine.dotMaterial = dotMaterial
    engine.dotPositions = positions
    engine.dotColors = colors
    engine.dotAlphas = alphas
    engine.dotSizes = sizes
    engine.disposables.push(() => {
      engine.content.remove(points)
      dotGeometry.dispose()
      dotMaterial.dispose()
    })

    /* hover / focus 光圈。 */
    const hoverTexture = makeRingTexture(PALETTE.fg, 0.85, 0.58, 0.82)
    const hoverMaterial = new THREE.SpriteMaterial({ map: hoverTexture, transparent: true, depthWrite: false, depthTest: true, toneMapped: false })
    const hoverRing = new THREE.Sprite(hoverMaterial)
    hoverRing.visible = false
    hoverRing.renderOrder = 32
    engine.content.add(hoverRing)
    engine.hoverRing = hoverRing
    engine.disposables.push(() => { hoverMaterial.dispose(); hoverTexture.dispose() })

    const focusTexture = makeRingTexture(PALETTE.warn, 0.8, 0.7, 0.86)
    const focusMaterial = new THREE.SpriteMaterial({ map: focusTexture, transparent: true, depthWrite: false, depthTest: true, toneMapped: false })
    const focusRing = new THREE.Sprite(focusMaterial)
    focusRing.visible = false
    focusRing.renderOrder = 11
    engine.content.add(focusRing)
    engine.focusRing = focusRing
    engine.disposables.push(() => { focusMaterial.dispose(); focusTexture.dispose() })

    engine.agents = agents
    engine.dots = dots
    if (engine.dotMaterial) {
      engine.dotMaterial.uniforms.uHeight.value = engine.height
      engine.dotMaterial.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio || 1, 2)
    }

    /* 按布局设置默认相机，只在新布局首次出现时执行。 */
    if (!engine.userMoved || engine.agents.length === 0) fitCamera(engine)
    // 重建后确保每个点立即有位置，避免第一帧堆在原点。
    updateScene(engine, orbitClock.current, {
      matchingIds: matchingRef.current,
      focus: focusRef.current,
      hoverId: hoverIdRef.current,
      pickedId: pickedIdRef.current,
    })
    // 测试/开发时暴露只读场景数据；生产构建不会启用。
    if (import.meta.env.DEV || import.meta.env.VITE_MEMORY_DEBUG === 'true') {
      ;(window as unknown as { __memGalaxy?: unknown }).__memGalaxy = {
        engine,
        pickAt: (clientX: number, clientY: number) => pickAt(engine, clientX, clientY),
        project: (world: THREE.Vector3) => projectWorld(engine, world),
        fit: () => { fitCamera(engine); return engine.camera.position.length() },
        orbitClock,
      }
    }
  }, [clusters, dueIds])

  /* 尺寸变化时同步渲染器、相机和相机取景。 */
  useEffect(() => {
    const engine = engineRef.current
    if (!engine || !stageSize.width || !stageSize.height) return
    engine.width = stageSize.width
    engine.height = stageSize.height
    engine.renderer.setSize(stageSize.width, stageSize.height, false)
    engine.camera.aspect = stageSize.width / stageSize.height
    engine.camera.setViewOffset(stageSize.width, stageSize.height, stageSize.width * VIEW_OFFSET_X, stageSize.height * VIEW_OFFSET_Y, stageSize.width, stageSize.height)
    engine.camera.updateProjectionMatrix()
    if (engine.dotMaterial) {
      engine.dotMaterial.uniforms.uHeight.value = stageSize.height
      engine.dotMaterial.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio || 1, 2)
    }
    if (!engine.userMoved) fitCamera(engine)
  }, [stageSize])

  /* ============================ 面板与悬停 ============================ */
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel || !picked) return
    const stage = stageRef.current?.getBoundingClientRect()
    if (!stage) return
    const panelWidth = panel.offsetWidth
    const panelHeight = panel.offsetHeight
    let left = picked.x + 16
    if (left + panelWidth > stage.width - 10) left = picked.x - panelWidth - 16
    left = clamp(left, 10, Math.max(10, stage.width - panelWidth - 10))
    const top = clamp(picked.y - panelHeight / 2, 10, Math.max(10, stage.height - panelHeight - 10))
    panel.style.left = `${left}px`
    panel.style.top = `${top}px`
  }, [picked, stageSize])

  useEffect(() => {
    if (!picked) return
    panelRef.current?.focus({ preventScroll: true })
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && panelRef.current?.contains(event.target)) return
      setPicked(null)
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPicked(null)
    }
    document.addEventListener('pointerdown', close, true)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', close, true)
      document.removeEventListener('keydown', key)
    }
  }, [picked])

  const clearHover = () => {
    if (hoverFrame.current) {
      cancelAnimationFrame(hoverFrame.current)
      hoverFrame.current = 0
    }
    setHover(null)
    const stage = stageRef.current
    if (stage) stage.style.cursor = 'grab'
  }

  const moveHover = (clientX: number, clientY: number) => {
    const engine = engineRef.current
    if (!engine) return
    if (picked) {
      clearHover()
      return
    }
    const hit = pickAt(engine, clientX, clientY)
    const stage = stageRef.current
    if (stage) stage.style.cursor = hit ? 'pointer' : 'grab'
    if (!hit || hit.kind !== 'dot') {
      setHover(null)
      return
    }
    setHover({
      item: hit.dot.item,
      x: hit.screenX,
      y: hit.screenY,
      agentName: hit.dot.agentName,
      color: hit.dot.color,
    })
  }

  const openDetails = () => {
    if (!picked) return
    const item = picked.item
    setPicked(null)
    onOpenRef.current(item)
  }

  const onClick = (clientX: number, clientY: number) => {
    const engine = engineRef.current
    if (!engine) return
    const hit = pickAt(engine, clientX, clientY)
    setHover(null)
    if (!hit) {
      setPicked(null)
      return
    }
    if (hit.kind === 'agent') {
      setPicked(null)
      onFocusRef.current(focusRef.current === hit.agent.cluster.id ? null : hit.agent.cluster.id)
      return
    }
    setPicked({
      item: hit.dot.item,
      x: hit.screenX,
      y: hit.screenY,
      agentName: hit.dot.agentName,
      color: hit.dot.color,
    })
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointerStart.current = { x: event.clientX, y: event.clientY }
    movedRef.current = false
    pressedRef.current = true
    const stage = stageRef.current
    if (stage) stage.style.cursor = 'grabbing'
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = pointerStart.current
    if (start) {
      const dx = event.clientX - start.x
      const dy = event.clientY - start.y
      if (dx * dx + dy * dy > 36) movedRef.current = true
    }
    const x = event.clientX
    const y = event.clientY
    if (hoverFrame.current) return
    hoverFrame.current = requestAnimationFrame(() => {
      hoverFrame.current = 0
      moveHover(x, y)
    })
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const startedOnCanvas = pointerStart.current != null
    pointerStart.current = null
    pressedRef.current = false
    const stage = stageRef.current
    if (stage) stage.style.cursor = hover ? 'pointer' : 'grab'
    if (startedOnCanvas && !movedRef.current) onClick(event.clientX, event.clientY)
  }

  const onPointerLeave = () => {
    pointerStart.current = null
    pressedRef.current = false
    clearHover()
  }

  const stageWidth = stageSize.width
  const stageHeight = stageSize.height
  const tipFlip = hover ? hover.x > stageWidth * 0.58 : false
  const tipStyle: CSSProperties | undefined = hover && stageWidth > 0
    ? {
        left: tipFlip ? Math.max(8, hover.x - 14) : Math.min(hover.x + 14, Math.max(8, stageWidth - 250)),
        top: clamp(hover.y, 34, Math.max(34, stageHeight - 34)),
        transform: tipFlip ? 'translate(-100%, -50%)' : 'translateY(-50%)',
      }
    : undefined

  function zoom(factor: number) {
    const engine = engineRef.current
    if (!engine) return
    const { camera, controls } = engine
    const distance = controls.getDistance()
    const next = clamp(distance * factor, controls.minDistance, controls.maxDistance)
    camera.position.sub(controls.target).multiplyScalar(next / distance).add(controls.target)
    engine.userMoved = true
    controls.update()
  }

  function resetView() {
    const engine = engineRef.current
    if (!engine) return
    const { controls } = engine
    controls.enableDamping = false
    controls.update()
    engine.userMoved = false
    fitCamera(engine)
    controls.enableDamping = true
  }

  return (
    <div
      ref={stageRef}
      className="mem-galaxy-stage mem-galaxy-stage--three"
      role="group"
      aria-label="记忆星云。拖动旋转，滚轮缩放，点击星点查看记忆。"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerLeave}
      onPointerLeave={onPointerLeave}
    >
      <div ref={mountRef} className="mem-galaxy-three" aria-hidden="true" />
      {unavailable ? (
        <div className="mem-galaxy-stage-message" role="status">
          <AppIcon name="graph" size={24} />星云图不可用
        </div>
      ) : (
        <div className="mem-galaxy-view-controls" role="group" aria-label="星云视图控制" onPointerDown={event => event.stopPropagation()} onPointerMove={event => event.stopPropagation()}>
          <button type="button" aria-label="暂停星云动画" aria-pressed={paused} title={paused ? '播放动画' : '暂停动画'} onClick={() => setPaused(value => !value)}><AppIcon name={paused ? 'play' : 'pause'} size={16} /></button>
          <button type="button" aria-label="缩小星云" title="缩小" onClick={() => zoom(1.25)}><AppIcon name="zoom-out" size={17} /></button>
          <button type="button" aria-label="放大星云" title="放大" onClick={() => zoom(0.8)}><AppIcon name="zoom-in" size={17} /></button>
          <button type="button" aria-label="重置星云视角" title="重置视角" onClick={resetView}><AppIcon name="center" size={17} /></button>
        </div>
      )}

      {!unavailable && hover && !picked && tipStyle && (
        <div className="mem-galaxy-tip" style={tipStyle} aria-hidden="true">
          <strong>{hover.item.title || hover.item.body.slice(0, 30) || '未命名记忆'}</strong>
          <span>{hover.agentName}</span>
        </div>
      )}

      {!unavailable && picked && (
        <div
          ref={panelRef}
          className="mem-galaxy-pop"
          role="dialog"
          tabIndex={-1}
          aria-label={`记忆预览：${picked.item.title || '未命名记忆'}`}
          style={{ '--mem-pop-color': picked.color } as CSSProperties}
          onPointerDown={event => event.stopPropagation()}
        >
          <div className="mem-galaxy-pop-head">
            <span className="mem-galaxy-pop-eyebrow">
              <i aria-hidden="true" />
              {picked.agentName} · 记忆 #{picked.item.id}
            </span>
            <button type="button" className="mem-galaxy-pop-close" onClick={() => setPicked(null)} aria-label="关闭记忆预览">
              <AppIcon name="close" size={16} />
            </button>
          </div>
          <h3>{picked.item.title || '未命名记忆'}</h3>
          <p className="mem-galaxy-pop-body">{picked.item.body}</p>
          <p className="mem-galaxy-pop-time">{time(picked.item.createdAt)}{dueIds.has(picked.item.id) && <span> · 即将到期</span>}</p>
          <button type="button" className="mem-galaxy-pop-open" onClick={openDetails}>查看详情<AppIcon name="arrow-right" size={14} /></button>
        </div>
      )}
    </div>
  )
}

/* ============================== 3D 更新 ============================== */

function clearContent(engine: Engine) {
  for (const dispose of engine.disposables) {
    try { dispose() } catch { /* noop */ }
  }
  engine.disposables = []
  while (engine.content.children.length) engine.content.remove(engine.content.children[0])
  engine.agents = []
  engine.dots = []
  engine.points = null
  engine.dotGeometry = null
  engine.dotMaterial = null
  engine.blackHoleSphere = null
  engine.blackHoleDisk = null
  engine.blackHoleSpin = null
  engine.hoverRing = null
  engine.focusRing = null
}

function buildBlackHole(engine: Engine, ring: number) {
  const scale = clamp(ring / 34, 1, 1.9)
  const horizon = 14 * scale
  const diskOuter = 27 * scale
  const group = new THREE.Group()
  engine.content.add(group)
  engine.disposables.push(() => engine.content.remove(group))

  /* 大范围暗色背景光晕：真正 3D Sprite，仍参与深度测试，被黑洞球体遮挡。 */
  const haloTexture = makeRadialTexture([
    [0, colorRgba('#000000', 0.56)],
    [0.42, colorRgba(PALETTE.brand, 0.05)],
    [0.72, colorRgba('#000000', 0.08)],
    [1, colorRgba('#000000', 0)],
  ], 512, 1.2)
  const haloMaterial = new THREE.SpriteMaterial({ map: haloTexture, transparent: true, opacity: 0.68, depthWrite: false, depthTest: true, toneMapped: false })
  const halo = new THREE.Sprite(haloMaterial)
  halo.scale.setScalar(diskOuter * 3.8)
  halo.renderOrder = -1
  group.add(halo)
  engine.disposables.push(() => { haloMaterial.dispose(); haloTexture.dispose() })

  /* 吸积盘：真实 XZ 平面上的圆盘，带深度写入，可遮挡后面的 Agent/记忆点。 */
  const diskTexture = makeDiskTexture()
  const planeSize = diskOuter * 2 / 0.88
  const diskGeometry = new THREE.PlaneGeometry(planeSize, planeSize)
  const diskMaterial = new THREE.MeshBasicMaterial({
    map: diskTexture,
    transparent: true,
    opacity: 0.9,
    depthWrite: true,
    depthTest: true,
    side: THREE.DoubleSide,
    alphaTest: 0.015,
    toneMapped: false,
  })
  const disk = new THREE.Mesh(diskGeometry, diskMaterial)
  disk.rotation.x = -Math.PI / 2
  disk.renderOrder = 1
  const spin = new THREE.Group()
  spin.add(disk)
  group.add(spin)
  engine.blackHoleSpin = spin
  engine.blackHoleDisk = disk
  engine.disposables.push(() => { diskGeometry.dispose(); diskMaterial.dispose(); diskTexture.dispose() })

  /* 事件视界：纯黑球体，是真正的 3D 遮挡体。 */
  const sphereGeometry = new THREE.SphereGeometry(horizon, 64, 64)
  const sphereMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false })
  const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial)
  sphere.renderOrder = 2
  group.add(sphere)
  engine.blackHoleSphere = sphere
  engine.disposables.push(() => { sphereGeometry.dispose(); sphereMaterial.dispose() })

  /* 引力透镜光环。 */
  const lensTexture = makeRingTexture(PALETTE.brand, 0.42, 0.69, 0.83)
  const lensMaterial = new THREE.SpriteMaterial({ map: lensTexture, transparent: true, opacity: 0.52, depthWrite: false, depthTest: true, toneMapped: false })
  const lens = new THREE.Sprite(lensMaterial)
  lens.scale.setScalar(horizon * 2.9)
  lens.renderOrder = 3
  group.add(lens)
  engine.disposables.push(() => { lensMaterial.dispose(); lensTexture.dispose() })

  const photonTexture = makeRingTexture('#fff4d6', 0.78, 0.70, 0.81)
  const photonMaterial = new THREE.SpriteMaterial({ map: photonTexture, transparent: true, opacity: 0.6, depthWrite: false, depthTest: true, toneMapped: false })
  const photon = new THREE.Sprite(photonMaterial)
  photon.scale.setScalar(horizon * 2.2)
  photon.renderOrder = 4
  group.add(photon)
  engine.disposables.push(() => { photonMaterial.dispose(); photonTexture.dispose() })
}

function agentOpacity(agent: AgentPlan, focusId: string | null) {
  return focusId && focusId !== agent.cluster.id ? 0.36 : 1
}

function dotAlpha(dot: DotPlan, matchingIds: ReadonlySet<number> | null) {
  if (matchingIds) return matchingIds.has(dot.item.id) ? 0.98 : 0.06
  return 0.3 + 0.65 * (1 - dot.age)
}

type RuntimeState = {
  matchingIds: ReadonlySet<number> | null
  focus: string | null
  hoverId: number | null
  pickedId: number | null
}

function updateScene(engine: Engine, clock: number, runtime: RuntimeState) {
  const { matchingIds, focus } = runtime

  /* 中心轨道 Agent 共享角速度；外围星星坐标固定。 */
  for (const agent of engine.agents) {
    if (agent.orbit) {
      const angle = agent.angle + clock * agent.speed
      agent.world.set(Math.cos(angle) * agent.radius, 0, Math.sin(angle) * agent.radius)
    } else if (agent.fixed) {
      agent.world.copy(agent.fixed)
    }
    agent.sprite.position.copy(agent.world)
    const opacity = agentOpacity(agent, focus)
    if (agent.material.opacity !== opacity) agent.material.opacity = opacity
  }

  /* 记忆点真实地绕各自 Agent 做 3D 公转。 */
  const dotSize = engine.ring * 0.06
  let index = 0
  for (const dot of engine.dots) {
    const agent = engine.agents[dot.agentIndex]
    if (!agent) continue
    const theta = dot.angle + clock * dot.speed
    const x = Math.cos(theta) * dot.radius
    const y = Math.sin(theta) * dot.radius * Math.sin(dot.tilt)
    const z = Math.sin(theta) * dot.radius * Math.cos(dot.tilt)
    dot.world.set(agent.world.x + x, agent.world.y + y, agent.world.z + z)
    const alpha = dotAlpha(dot, matchingIds)
    dot.alpha = alpha
    engine.dotPositions[index * 3] = dot.world.x
    engine.dotPositions[index * 3 + 1] = dot.world.y
    engine.dotPositions[index * 3 + 2] = dot.world.z
    engine.dotAlphas[index] = alpha
    engine.dotSizes[index] = dotSize * (0.9 + 0.18 * (1 - dot.age))
    index += 1
  }

  if (engine.dotGeometry) {
    const position = engine.dotGeometry.getAttribute('position') as THREE.BufferAttribute
    const alpha = engine.dotGeometry.getAttribute('aAlpha') as THREE.BufferAttribute
    const size = engine.dotGeometry.getAttribute('aSize') as THREE.BufferAttribute
    position.needsUpdate = true
    alpha.needsUpdate = true
    size.needsUpdate = true
    engine.dotGeometry.setDrawRange(0, engine.dots.length)
  }

  if (engine.blackHoleSpin) engine.blackHoleSpin.rotation.y = clock * 0.075

  /* 选中的记忆点光圈。 */
  const activeId = runtime.hoverId ?? runtime.pickedId
  const activeDot = activeId == null ? null : engine.dots.find(dot => dot.item.id === activeId) ?? null
  if (engine.hoverRing) {
    if (activeDot && activeDot.alpha >= 0.12) {
      engine.hoverRing.visible = true
      engine.hoverRing.position.copy(activeDot.world)
      engine.hoverRing.scale.setScalar(engine.ring * 0.16)
      ;(engine.hoverRing.material as THREE.SpriteMaterial).color.set(activeDot.color)
    } else {
      engine.hoverRing.visible = false
    }
  }

  /* focus 光圈跟着 Agent 走。 */
  const focusAgent = focus ? engine.agents.find(agent => agent.cluster.id === focus) ?? null : null
  if (engine.focusRing) {
    if (focusAgent) {
      engine.focusRing.visible = true
      engine.focusRing.position.copy(focusAgent.world)
      engine.focusRing.scale.setScalar(focusAgent.avatarWorld * 1.8)
    } else {
      engine.focusRing.visible = false
    }
  }
}

/* ============================== 拾取与相机 ============================== */

type PickResult =
  | { kind: 'agent'; agent: AgentPlan; screenX: number; screenY: number }
  | { kind: 'dot'; dot: DotPlan; screenX: number; screenY: number }

function projectWorld(engine: Engine, world: THREE.Vector3) {
  const v = world.clone().project(engine.camera)
  return {
    x: (v.x + 1) * 0.5 * engine.width,
    y: (1 - v.y) * 0.5 * engine.height,
  }
}

function pickAt(engine: Engine, clientX: number, clientY: number): PickResult | null {
  const rect = engine.renderer.domElement.getBoundingClientRect()
  const ndc = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  )
  engine.raycaster.setFromCamera(ndc, engine.camera)
  const sphereHit = engine.blackHoleSphere
    ? engine.raycaster.intersectObject(engine.blackHoleSphere, false)[0]
    : undefined
  const limit = sphereHit ? sphereHit.distance : Infinity
  /* 记忆点画在头像层之上，优先命中点，避免透明头像包围盒把点抢走。 */
  if (engine.points) {
    engine.raycaster.params.Points.threshold = Math.max(1.1, engine.ring * 0.055)
    for (const hit of engine.raycaster.intersectObject(engine.points, false)) {
      if (hit.distance >= limit) break
      const dot = hit.index == null ? undefined : engine.dots[hit.index]
      if (dot && dot.alpha >= 0.12) {
        return { kind: 'dot', dot, screenX: clientX - rect.left, screenY: clientY - rect.top }
      }
    }
  }
  let nearest: PickResult | null = null
  let nearestDistance = Infinity
  for (const sprite of engine.agents.map(agent => agent.sprite)) {
    const hit = engine.raycaster.intersectObject(sprite, false)[0]
    if (hit && hit.distance < limit && hit.distance < nearestDistance) {
      const agent = engine.agents.find(candidate => candidate.sprite === sprite)
      if (agent) {
        nearestDistance = hit.distance
        nearest = { kind: 'agent', agent, screenX: clientX - rect.left, screenY: clientY - rect.top }
      }
    }
  }
  return nearest
}

function fitCamera(engine: Engine) {
  const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2))
  const marginX = 0.82
  const marginY = 0.73
  /* 只拟合真实内容：中心轨道圆 + 外围星星；给记忆轨道和标签留边距。 */
  const orbitRadius = engine.ring * 1.2
  const points: THREE.Vector3[] = []
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2
    points.push(new THREE.Vector3(Math.cos(a) * orbitRadius, 0, Math.sin(a) * orbitRadius))
  }
  for (const agent of engine.agents) {
    if (!agent.orbit) points.push(agent.world.clone())
  }
  let distance = orbitRadius / tan * 1.4
  const spherical = new THREE.Spherical()
  for (let pass = 0; pass < 9; pass++) {
    spherical.set(distance, VIEW_PHI, VIEW_THETA)
    engine.camera.position.setFromSpherical(spherical)
    engine.camera.lookAt(0, 0, 0)
    engine.camera.updateMatrixWorld()
    engine.camera.updateProjectionMatrix()
    let maxX = 0
    let maxY = 0
    for (const point of points) {
      const projected = point.clone().project(engine.camera)
      maxX = Math.max(maxX, Math.abs(projected.x))
      maxY = Math.max(maxY, Math.abs(projected.y))
    }
    const correction = Math.max(maxX / marginX, maxY / marginY, 0.65)
    distance *= correction
    if (Math.abs(correction - 1) < 0.015) break
  }
  const finalDistance = distance
  spherical.set(finalDistance, VIEW_PHI, VIEW_THETA)
  engine.camera.position.setFromSpherical(spherical)
  engine.camera.near = Math.max(0.1, finalDistance / 100)
  engine.camera.far = finalDistance * 8
  engine.controls.target.set(0, 0, 0)
  engine.controls.minDistance = finalDistance * 0.35
  engine.controls.maxDistance = finalDistance * 2.4
  engine.camera.setViewOffset(engine.width, engine.height, engine.width * VIEW_OFFSET_X, engine.height * VIEW_OFFSET_Y, engine.width, engine.height)
  engine.camera.updateProjectionMatrix()
  engine.controls.update()
}
