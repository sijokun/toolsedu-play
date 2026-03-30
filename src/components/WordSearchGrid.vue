<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  grid: Array,
  foundWords: { type: Object, default: () => ({}) },
  onSelect: Function,
  interactive: { type: Boolean, default: false },
  playerUid: String,
})

const selecting = ref(false)
const startCell = ref(null)
const endCell = ref(null)
const gridRef = ref(null)

const rows = computed(() => props.grid.length)
const cols = computed(() => props.grid[0]?.length || 0)

function parseCoordsToPath(coords) {
  const [start, end] = coords.split('-')
  const [r1, c1] = start.split(':').map(Number)
  const [r2, c2] = end.split(':').map(Number)
  const dr = r2 - r1
  const dc = c2 - c1
  const length = Math.max(Math.abs(dr), Math.abs(dc))
  const stepR = length ? dr / length : 0
  const stepC = length ? dc / length : 0
  const cells = []
  for (let i = 0; i <= length; i++) {
    cells.push([Math.round(r1 + stepR * i), Math.round(c1 + stepC * i)])
  }
  return cells
}

const highlightedCells = computed(() => {
  const map = {}
  const hashWord = (w) => {
    let h = 0
    for (let i = 0; i < w.length; i++) h = ((h << 5) - h + w.charCodeAt(i)) | 0
    return Math.abs(h)
  }
  Object.entries(props.foundWords).forEach(([word, info]) => {
    const colorIdx = hashWord(word) % 10
    const cells = parseCoordsToPath(info.coords)
    cells.forEach(([r, c]) => {
      const key = `${r}:${c}`
      if (!map[key]) map[key] = []
      if (!map[key].includes(colorIdx)) map[key].push(colorIdx)
    })
  })
  return map
})

const selectionCells = computed(() => {
  if (!selecting.value || !startCell.value || !endCell.value) return new Set()
  const dr = endCell.value[0] - startCell.value[0]
  const dc = endCell.value[1] - startCell.value[1]
  const absDr = Math.abs(dr)
  const absDc = Math.abs(dc)

  if (absDr === 0 && absDc === 0) {
    return new Set([`${startCell.value[0]}:${startCell.value[1]}`])
  }

  let snapR, snapC, length
  if (absDc >= absDr) {
    snapR = 0; snapC = dc > 0 ? 1 : -1; length = absDc
  } else {
    snapR = dr > 0 ? 1 : -1; snapC = 0; length = absDr
  }

  const set = new Set()
  for (let i = 0; i <= length; i++) {
    const r = startCell.value[0] + snapR * i
    const c = startCell.value[1] + snapC * i
    if (r >= 0 && r < rows.value && c >= 0 && c < cols.value) {
      set.add(`${r}:${c}`)
    }
  }
  return set
})

function getSnappedEnd() {
  if (!startCell.value || !endCell.value) return null
  const dr = endCell.value[0] - startCell.value[0]
  const dc = endCell.value[1] - startCell.value[1]
  const absDr = Math.abs(dr)
  const absDc = Math.abs(dc)

  if (absDr === 0 && absDc === 0) return startCell.value

  let snapR, snapC, length
  if (absDc >= absDr) {
    snapR = 0; snapC = dc > 0 ? 1 : -1; length = absDc
  } else {
    snapR = dr > 0 ? 1 : -1; snapC = 0; length = absDr
  }

  return [
    Math.max(0, Math.min(rows.value - 1, startCell.value[0] + snapR * length)),
    Math.max(0, Math.min(cols.value - 1, startCell.value[1] + snapC * length)),
  ]
}

function getCellFromEvent(e) {
  if (!gridRef.value) return null
  const rect = gridRef.value.getBoundingClientRect()
  const cellW = rect.width / cols.value
  const cellH = rect.height / rows.value
  const clientX = e.touches ? e.touches[0].clientX : e.clientX
  const clientY = e.touches ? e.touches[0].clientY : e.clientY
  const c = Math.floor((clientX - rect.left) / cellW)
  const r = Math.floor((clientY - rect.top) / cellH)
  if (r >= 0 && r < rows.value && c >= 0 && c < cols.value) return [r, c]
  return null
}

function handlePointerDown(e) {
  if (!props.interactive) return
  e.preventDefault()
  const cell = getCellFromEvent(e)
  if (cell) {
    selecting.value = true
    startCell.value = cell
    endCell.value = cell
  }
}

function handlePointerMove(e) {
  if (!selecting.value || !props.interactive) return
  e.preventDefault()
  const cell = getCellFromEvent(e)
  if (cell) endCell.value = cell
}

function handlePointerUp(e) {
  if (!selecting.value || !props.interactive) return
  e.preventDefault()
  const snapped = getSnappedEnd()
  if (startCell.value && snapped && props.onSelect) {
    props.onSelect(`${startCell.value[0]}:${startCell.value[1]}-${snapped[0]}:${snapped[1]}`)
  }
  selecting.value = false
  startCell.value = null
  endCell.value = null
}

function handleMouseLeave() {
  if (selecting.value) {
    selecting.value = false
    startCell.value = null
    endCell.value = null
  }
}

const highlightColors = [
  'rgba(120, 95, 235, 0.35)', 'rgba(34, 197, 94, 0.35)', 'rgba(234, 179, 8, 0.35)',
  'rgba(59, 130, 246, 0.35)', 'rgba(236, 72, 153, 0.35)', 'rgba(6, 182, 212, 0.35)',
  'rgba(249, 115, 22, 0.35)', 'rgba(16, 185, 129, 0.35)', 'rgba(139, 92, 246, 0.35)',
  'rgba(14, 165, 233, 0.35)',
]

function getCellBg(rIdx, cIdx) {
  const key = `${rIdx}:${cIdx}`
  const highlight = highlightedCells.value[key]
  const isSelecting = selectionCells.value.has(key)
  if (isSelecting) return 'rgba(120, 95, 235, 0.5)'
  if (highlight) {
    if (highlight.length === 1) return highlightColors[highlight[0]]
    const c1 = highlightColors[highlight[0]]
    const c2 = highlightColors[highlight[1]]
    const s = 4
    return `repeating-linear-gradient(45deg, ${c1} 0px, ${c1} ${s}px, ${c2} ${s}px, ${c2} ${s * 2}px)`
  }
  return 'transparent'
}
</script>

<template>
  <div
    class="ws-grid-container"
    ref="gridRef"
    @mousedown="handlePointerDown"
    @mousemove="handlePointerMove"
    @mouseup="handlePointerUp"
    @mouseleave="handleMouseLeave"
    @touchstart="handlePointerDown"
    @touchmove="handlePointerMove"
    @touchend="handlePointerUp"
    :style="{
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      userSelect: 'none',
      touchAction: 'none',
    }"
  >
    <template v-for="(row, rIdx) in grid" :key="rIdx">
      <div
        v-for="(letter, cIdx) in row"
        :key="`${rIdx}:${cIdx}`"
        :class="['ws-cell', highlightedCells[`${rIdx}:${cIdx}`] ? 'ws-cell-found' : '', selectionCells.has(`${rIdx}:${cIdx}`) ? 'ws-cell-selecting' : '']"
        :style="{ background: getCellBg(rIdx, cIdx) }"
      >
        {{ letter }}
      </div>
    </template>
  </div>
</template>

<style scoped>
.ws-grid-container {
  gap: 2px;
  background: #e5e7eb;
  padding: 4px;
  border-radius: 8px;
  cursor: crosshair;
  max-width: 100%;
  max-height: 100%;
  margin: 0 auto;
  aspect-ratio: 1;
  width: min(100%, calc(100vh - 200px));
}

.ws-cell {
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: white;
  font-size: clamp(12px, 2.5vw, 20px);
  font-weight: 800;
  color: #333;
  text-transform: uppercase;
  transition: background 0.1s;
  border-radius: 2px;
}

.ws-cell-found {
  color: #555;
}

.ws-cell-selecting {
  color: white;
}
</style>
