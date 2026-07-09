import { readFileSync, writeFileSync } from 'fs'
import {
  Document, NodeIO, Accessor, Primitive, Material
} from '@gltf-transform/core'

const OBJ = '/home/rookiecube/西村镇website/models/town_hall/town_hall.obj'
const MTL = '/home/rookiecube/西村镇website/models/town_hall/town_hall.mtl'
const OUT = '/home/rookiecube/西村镇website/models/town_hall/town_hall_vc.glb'

function parseMTL(path) {
  const lines = readFileSync(path, 'utf-8').split('\n')
  const mats = []
  const nameToIdx = {}
  let cur = null
  for (const line of lines) {
    if (line.startsWith('newmtl ')) {
      cur = line.slice(7).trim()
      nameToIdx[cur] = mats.length
      mats.push({ Kd: [1, 1, 1], d: 1 })
    } else if (cur && line.startsWith('Kd ')) {
      mats[mats.length - 1].Kd = line.slice(3).trim().split(/\s+/).map(Number)
    } else if (cur && line.startsWith('d ')) {
      mats[mats.length - 1].d = parseFloat(line.slice(2).trim())
    }
  }
  return { mats, nameToIdx }
}

function buildArrays(path, nameToIdx, mats) {
  const lines = readFileSync(path, 'utf-8').split('\n')
  const v = [], vt = [], vn = []
  const pos = [], uv = [], nrm = [], col = []
  let curIdx = 0

  // Add half-texel UV inset to prevent atlas bleeding
  // Atlas = 2048×2048, each cell = 16×16, half-texel = 0.5/2048 = 0.000244
  const UV_INSET = 0.000244

  function pushTri(a, b, c, kd) {
    for (const idx of [a, b, c]) {
      const p = v[idx.v - 1]; pos.push(p[0], p[1], p[2])
      if (idx.vt) {
        const t = vt[idx.vt - 1]
        uv.push(
          Math.min(1 - UV_INSET, Math.max(UV_INSET, t[0])),
          Math.min(1 - UV_INSET, Math.max(UV_INSET, t[1]))
        )
      } else uv.push(0, 0)
      if (idx.vn) { const no = vn[idx.vn - 1]; nrm.push(no[0], no[1], no[2]) }
      else nrm.push(0, 1, 0)
      col.push(kd[0], kd[1], kd[2])
    }
  }

  for (const line of lines) {
    if (line.startsWith('v ')) v.push(line.slice(2).trim().split(/\s+/).map(Number))
    else if (line.startsWith('vt ')) vt.push(line.slice(3).trim().split(/\s+/).map(Number))
    else if (line.startsWith('vn ')) vn.push(line.slice(3).trim().split(/\s+/).map(Number))
    else if (line.startsWith('usemtl ')) {
      curIdx = nameToIdx[line.slice(7).trim()] ?? 0
    } else if (line.startsWith('f ')) {
      const fv = line.slice(2).trim().split(/\s+/).map(s => {
        const p = s.split('/')
        return { v: parseInt(p[0]), vt: p[1] ? parseInt(p[1]) : 0, vn: p[2] ? parseInt(p[2]) : 0 }
      })
      const kd = mats[curIdx].Kd
      if (fv.length === 3) pushTri(fv[0], fv[1], fv[2], kd)
      else if (fv.length === 4) {
        pushTri(fv[0], fv[1], fv[2], kd)
        pushTri(fv[0], fv[2], fv[3], kd)
      }
    }
  }

  return { pos, uv, nrm, col }
}

async function main() {
  console.log('Parsing MTL...')
  const { mats, nameToIdx } = parseMTL(MTL)
  const nonWhite = mats.filter(m => !(m.Kd[0] === 1 && m.Kd[1] === 1 && m.Kd[2] === 1))
  console.log(`${nonWhite.length}/${mats.length} non-white materials`)

  console.log('Parsing OBJ...')
  const t0 = Date.now()
  const { pos, uv, nrm, col } = buildArrays(OBJ, nameToIdx, mats)
  const triCount = pos.length / 9
  console.log(`Parsed in ${(Date.now() - t0) / 1000}s: ${triCount} triangles`)

  console.log('Building GLB with vertex colors...')
  const doc = new Document()

  // Buffer
  const buf = doc.createBuffer()

  // Geometry accessors
  const positions = doc.createAccessor().setArray(new Float32Array(pos)).setType(Accessor.Type.VEC3)
  const uvs = doc.createAccessor().setArray(new Float32Array(uv)).setType(Accessor.Type.VEC2)
  const normals = doc.createAccessor().setArray(new Float32Array(nrm)).setType(Accessor.Type.VEC3)
  const colors = doc.createAccessor().setArray(new Float32Array(col)).setType(Accessor.Type.VEC3)

  // Material with vertex colors (COLOR_0 attribute on primitive handles the multiplication)
  const mat = doc.createMaterial('default')
    .setRoughnessFactor(0.65)
    .setMetallicFactor(0)

  // Primitive
  const prim = doc.createPrimitive()
    .setMaterial(mat)
    .setAttribute('POSITION', positions)
    .setAttribute('TEXCOORD_0', uvs)
    .setAttribute('NORMAL', normals)
    .setAttribute('COLOR_0', colors)

  // Mesh → Scene
  const mesh = doc.createMesh().addPrimitive(prim)
  doc.createNode().setMesh(mesh)
  doc.createScene().addChild(doc.getRoot().listNodes()[0])

  // Export
  const io = new NodeIO()
  await io.write(OUT, doc)
  const size = readFileSync(OUT).length
  console.log(`Exported ${OUT} (${(size / 1024 / 1024).toFixed(1)} MB)`)
}

main().catch(console.error)
