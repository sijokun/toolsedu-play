import { useState, useRef, useCallback, useMemo } from 'react'

/**
 * Interactive word search grid with click-drag selection.
 *
 * Props:
 *   grid: string[][] — 2D array of uppercase letters
 *   foundWords: Record<string, { finder_name, coords }> — already found words
 *   onSelect: (coords: string) => void — called with "row:col-row:col" when player selects
 *   interactive: boolean — whether player can select (false for host view)
 *   playerUid: string — current player uid (to color own finds differently)
 */
function WordSearchGrid({ grid, foundWords = {}, onSelect, interactive = false, playerUid }) {
  const [selecting, setSelecting] = useState(false)
  const [startCell, setStartCell] = useState(null)
  const [endCell, setEndCell] = useState(null)
  const gridRef = useRef(null)

  const rows = grid.length
  const cols = grid[0]?.length || 0

  // Parse coords string to array of [row, col] pairs
  const parseCoordsToPath = useCallback((coords) => {
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
  }, [])

  // Build set of highlighted cells from found words
  const highlightedCells = useMemo(() => {
    const map = {} // "r:c" -> [colorIdx, ...]
    const hashWord = (w) => {
      let h = 0
      for (let i = 0; i < w.length; i++) h = ((h << 5) - h + w.charCodeAt(i)) | 0
      return Math.abs(h)
    }
    const words = Object.entries(foundWords)
    words.forEach(([word, info]) => {
      const colorIdx = hashWord(word) % 10
      const cells = parseCoordsToPath(info.coords)
      cells.forEach(([r, c]) => {
        const key = `${r}:${c}`
        if (!map[key]) map[key] = []
        if (!map[key].includes(colorIdx)) map[key].push(colorIdx)
      })
    })
    return map
  }, [foundWords, parseCoordsToPath])

  // Build set of currently-being-selected cells
  const selectionCells = useMemo(() => {
    if (!selecting || !startCell || !endCell) return new Set()
    const dr = endCell[0] - startCell[0]
    const dc = endCell[1] - startCell[1]

    // Snap to closest valid direction (horizontal, vertical, diagonal)
    const absDr = Math.abs(dr)
    const absDc = Math.abs(dc)

    let snapR, snapC, length
    if (absDr === 0 && absDc === 0) {
      return new Set([`${startCell[0]}:${startCell[1]}`])
    } else if (absDc >= absDr) {
      // Horizontal
      snapR = 0; snapC = dc > 0 ? 1 : -1; length = absDc
    } else {
      // Vertical
      snapR = dr > 0 ? 1 : -1; snapC = 0; length = absDr
    }

    const set = new Set()
    for (let i = 0; i <= length; i++) {
      const r = startCell[0] + snapR * i
      const c = startCell[1] + snapC * i
      if (r >= 0 && r < rows && c >= 0 && c < cols) {
        set.add(`${r}:${c}`)
      }
    }
    return set
  }, [selecting, startCell, endCell, rows, cols])

  // Get snapped end cell for coordinate submission
  const getSnappedEnd = () => {
    if (!startCell || !endCell) return null
    const dr = endCell[0] - startCell[0]
    const dc = endCell[1] - startCell[1]
    const absDr = Math.abs(dr)
    const absDc = Math.abs(dc)

    let snapR, snapC, length
    if (absDr === 0 && absDc === 0) {
      return startCell
    } else if (absDc >= absDr) {
      snapR = 0; snapC = dc > 0 ? 1 : -1; length = absDc
    } else {
      snapR = dr > 0 ? 1 : -1; snapC = 0; length = absDr
    }

    const endR = startCell[0] + snapR * length
    const endC = startCell[1] + snapC * length
    return [
      Math.max(0, Math.min(rows - 1, endR)),
      Math.max(0, Math.min(cols - 1, endC))
    ]
  }

  const getCellFromEvent = (e) => {
    if (!gridRef.current) return null
    const rect = gridRef.current.getBoundingClientRect()
    const cellW = rect.width / cols
    const cellH = rect.height / rows

    // Support both mouse and touch
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY

    const c = Math.floor((clientX - rect.left) / cellW)
    const r = Math.floor((clientY - rect.top) / cellH)
    if (r >= 0 && r < rows && c >= 0 && c < cols) return [r, c]
    return null
  }

  const handlePointerDown = (e) => {
    if (!interactive) return
    e.preventDefault()
    const cell = getCellFromEvent(e)
    if (cell) {
      setSelecting(true)
      setStartCell(cell)
      setEndCell(cell)
    }
  }

  const handlePointerMove = (e) => {
    if (!selecting || !interactive) return
    e.preventDefault()
    const cell = getCellFromEvent(e)
    if (cell) {
      setEndCell(cell)
    }
  }

  const handlePointerUp = (e) => {
    if (!selecting || !interactive) return
    e.preventDefault()
    const snapped = getSnappedEnd()
    if (startCell && snapped && onSelect) {
      const coords = `${startCell[0]}:${startCell[1]}-${snapped[0]}:${snapped[1]}`
      onSelect(coords)
    }
    setSelecting(false)
    setStartCell(null)
    setEndCell(null)
  }

  const highlightColors = [
    'rgba(120, 95, 235, 0.35)',
    'rgba(34, 197, 94, 0.35)',
    'rgba(234, 179, 8, 0.35)',
    'rgba(59, 130, 246, 0.35)',
    'rgba(236, 72, 153, 0.35)',
    'rgba(6, 182, 212, 0.35)',
    'rgba(249, 115, 22, 0.35)',
    'rgba(16, 185, 129, 0.35)',
    'rgba(139, 92, 246, 0.35)',
    'rgba(14, 165, 233, 0.35)',
  ]

  return (
    <div
      className="ws-grid-container"
      ref={gridRef}
      onMouseDown={handlePointerDown}
      onMouseMove={handlePointerMove}
      onMouseUp={handlePointerUp}
      onMouseLeave={() => {
        if (selecting) {
          setSelecting(false)
          setStartCell(null)
          setEndCell(null)
        }
      }}
      onTouchStart={handlePointerDown}
      onTouchMove={handlePointerMove}
      onTouchEnd={handlePointerUp}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        userSelect: 'none',
        touchAction: 'none',
      }}
    >
      {grid.map((row, rIdx) =>
        row.map((letter, cIdx) => {
          const key = `${rIdx}:${cIdx}`
          const highlight = highlightedCells[key]
          const isSelecting = selectionCells.has(key)

          let bg = 'transparent'
          if (highlight) {
            if (highlight.length === 1) {
              bg = highlightColors[highlight[0]]
            } else {
              // Hatched stripes for overlapping words
              const c1 = highlightColors[highlight[0]]
              const c2 = highlightColors[highlight[1]]
              const s = 4 // stripe width in px
              bg = `repeating-linear-gradient(45deg, ${c1} 0px, ${c1} ${s}px, ${c2} ${s}px, ${c2} ${s * 2}px)`
            }
          }
          if (isSelecting) {
            bg = 'rgba(120, 95, 235, 0.5)'
          }

          return (
            <div
              key={key}
              className={`ws-cell ${highlight ? 'ws-cell-found' : ''} ${isSelecting ? 'ws-cell-selecting' : ''}`}
              style={{ background: bg }}
            >
              {letter}
            </div>
          )
        })
      )}
    </div>
  )
}

export default WordSearchGrid
