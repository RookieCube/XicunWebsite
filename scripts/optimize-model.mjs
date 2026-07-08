/**
 * Optimize litematic → compact binary geometry for Three.js
 * Run from /tmp/Mine2Blend/resources/converter/win-x64
 */
import fs from 'node:fs'
import path from 'node:path'
import { NbtFile } from 'deepslate'

const LITEMATIC = "/mnt/sftp_remote/.minecraft/versions/XPlus PerioTable based on Minecraft 1.21.11 (Fabric)/schematics/西村部分区域.litematic"
const OUT = "/home/rookiecube/西村镇website/public/models/optimized"

const SKIP = new Set([
  'minecraft:air', 'minecraft:cave_air', 'minecraft:void_air',
  'minecraft:light', 'minecraft:barrier', 'minecraft:structure_void',
])

const TRANS = {
  'minecraft:glass': true, 'minecraft:ice': true, 'minecraft:packed_ice': true,
  'minecraft:blue_ice': true, 'minecraft:water': true, 'minecraft:lava': true,
  'minecraft:tinted_glass': true,
}
const LEAVES = new Set([
  'minecraft:oak_leaves', 'minecraft:spruce_leaves', 'minecraft:birch_leaves',
  'minecraft:jungle_leaves', 'minecraft:acacia_leaves', 'minecraft:dark_oak_leaves',
  'minecraft:azalea_leaves', 'minecraft:flowering_azalea_leaves', 'minecraft:mangrove_leaves',
])

function isOpaque(id) {
  if (TRANS[id]) return false
  if (LEAVES.has(id)) return false
  const n = id.replace('minecraft:', '')
  if (n.includes('glass') || n.includes('leaves') || n.includes('water') ||
      n.includes('lava') || n.includes('torch') || n.includes('door') ||
      n.includes('sign') || n.includes('banner') || n.includes('chest') ||
      n.includes('slab') || n.includes('stair') || n.includes('fence') ||
      n.includes('wall') || n.includes('pane') || n.includes('grass') ||
      n.includes('fern') || n.includes('flower') || n.includes('sapling') ||
      n.includes('candle') || n.includes('lantern') || n.includes('chain') ||
      n.includes('vine') || n.includes('carpet') || n.includes('rail') ||
      n.includes('button') || n.includes('lever') || n.includes('plate') ||
      n.includes('snow') || n.includes('honey') || n.includes('slime') ||
      n.includes('coral') || n.includes('mushroom') || n.includes('sapling') ||
      n.includes('bamboo') || n.includes('cactus') || n.includes('sugar') ||
      n.includes('kelp') || n.includes('seagrass') || n.includes('bed') ||
      n.includes('cake') || n.includes('campfire') || n.includes('bell') ||
      n.includes('brewing') || n.includes('hopper') || n.includes('ladder') ||
      n.includes('scaffolding') || n.includes('web') || n.includes('head') ||
      n.includes('skull') || n.includes('pot') || n.includes('armor') ||
      n.includes('redstone') || n.includes('repeater') || n.includes('comparator') ||
      n.includes('tripwire') || n.includes('pressure')) return false
  return true
}

const DIRS = [[0,1,0],[0,-1,0],[0,0,-1],[0,0,1],[1,0,0],[-1,0,0]]

const FV = [
  [[0,1,0],[0,1,1],[1,1,1],[1,1,0]],
  [[0,0,1],[0,0,0],[1,0,0],[1,0,1]],
  [[1,1,0],[1,0,0],[0,0,0],[0,1,0]],
  [[0,1,1],[0,0,1],[1,0,1],[1,1,1]],
  [[1,1,1],[1,0,1],[1,0,0],[1,1,0]],
  [[0,1,0],[0,0,0],[0,0,1],[0,1,1]],
]

const COLORS = [
  [0.50,0.50,0.50], // stone
  [0.55,0.35,0.20], // dirt
  [0.40,0.55,0.25], // grass
  [0.60,0.45,0.25], // oak planks
  [0.35,0.25,0.15], // spruce planks
  [0.70,0.60,0.40], // birch planks
  [0.50,0.35,0.15], // oak log
  [0.45,0.45,0.45], // stone bricks
  [0.40,0.40,0.40], // cobblestone
  [0.30,0.50,0.15], // leaves
  [0.15,0.35,0.70], // water
  [0.50,0.60,0.70], // glass
  [0.90,0.90,0.90], // white
  [0.70,0.20,0.15], // red
  [0.15,0.20,0.60], // blue
  [0.20,0.50,0.15], // green
  [0.80,0.70,0.15], // yellow
  [0.60,0.40,0.30], // terracotta
  [0.30,0.30,0.35], // deepslate
  [0.80,0.80,0.80], // quartz
  [0.55,0.40,0.30], // wood general
  [0.45,0.35,0.20], // dirt general
  [0.50,0.35,0.25], // brick general
  [0.65,0.55,0.35], // sand general
]

function colorFor(id) {
  const n = id.replace('minecraft:', '')
  if (n.includes('stone') || n.includes('cobble') || n.includes('rock')) return COLORS[0]
  if (n.includes('dirt') || n.includes('soil') || n.includes('mud') || n.includes('farm') || n.includes('path')) return COLORS[1]
  if (n.includes('grass') || n.includes('moss')) return COLORS[2]
  if (n.includes('plank')) {
    if (n.includes('spruce') || n.includes('dark_oak') || n.includes('bamboo')) return COLORS[4]
    if (n.includes('birch') || n.includes('cherry')) return COLORS[5]
    if (n.includes('acacia') || n.includes('jungle') || n.includes('mangrove')) return COLORS[21]
    return COLORS[3]
  }
  if (n.includes('log') || n.includes('wood') || n.includes('hyphae')) return COLORS[6]
  if (n.includes('brick') && !n.includes('nether')) return COLORS[7]
  if (n.includes('cobble')) return COLORS[8]
  if (n.includes('leaves') || n.includes('foliage')) return COLORS[9]
  if (n.includes('water')) return COLORS[10]
  if (n.includes('glass') || n.includes('pane') || n.includes('ice')) return COLORS[11]
  if (n.includes('quartz') || n.includes('calcite') || n.includes('diorite')) return COLORS[19]
  if (n.includes('deepslate') || n.includes('tuff') || n.includes('basalt')) return COLORS[18]
  if (n.includes('terracotta') || n.includes('concrete')) return COLORS[17]
  if (n.includes('sand') || n.includes('sandstone')) return COLORS[23]
  if (n.includes('nether') || n.includes('soul_') || n.includes('blackstone')) return [0.25, 0.15, 0.2]
  if (n.includes('end_stone') || n.includes('purpur') || n.includes('chorus')) return [0.55, 0.45, 0.35]
  if (n.includes('wool') || n.includes('carpet')) {
    if (n.includes('white') || n.includes('light_gray')) return COLORS[12]
    if (n.includes('red') || n.includes('orange') || n.includes('pink') || n.includes('magenta')) return COLORS[13]
    if (n.includes('blue') || n.includes('cyan') || n.includes('light_blue') || n.includes('purple')) return COLORS[14]
    if (n.includes('green') || n.includes('lime')) return COLORS[15]
    if (n.includes('yellow')) return COLORS[16]
    return COLORS[12]
  }
  if (n.includes('sponge')) return [0.55, 0.55, 0.2]
  if (n.includes('copper')) return [0.5, 0.4, 0.3]
  if (n.includes('iron') || n.includes('gold') || n.includes('emerald') ||
      n.includes('diamond') || n.includes('lapis') || n.includes('redstone')) return [0.5, 0.5, 0.5]
  if (n.includes('prismarine') || n.includes('sea')) return [0.3, 0.55, 0.45]
  if (n.includes('glow') || n.includes('light') || n.includes('lantern') ||
      n.includes('torch') || n.includes('shroom')) return [0.7, 0.6, 0.3]
  return [0.50, 0.50, 0.50]
}

function parseLitematic(buf) {
  const nbt = NbtFile.read(new Uint8Array(buf))
  const root = nbt.root
  const regions = root.getCompound('Regions')
  const regionNames = Array.from(regions.keys())
  const allBlocks = []

  for (const rn of regionNames) {
    const reg = regions.getCompound(rn)
    const sz = reg.getCompound('Size')
    const sX = Math.abs(sz.getNumber('x')), sY = Math.abs(sz.getNumber('y')), sZ = Math.abs(sz.getNumber('z'))
    const pos = reg.getCompound('Position')
    const oX = pos.getNumber('x'), oY = pos.getNumber('y'), oZ = pos.getNumber('z')
    const pal = reg.getList('BlockStatePalette', 10)
    const palette = []
    for (let i = 0; i < pal.length; i++) {
      palette.push(pal.getCompound(i).getString('Name'))
    }
    const bs = reg.getLongArray('BlockStates')
    const longs = bs.getItems().map(l => BigInt(l))
    const total = sX * sY * sZ
    const bits = Math.max(2, Math.ceil(Math.log2(palette.length)))
    const mask = (1n << BigInt(bits)) - 1n
    for (let i = 0; i < total; i++) {
      const start = i * bits
      const li = Math.floor(start / 64)
      const off = start % 64
      if (li >= longs.length) break
      let v = Number((longs[li] >> BigInt(off)) & mask)
      if (off + bits > 64 && li + 1 < longs.length) {
        const rem = bits - (64 - off)
        v |= Number((longs[li + 1] & ((1n << BigInt(rem)) - 1n)) << BigInt(64 - off))
      }
      if (v >= palette.length) continue
      const id = palette[v]
      if (SKIP.has(id)) continue
      const y = Math.floor(i / (sZ * sX))
      const z = Math.floor((i % (sZ * sX)) / sX)
      const x = i % sX
      allBlocks.push({ id, pos: [x + oX, y + oY, z + oZ] })
    }
  }
  return allBlocks
}

function main() {
  console.log("Reading .litematic...")
  const buf = fs.readFileSync(LITEMATIC)
  const blocks = parseLitematic(buf)
  console.log(`Blocks: ${blocks.length}`)

  // Index
  const idx = new Map()
  for (const b of blocks) {
    idx.set(`${b.pos[0]},${b.pos[1]},${b.pos[2]}`, b.id)
  }

  // Normalize
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (const b of blocks) {
    minX = Math.min(minX, b.pos[0]); maxX = Math.max(maxX, b.pos[0])
    minY = Math.min(minY, b.pos[1]); maxY = Math.max(maxY, b.pos[1])
    minZ = Math.min(minZ, b.pos[2]); maxZ = Math.max(maxZ, b.pos[2])
  }
  console.log(`Bounds: X[${minX},${maxX}] Y[${minY},${maxY}] Z[${minZ},${maxZ}]`)

  // Generate mesh
  const pos = []
  const col = []
  let faces = 0

  for (const b of blocks) {
    const [x, y, z] = b.pos
    const nx = x - minX, ny = y - minY, nz = z - minZ
    const c = colorFor(b.id)

    for (let f = 0; f < 6; f++) {
      const [dx, dy, dz] = DIRS[f]
      const nk = `${x + dx},${y + dy},${z + dz}`
      const nb = idx.get(nk)
      if (nb && isOpaque(nb)) continue

      const fv = FV[f]
      const v0 = [nx + fv[0][0], ny + fv[0][1], nz + fv[0][2]]
      const v1 = [nx + fv[1][0], ny + fv[1][1], nz + fv[1][2]]
      const v2 = [nx + fv[2][0], ny + fv[2][1], nz + fv[2][2]]
      const v3 = [nx + fv[3][0], ny + fv[3][1], nz + fv[3][2]]

      pos.push(...v0, ...v1, ...v2, ...v0, ...v2, ...v3)
      col.push(...c, ...c, ...c, ...c, ...c, ...c)
      faces += 2
    }
  }

  console.log(`Faces: ${faces}, Vertices: ${pos.length / 3}`)

  // Write binary (Float32)
  fs.mkdirSync(OUT, { recursive: true })

  const posBuf = new Float32Array(pos)
  const colBuf = new Float32Array(col)

  fs.writeFileSync(path.join(OUT, 'positions.bin'), Buffer.from(posBuf.buffer))
  fs.writeFileSync(path.join(OUT, 'colors.bin'), Buffer.from(colBuf.buffer))

  const meta = {
    vertexCount: pos.length / 3,
    faceCount: faces,
    bounds: { minX: 0, maxX: maxX - minX, minY: 0, maxY: maxY - minY, minZ: 0, maxZ: maxZ - minZ },
    centerX: (maxX - minX) / 2,
    centerZ: (maxZ - minZ) / 2,
  }
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 2))

  const totalMB = (pos.length * 4 + col.length * 4) / 1024 / 1024
  console.log(`Written: ${meta.faceCount} faces, ${totalMB.toFixed(1)} MB binary data`)
  console.log(`Meta:`, JSON.stringify(meta))
}

main()
