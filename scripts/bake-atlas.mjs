import { readFileSync } from 'fs'
import sharp from 'sharp'

const OBJ = '/home/rookiecube/西村镇website/models/town_hall/town_hall.obj'
const MTL = '/home/rookiecube/西村镇website/models/town_hall/town_hall.mtl'
const ATLAS = '/home/rookiecube/西村镇website/models/town_hall/atlas.png'
const OUT = '/home/rookiecube/西村镇website/models/town_hall/atlas.png'

function parseMTL(path) {
  const lines = readFileSync(path, 'utf-8').split('\n')
  const materials = {}
  let cur = null
  for (const line of lines) {
    if (line.startsWith('newmtl ')) {
      cur = line.slice(7).trim()
      materials[cur] = { Kd: [1, 1, 1] }
    } else if (cur && line.startsWith('Kd ')) {
      const parts = line.slice(3).trim().split(/\s+/).map(Number)
      if (parts.length === 3) materials[cur].Kd = parts
    }
  }
  return materials
}

function parseOBJ(path) {
  const lines = readFileSync(path, 'utf-8').split('\n')
  const uvCoords = []    // index → [u, v] (0-indexed)
  const matUVs = {}      // material_name → Set of packed UV strings
  let curMat = null
  let lineCount = 0

  for (const line of lines) {
    lineCount++
    if (line.startsWith('usemtl ')) {
      curMat = line.slice(7).trim()
      if (!matUVs[curMat]) matUVs[curMat] = new Set()
    } else if (line.startsWith('vt ')) {
      const parts = line.slice(3).trim().split(/\s+/).map(Number)
      uvCoords.push([parts[0], parts[1]])
    } else if (line.startsWith('f ') && curMat) {
      const verts = line.slice(2).trim().split(/\s+/)
      for (const v of verts) {
        const parts = v.split('/')
        if (parts.length >= 2 && parts[1]) {
          const vi = parseInt(parts[1])
          // Handle negative indices (relative from end)
          const idx = vi > 0 ? vi - 1 : uvCoords.length + vi
          const uv = uvCoords[idx]
          if (uv) matUVs[curMat].add(`${uv[0].toFixed(6)},${uv[1].toFixed(6)}`)
        }
      }
    }
  }

  return matUVs
}

async function main() {
  console.log('Parsing MTL...')
  const materials = parseMTL(MTL)
  const nonWhite = Object.entries(materials).filter(([, m]) => !(m.Kd[0] === 1 && m.Kd[1] === 1 && m.Kd[2] === 1))
  console.log(`Found ${nonWhite.length} non-white materials out of ${Object.keys(materials).length}`)

  console.log('Parsing OBJ (62MB, this may take a moment)...')
  const t0 = Date.now()
  const matUVs = parseOBJ(OBJ)
  console.log(`OBJ parsed in ${(Date.now() - t0) / 1000}s, ${Object.keys(matUVs).length} materials with UVs`)

  const meta = await sharp(ATLAS).metadata()
  const W = meta.width, H = meta.height
  console.log(`Atlas: ${W}×${H}`)

  const pixels = await sharp(ATLAS).raw().toBuffer()
  const rgba = new Uint8ClampedArray(pixels)

  let totalTinted = 0

  for (const [matName, kdArr] of nonWhite) {
    const kd = kdArr.Kd
    const uvSet = matUVs[matName]
    if (!uvSet || uvSet.size === 0) continue

    // Quantize UVs to 16px block texture grid cells
    const CELL = 16 / W  // 0.0078125
    const cells = new Set()
    for (const uvStr of uvSet) {
      const [u, v] = uvStr.split(',').map(Number)
      const cx = Math.floor(u / CELL)
      const cy = Math.floor(v / CELL)
      cells.add(`${cx},${cy}`)
    }

    // Skip materials with scattered UVs (likely non-block entities like banners)
    if (cells.size > 100) {
      console.log(`${matName}: SKIPPED (${cells.size} cells — scattered UVs)`)
      continue
    }

    let tintedPixels = 0
    for (const cellStr of cells) {
      const [cx, cy] = cellStr.split(',').map(Number)
      const px = Math.round(cx * CELL * W)
      const py = Math.round((1 - (cy + 1) * CELL) * H)
      const pw = Math.round(CELL * W)
      const ph = Math.round(CELL * H)
      if (px < 0 || py < 0 || px + pw > W || py + ph > H) continue

      for (let y = py; y < py + ph && y < H; y++) {
        for (let x = px; x < px + pw && x < W; x++) {
          const i = (y * W + x) * 4
          if (rgba[i + 3] > 0) {
            rgba[i + 0] = Math.round(rgba[i + 0] * kd[0])
            rgba[i + 1] = Math.round(rgba[i + 1] * kd[1])
            rgba[i + 2] = Math.round(rgba[i + 2] * kd[2])
            tintedPixels++
          }
        }
      }
    }

    totalTinted++
    console.log(`${matName}: Kd(${kd.map(v => v.toFixed(4)).join(',')}) ${cells.size} cells, ${tintedPixels} pixels`)
  }

  console.log(`\nTinted ${totalTinted} materials with non-white Kd`)

  await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
    .png()
    .toFile(OUT)

  console.log('Done!')
}

main().catch(console.error)
