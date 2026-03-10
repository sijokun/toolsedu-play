import { useMemo, useState, useEffect, useRef } from 'react'
import './Crossword.css'

/**
 * Crossword grid renderer.
 *
 * Props:
 *   gridData: game.data — { width, height, crossword: string[][] }
 *   questions: game.questions array (each has .data with { x, y, length, direction })
 *   answers: game.answers array (revealed answers for previous rounds)
 *   currentRound: current round index (-1 = none)
 */
function Crossword({ gridData, questions = [], answers = [], currentRound = -1 }) {
  const wrapRef = useRef(null)
  const [parentSize, setParentSize] = useState({ w: 0, h: 0 })

  if (!gridData || !gridData.crossword) {
    return null
  }

  const { width: cols, height: rows, crossword } = gridData

  // Build the grid from game.data.crossword and overlay answered words
  const cells = useMemo(() => {
    const grid = Array(rows).fill(null).map((_, r) =>
      Array(cols).fill(null).map((_, c) => {
        const cell = crossword[r]?.[c] ?? ''
        // "*" = letter cell (active), "-" = dash cell (rendered as dash), "" = empty, " " = space separator
        const isActive = cell === '*' || cell === '-'
        return { active: isActive, letter: cell === '-' ? '-' : null, highlight: false, isDash: cell === '-' }
      })
    )

    // Fill in answered words from previous rounds
    answers.forEach((ans, idx) => {
      const q = questions[idx]
      if (!q?.data || !ans) return
      const { x, y, length, direction } = q.data
      for (let i = 0; i < length; i++) {
        const targetY = direction === 'horizontal' ? y : y + i
        const targetX = direction === 'horizontal' ? x + i : x
        if (targetY < rows && targetX < cols) {
          grid[targetY][targetX].letter = ans[i]?.toUpperCase() || null
        }
      }
    })

    // Highlight current word
    if (currentRound >= 0 && currentRound < questions.length) {
      const currentQ = questions[currentRound]
      if (currentQ?.data) {
        const { x, y, length, direction } = currentQ.data
        for (let i = 0; i < length; i++) {
          const targetY = direction === 'horizontal' ? y : y + i
          const targetX = direction === 'horizontal' ? x + i : x
          if (targetY < rows && targetX < cols) {
            grid[targetY][targetX].highlight = true
          }
        }
      }
    }

    return grid.flat()
  }, [rows, cols, crossword, questions, answers, currentRound])

  // Resize Observer for responsive square cells
  useEffect(() => {
    if (!wrapRef.current) return
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0].contentRect
      setParentSize({ w: cr.width, h: cr.height })
    })
    ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [])

  const cellSize = useMemo(() => {
    if (!rows || !cols || !parentSize.w || !parentSize.h) return 0
    const s1 = parentSize.w / cols
    const s2 = parentSize.h / rows
    return Math.floor(Math.min(s1, s2))
  }, [rows, cols, parentSize])

  const boardStyle = {
    gridTemplateColumns: `repeat(${cols}, ${cellSize}px)`,
    gridTemplateRows: `repeat(${rows}, ${cellSize}px)`,
    width: `${cellSize * cols}px`,
    height: `${cellSize * rows}px`
  }

  const inputStyle = {
    fontSize: `${Math.max(12, Math.floor(cellSize * 0.6))}px`
  }

  const getCellClasses = (index) => {
    const cell = cells[index]
    if (!cell.active) return ''

    const r = Math.floor(index / cols)
    const c = index % cols

    const isLastCol = c === cols - 1
    const isLastRow = r === rows - 1

    const rightIdx = r * cols + (c + 1)
    const hasRightNeighbor = !isLastCol && cells[rightIdx].active

    const bottomIdx = (r + 1) * cols + c
    const hasBottomNeighbor = !isLastRow && cells[bottomIdx].active

    let classes = 'crossword-cell has-top-border has-left-border'
    if (!hasRightNeighbor) classes += ' has-right-border'
    if (!hasBottomNeighbor) classes += ' has-bottom-border'
    if (cell.highlight) classes += ' highlight'

    return classes
  }

  return (
    <div className="crossword-render-container">
      <div ref={wrapRef} className="crossword-wrap">
        <div className="crossword-board" style={boardStyle}>
          {cells.map((cell, i) => (
            <div
              key={i}
              className={getCellClasses(i)}
              style={{ width: `${cellSize}px`, height: `${cellSize}px`, background: 'transparent' }}
            >
              {cell.active && (
                <input
                  value={cell.letter || ''}
                  readOnly
                  maxLength={1}
                  className="crossword-input"
                  style={inputStyle}
                  tabIndex={-1}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default Crossword
