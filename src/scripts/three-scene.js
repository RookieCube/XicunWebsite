import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

const MODEL_URL = 'https://cdn.jsdelivr.net/gh/RookieCube/XicunWebsite@main/models/town_hall/town_hall_draco.glb'
const DECODER_URL = 'https://cdn.jsdelivr.net/npm/three@0.185.0/examples/jsm/libs/draco/'

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
    const dracoLoader = new DRACOLoader()
    dracoLoader.setDecoderPath(DECODER_URL)
    dracoLoader.setDecoderConfig({ type: 'js' })

    const gltfLoader = new GLTFLoader()
    gltfLoader.setDRACOLoader(dracoLoader)
    const gltf = await gltfLoader.loadAsync(MODEL_URL)

    const obj = gltf.scene

    // Load atlas texture separately via TextureLoader (avoids DataTexture color issues)
    const texLoader = new THREE.TextureLoader()
    const atlas = await texLoader.loadAsync('/XicunWebsite/atlas.png')
    atlas.generateMipmaps = true
    atlas.minFilter = THREE.NearestMipmapNearestFilter
    atlas.magFilter = THREE.NearestFilter
    atlas.colorSpace = THREE.SRGBColorSpace

    obj.traverse(c => {
      if (!c.isMesh) return
      c.castShadow = true
      c.receiveShadow = true
      const m = c.material
      if (m) {
        m.roughness = 0.65
        m.metalness = 0
        m.alphaTest = m.transparent ? 0 : 0.3
        m.map = atlas
        m.needsUpdate = true
      }
    })

    modelGroup = new THREE.Group(); modelGroup.add(obj)
    const box = new THREE.Box3().setFromObject(modelGroup)
    modelGroup.position.sub(box.getCenter(new THREE.Vector3()))
    scene.add(modelGroup)
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

// Dramatic 3D camera fly-in path (Catmull-Rom spline)
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

  camera.position.lerp(c.clone().addScaledVector(dr, -bDist * 0.5 * (1 + scrollY * 0.5)), 0.04)
  camera.lookAt(lookTarget)
  composer.render()
}
