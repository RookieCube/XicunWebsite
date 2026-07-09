import * as THREE from 'three'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

const MODEL_BASE = 'https://cdn.jsdmirror.com/gh/RookieCube/XicunWebsite@main/models/town_hall/'

// MakeUp UltraFast "Shoka" day colors ─ extracted from color_utils.glsl
// ZENITH_DAY_COLOR: vec3(0.10, 0.40, 0.95)  → 0x1a66f2  deep vibrant blue
// HORIZON_DAY_COLOR: vec3(0.65, 0.90, 1.10) → 0xa6e6ff  light cyan-blue
// LIGHT_DAY_COLOR: vec3(0.95, 0.95, 0.90)    → 0xf2f2e6  warm sunlight

const SKY_TOP = new THREE.Color(0x1a66f2)
const SKY_MID = new THREE.Color(0x4a90f8)
const SKY_BOT = new THREE.Color(0xa6e6ff)

const INIT_POS = new THREE.Vector3(-21.58, -6.14, -23.41)
const INIT_LOOK = new THREE.Vector3(-24.15, -4.50, -13.89)

let scene, camera, renderer, modelGroup, skyDome, composer, bloomPass, ssaoPass, lottesPass
let particles = null, particleVelocities = []
let mouseLight = null
let scrollY = 0, prevMouseX = 0, camAngle = 0
let mouseX = 0, mouseY = 0
let entranceT = 0, entranceActive = true, modelReady = false, loaderDone = false
let entranceCurve = null
let letterTop = null, letterBot = null
const DURATION = 5.0 // seconds

export function init() {
  const c = document.getElementById('canvas-container')
  if (!c) return

  scene = new THREE.Scene()
  scene.fog = new THREE.Fog(0x7eb8f0, 18, 120)

  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 500)
  camera.position.copy(INIT_POS).multiplyScalar(1.6) // start pushed back
  camera.lookAt(INIT_LOOK)

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NoToneMapping
  renderer.toneMappingExposure = 0.05 // start dark
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  c.appendChild(renderer.domElement)

  // Letterbox bars — cover screen, then open over entrance duration
  letterTop = document.createElement('div')
  letterBot = document.createElement('div')
  const barStyle = 'position:fixed;left:0;right:0;background:#0b0b12;z-index:9999;pointer-events:none;'
  letterTop.style.cssText = barStyle + 'top:0;height:50vh;'
  letterBot.style.cssText = barStyle + 'bottom:0;height:50vh;'
  document.body.appendChild(letterTop)
  document.body.appendChild(letterBot)

  // ── Post-processing: RenderPass → Bloom → OutputPass ──
  composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))

  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.4,  // strength
    0.5,  // radius
    0.9   // threshold — only truly bright faces
  )
  bloomPass.renderToScreen = false
  composer.addPass(bloomPass)

  // Lottes tonemap — OutputPass handles sRGB
  lottesPass = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uExposure: { value: 2.0 } },
    vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `uniform sampler2D tDiffuse;uniform float uExposure;varying vec2 vUv;
      void main(){
        vec3 c=texture2D(tDiffuse,vUv).rgb*uExposure;
        c=(c*(1.2*c+0.06))/(c*(1.2*c+0.85)+0.006);
        gl_FragColor=vec4(c,1.0);
      }`
  })
  composer.addPass(lottesPass)

  composer.addPass(new OutputPass())

  // SSAO — ambient occlusion for depth
  ssaoPass = new SSAOPass(scene, camera, window.innerWidth, window.innerHeight)
  ssaoPass.kernelRadius = 8
  ssaoPass.minDistance = 0.001
  ssaoPass.maxDistance = 0.05
  ssaoPass.output = SSAOPass.OUTPUT.Default
  composer.insertPass(ssaoPass, 1) // after RenderPass, before bloom

  createSky()
  // buildIBL() — using darker colors to avoid white-wash

  // ── Balanced PBR lighting ──
  scene.add(new THREE.AmbientLight(0x8899aa, 0.35))
  scene.add(new THREE.HemisphereLight(0x8899cc, 0x554433, 0.4))

  // Low-angled sun for dramatic shadows on visible building faces
  // Camera looks SW; sun from upper-left-rear creates nice raking light
  const sun = new THREE.DirectionalLight(0xfff8f0, 4.0)
  sun.position.set(-60, 35, -50)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.radius = 1
  sun.shadow.bias = -0.0003
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 250
  sun.shadow.camera.left = sun.shadow.camera.bottom = -80
  sun.shadow.camera.right = sun.shadow.camera.top = 80
  scene.add(sun)

  const fill1 = new THREE.DirectionalLight(0x8899cc, 0.2)
  fill1.position.set(-10, 15, -20)
  scene.add(fill1)
  const fill2 = new THREE.DirectionalLight(0x665544, 0.15)
  fill2.position.set(0, -5, 0)
  scene.add(fill2)

  // Mouse-following golden point light
  mouseLight = new THREE.PointLight(0xd4a850, 1.2, 40)
  mouseLight.position.set(0, 10, 0)
  scene.add(mouseLight)

  loadModel()

  // Animate loader bar while model loads
  let loaderPhase = 0
  const loaderInterval = setInterval(() => {
    loaderPhase += 0.6
    const bar = document.getElementById('loader-fill')
    if (bar && !modelReady) {
      bar.style.width = Math.min(90, 30 + Math.sin(loaderPhase) * 25 + loaderPhase * 2) + '%'
    }
    if (modelReady) clearInterval(loaderInterval)
  }, 100)
  window.addEventListener('resize', onResize)
  setupMouse()
  animate()
}

function createSky() {
  const geo = new THREE.SphereGeometry(200, 32, 16)
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: SKY_TOP },
      mid: { value: SKY_MID },
      bot: { value: SKY_BOT },
    },
    vertexShader: `varying vec3 vWP;void main(){vec4 w=modelMatrix*vec4(position,1.0);vWP=w.xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `uniform vec3 top,mid,bot;varying vec3 vWP;void main(){float h=normalize(vWP).y;float t=smoothstep(-0.1,0.5,h);vec3 col=mix(bot,mid,smoothstep(-0.1,0.15,h));col=mix(col,top,smoothstep(0.15,0.6,h));gl_FragColor=vec4(col,1.0);}`,
  })
  skyDome = new THREE.Mesh(geo, mat)
  skyDome.renderOrder = -1
  scene.add(skyDome)
}

function buildIBL() {
  const pmrem = new THREE.PMREMGenerator(renderer)
  const envScene = new THREE.Scene()
  const geo = new THREE.SphereGeometry(100, 32, 16)
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      top: { value: SKY_TOP },
      mid: { value: SKY_MID },
      bot: { value: SKY_BOT },
    },
    vertexShader: `varying vec3 vWP;void main(){vec4 w=modelMatrix*vec4(position,1.0);vWP=w.xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `uniform vec3 top,mid,bot;varying vec3 vWP;void main(){float h=normalize(vWP).y;float t=smoothstep(-0.1,0.5,h);vec3 col=mix(bot,mid,smoothstep(-0.1,0.15,h));col=mix(col,top,smoothstep(0.15,0.6,h));gl_FragColor=vec4(col,1.0);}`,
  })
  envScene.add(new THREE.Mesh(geo, mat))
  const rt = pmrem.fromScene(envScene, 0.04)
  scene.environment = rt.texture
  pmrem.dispose()
  geo.dispose()
  mat.dispose()
}

function onResize() {
  const w = window.innerWidth
  const h = window.innerHeight
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  renderer.setSize(w, h)
  composer.setSize(w, h)
  if (ssaoPass) ssaoPass.setSize(w, h)
}

function setupMouse() {
  window.addEventListener('pointerdown', e => { prevMouseX = e.clientX })
  window.addEventListener('pointermove', e => {
    // Drag rotation
    if (e.buttons & 1) { camAngle -= (e.clientX - prevMouseX) * 0.004; prevMouseX = e.clientX }
    // Passive parallax follow
    mouseX = (e.clientX / window.innerWidth) * 2 - 1
    mouseY = (e.clientY / window.innerHeight) * 2 - 1
  })
}

async function loadModel() {
  try {
    const mtlLoader = new MTLLoader()
    const mtl = await mtlLoader.loadAsync(MODEL_BASE + 'town_hall.mtl')

    // Load atlas texture separately so we can patch MTL materials
    const texLoader = new THREE.TextureLoader()
    const atlas = await texLoader.loadAsync(MODEL_BASE + 'atlas.png')
    atlas.generateMipmaps = true
    atlas.minFilter = THREE.NearestMipmapNearestFilter
    atlas.magFilter = THREE.NearestFilter
    atlas.colorSpace = THREE.SRGBColorSpace

    // Patch all MTL materials to use our atlas and correct colorSpace
    for (const name in mtl.materials) {
      const m = mtl.materials[name]
      if (m.map) {
        m.map = atlas
      }
      m.colorSpace = THREE.SRGBColorSpace
    }

    // Load gzip-compressed OBJ and decompress in browser
    const resp = await fetch(MODEL_BASE + 'town_hall.obj.gz')
    if (!resp.ok) throw new Error('OBJ fetch failed: ' + resp.status)
    const compressed = await resp.arrayBuffer()
    let text
    if (typeof DecompressionStream !== 'undefined') {
      const ds = new DecompressionStream('gzip')
      const stream = new Blob([compressed]).stream().pipeThrough(ds)
      text = await new Response(stream).text()
    } else {
      // Fallback: use global pako if available
      const pako = window.pako
      if (!pako) throw new Error('No gzip decompression available')
      text = pako.ungzip(new Uint8Array(compressed), { to: 'string' })
    }

    const objLoader = new OBJLoader()
    objLoader.setMaterials(mtl)
    const obj = objLoader.parse(text)

    obj.traverse(c => {
      if (!c.isMesh) return
      c.castShadow = true
      c.receiveShadow = true

      const old = [c.material].flat()
      const nu = old.map(m => {
        const name = (m.name || '').toLowerCase()
        const tr = name.includes('water') || name.includes('glass') || name.includes('pane') || name.includes('ice')
        const sm = new THREE.MeshStandardMaterial({
          map: atlas,
          color: m.color ? m.color.clone() : 0xffffff,
          roughness: 0.65,
          metalness: 0,
          alphaTest: tr ? 0 : 0.3,
          transparent: tr,
          opacity: tr ? Math.max(0.3, m.opacity || 0.6) : 1,
          depthWrite: !tr,
        })
        return sm
      })
      c.material = nu.length === 1 ? nu[0] : nu
    })

    modelGroup = new THREE.Group(); modelGroup.add(obj)
    const box = new THREE.Box3().setFromObject(modelGroup)
    modelGroup.position.sub(box.getCenter(new THREE.Vector3()))
    scene.add(modelGroup)
    createParticles(box)
    modelReady = true
    buildEntrancePath()

    const bar = document.getElementById('loader-fill')
    if (bar) bar.style.width = '100%'
    setTimeout(() => {
      const loader = document.getElementById('loader')
      if (loader) loader.style.opacity = '0'
      setTimeout(() => {
        if (loader) loader.remove()
        loaderDone = true
      }, 600)
    }, 400)
  } catch (e) { console.error(e) }
}

// Lusion-style drifting particles
function createParticles(box) {
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const count = 400
  const positions = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  particleVelocities = []

  for (let i = 0; i < count; i++) {
    positions[i * 3] = center.x + (Math.random() - 0.5) * size.x * 1.5
    positions[i * 3 + 1] = center.y + Math.random() * size.y * 1.2 - size.y * 0.2
    positions[i * 3 + 2] = center.z + (Math.random() - 0.5) * size.z * 1.5
    sizes[i] = 0.03 + Math.random() * 0.06
    particleVelocities.push({
      x: (Math.random() - 0.5) * 0.004,
      y: 0.005 + Math.random() * 0.01,
      z: (Math.random() - 0.5) * 0.004,
      phase: Math.random() * Math.PI * 2,
    })
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1))

  // Canvas sprite: soft glowing circle
  const canvas = document.createElement('canvas')
  canvas.width = 32; canvas.height = 32
  const ctx = canvas.getContext('2d')
  const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16)
  gradient.addColorStop(0, 'rgba(255,235,200,1)')
  gradient.addColorStop(0.3, 'rgba(212,168,80,0.6)')
  gradient.addColorStop(1, 'rgba(212,168,80,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 32, 32)
  const texture = new THREE.CanvasTexture(canvas)

  const mat = new THREE.PointsMaterial({
    size: 0.35,
    map: texture,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: 0.6,
    color: 0xd4a850,
  })

  particles = new THREE.Points(geo, mat)
  scene.add(particles)
}

function updateParticles() {
  if (!particles) return
  const pos = particles.geometry.attributes.position.array
  const box = new THREE.Box3().setFromObject(modelGroup)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const t = Date.now() * 0.001

  for (let i = 0; i < pos.length / 3; i++) {
    const v = particleVelocities[i]
    pos[i * 3] += v.x + Math.sin(t * 0.3 + v.phase) * 0.002
    pos[i * 3 + 1] += v.y
    pos[i * 3 + 2] += v.z + Math.cos(t * 0.2 + v.phase) * 0.002

    // Reset if out of bounds
    if (pos[i * 3 + 1] > center.y + size.y * 0.7) {
      pos[i * 3] = center.x + (Math.random() - 0.5) * size.x * 1.5
      pos[i * 3 + 1] = center.y - size.y * 0.3
      pos[i * 3 + 2] = center.z + (Math.random() - 0.5) * size.z * 1.5
    }
  }
  particles.geometry.attributes.position.needsUpdate = true
}
function buildEntrancePath() {
  const center = INIT_LOOK.clone()
  // Control points: start high → sweep around → land at final position
  const pts = [
    new THREE.Vector3(40, 45, 40),      // high above, northeast
    new THREE.Vector3(30, 20, -20),     // descending, right side
    new THREE.Vector3(10, 5, -35),      // lower approach
    new THREE.Vector3(-10, -2, -28),    // near final
    INIT_POS.clone(),                    // final
  ]
  entranceCurve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5)
}

export function updateScroll(y) { scrollY = y }

function animate() {
  requestAnimationFrame(animate)

  // Entrance animation: 3D camera fly-in along spline
  if (entranceActive && modelReady && entranceCurve && loaderDone) {
    entranceT += 0.016 / DURATION
    const t = Math.min(1, entranceT)
    const ease = 1 - Math.pow(1 - t, 2.5) // ease-out for camera
    const easeIn = t * t * t // ease-in for fog

    // Camera position along spline
    camera.position.copy(entranceCurve.getPointAt(ease))
    // Exposure rise via Lottes
    lottesPass.uniforms.uExposure.value = 0.3 + 1.7 * ease

    // Look at blends from center toward INIT_LOOK
    const look = new THREE.Vector3().lerpVectors(
      new THREE.Vector3(0, 5, 0),
      INIT_LOOK,
      ease
    )
    camera.lookAt(look)

    // Also blend camera FOV for dramatic effect
    camera.fov = 70 - 20 * ease
    camera.updateProjectionMatrix()

    // Fog clears: near from 18 to 72
    scene.fog.near = 18 + 54 * easeIn
    const barH = 50 * (1 - ease)
    letterTop.style.height = barH + 'vh'
    letterBot.style.height = barH + 'vh'

    updateParticles()
    composer.render()

    if (t >= 1) {
      entranceActive = false
      lottesPass.uniforms.uExposure.value = 2.0
      camera.position.copy(INIT_POS)
      camera.fov = 50
      camera.updateProjectionMatrix()
      scene.fog.near = 72
      letterTop.remove()
      letterBot.remove()
      // Signal page that entrance is done
      window.dispatchEvent(new CustomEvent('entrance-done'))
    }
    return
  }

  if (!modelGroup) { composer.render(); return }

  const a = camAngle + scrollY * 0.2, d = 1.0 - scrollY * 0.15
  const c = new THREE.Vector3().addVectors(INIT_POS, INIT_LOOK).multiplyScalar(0.5)
  const bd = INIT_LOOK.clone().sub(INIT_POS).normalize()
  const rx = Math.cos(a) * bd.x - Math.sin(a) * bd.z
  const rz = Math.sin(a) * bd.x + Math.cos(a) * bd.z
  const dr = new THREE.Vector3(rx, bd.y * d, rz).normalize()
  const bDist = INIT_POS.distanceTo(INIT_LOOK)
  // Parallax: subtle camera offset based on mouse
  const px = mouseX * 0.8
  const py = -mouseY * 0.5
  const lookTarget = INIT_LOOK.clone().add(new THREE.Vector3(px, py, 0))

  // Mouse-following golden light: project mouse onto ground plane
  if (mouseLight) {
    const v = new THREE.Vector3(mouseX, -mouseY, 1).unproject(camera)
    const dir = v.sub(camera.position).normalize()
    const tPlane = (5 - camera.position.y) / dir.y
    if (tPlane > 0) {
      const lp = camera.position.clone().add(dir.multiplyScalar(tPlane))
      mouseLight.position.lerp(lp, 0.06)
    }
  }

  camera.position.lerp(c.clone().addScaledVector(dr, -bDist * 0.5 * (1 + scrollY * 0.5)), 0.04)
  camera.lookAt(lookTarget)
  updateParticles()
  composer.render()
}
