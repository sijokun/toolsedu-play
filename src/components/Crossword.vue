<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue'
import './Crossword.css'

const props = defineProps({
  gridData: Object,
  questions: { type: Array, default: () => [] },
  answers: { type: Array, default: () => [] },
  currentRound: { type: Number, default: -1 },
})

const wrapRef = ref(null)
const parentSize = ref({ w: 0, h: 0 })
let ro = null

onMounted(() => {
  if (!wrapRef.value) return
  ro = new ResizeObserver((entries) => {
    const cr = entries[0].contentRect
    parentSize.value = { w: cr.width, h: cr.height }
  })
  ro.observe(wrapRef.value)
})

onUnmounted(() => { if (ro) ro.disconnect() })

const cols = computed(() => props.gridData?.width || 0)
const rows = computed(() => props.gridData?.height || 0)
const crossword = computed(() => props.gridData?.crossword || [])

const cells = computed(() => {
  if (!rows.value || !cols.value) return []
  const grid = Array(rows.value).fill(null).map((_, r) =>
    Array(cols.value).fill(null).map((_, c) => {
      const cell = crossword.value[r]?.[c] ?? ''
      const isActive = cell === '*' || cell === '-'
      return { active: isActive, letter: cell === '-' ? '-' : null, highlight: false, isDash: cell === '-' }
    })
  )

  props.answers.forEach((ans, idx) => {
    const q = props.questions[idx]
    if (!q?.data || !ans) return
    const { x, y, length, direction } = q.data
    for (let i = 0; i < length; i++) {
      const targetY = direction === 'horizontal' ? y : y + i
      const targetX = direction === 'horizontal' ? x + i : x
      if (targetY < rows.value && targetX < cols.value) {
        grid[targetY][targetX].letter = ans[i]?.toUpperCase() || null
      }
    }
  })

  if (props.currentRound >= 0 && props.currentRound < props.questions.length) {
    const currentQ = props.questions[props.currentRound]
    if (currentQ?.data) {
      const { x, y, length, direction } = currentQ.data
      for (let i = 0; i < length; i++) {
        const targetY = direction === 'horizontal' ? y : y + i
        const targetX = direction === 'horizontal' ? x + i : x
        if (targetY < rows.value && targetX < cols.value) {
          grid[targetY][targetX].highlight = true
        }
      }
    }
  }

  return grid.flat()
})

const cellSize = computed(() => {
  if (!rows.value || !cols.value || !parentSize.value.w || !parentSize.value.h) return 0
  const s1 = parentSize.value.w / cols.value
  const s2 = parentSize.value.h / rows.value
  return Math.floor(Math.min(s1, s2))
})

const boardStyle = computed(() => ({
  gridTemplateColumns: `repeat(${cols.value}, ${cellSize.value}px)`,
  gridTemplateRows: `repeat(${rows.value}, ${cellSize.value}px)`,
  width: `${cellSize.value * cols.value}px`,
  height: `${cellSize.value * rows.value}px`,
}))

const inputStyle = computed(() => ({
  fontSize: `${Math.max(12, Math.floor(cellSize.value * 0.6))}px`,
}))

function getCellClasses(index) {
  const cell = cells.value[index]
  if (!cell.active) return ''
  const r = Math.floor(index / cols.value)
  const c = index % cols.value
  const rightIdx = r * cols.value + (c + 1)
  const hasRightNeighbor = c < cols.value - 1 && cells.value[rightIdx].active
  const bottomIdx = (r + 1) * cols.value + c
  const hasBottomNeighbor = r < rows.value - 1 && cells.value[bottomIdx].active

  let classes = 'crossword-cell has-top-border has-left-border'
  if (!hasRightNeighbor) classes += ' has-right-border'
  if (!hasBottomNeighbor) classes += ' has-bottom-border'
  if (cell.highlight) classes += ' highlight'
  return classes
}
</script>

<template>
  <div v-if="gridData && gridData.crossword" class="crossword-render-container">
    <div ref="wrapRef" class="crossword-wrap">
      <div class="crossword-board" :style="boardStyle">
        <div
          v-for="(cell, i) in cells"
          :key="i"
          :class="getCellClasses(i)"
          :style="{ width: cellSize + 'px', height: cellSize + 'px', background: 'transparent' }"
        >
          <input
            v-if="cell.active"
            :value="cell.letter || ''"
            readonly
            maxlength="1"
            class="crossword-input"
            :style="inputStyle"
            tabindex="-1"
          />
        </div>
      </div>
    </div>
  </div>
</template>
