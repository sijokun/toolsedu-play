import { useMemo, useState, useEffect, useRef } from 'react'
import './Crossword.css'

function Crossword({ data, answers = [], currentWordIndex = -1, onUpdate }) {
  const wrapRef = useRef(null)
  const [parentSize, setParentSize] = useState({ w: 0, h: 0 })

  if (!data || !data.words) {
    return null
  }

  const { width: cols, height: rows, words } = data

  // Build the grid logic
  const gridData = useMemo(() => {
    const cells = Array(rows).fill(null).map(() =>
      Array(cols).fill(null).map(() => ({ active: false, letter: null, highlight: false }))
    )

    words.forEach((word, wordIndex) => {
      const { x, y, length, direction } = word
      const answer = answers[wordIndex] || ''
      const isCurrentWord = wordIndex === currentWordIndex

      for (let i = 0; i < length; i++) {
        const letter = answer[i] || null
        const targetY = direction === 'horizontal' ? y : y + i
        const targetX = direction === 'horizontal' ? x + i : x

        if (targetY < rows && targetX < cols) {
          cells[targetY][targetX].active = true
          if (isCurrentWord) {
            cells[targetY][targetX].highlight = true
          }
          if (letter) {
            cells[targetY][targetX].letter = letter.toUpperCase()
          }
        }
      }
    })

    return cells.flat()
  }, [rows, cols, words, answers, currentWordIndex])

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

  const getCellStyle = (index) => {
    return {
      width: `${cellSize}px`,
      height: `${cellSize}px`,
      background: 'transparent'
    }
  }

  const getCellClasses = (index) => {
    const cell = gridData[index]
    if (!cell.active) return ''

    const r = Math.floor(index / cols)
    const c = index % cols

    const isLastCol = c === cols - 1
    const isLastRow = r === rows - 1

    const rightIdx = r * cols + (c + 1)
    const hasRightNeighbor = !isLastCol && gridData[rightIdx].active

    const bottomIdx = (r + 1) * cols + c
    const hasBottomNeighbor = !isLastRow && gridData[bottomIdx].active

    let classes = 'crossword-cell has-top-border has-left-border'
    if (!hasRightNeighbor) classes += ' has-right-border'
    if (!hasBottomNeighbor) classes += ' has-bottom-border'
    if (cell.highlight) classes += ' highlight'

    return classes
  }

  const onInput = (index, val) => {
    if (onUpdate) {
      // Logic to map flat index back to which word/index it belongs to might be complex 
      // but the Vue component just emits the whole 2D array.
      // However, our data structure is different.
      // For now, if onUpdate is provided, we can try to implement it, 
      // but the original React component didn't have it.
    }
  }

  return (
    <div className="crossword-render-container">
      <div ref={wrapRef} className="crossword-wrap">
        <div className="crossword-board" style={boardStyle}>
          {gridData.map((cell, i) => (
            <div
              key={i}
              className={getCellClasses(i)}
              style={getCellStyle(i)}
            >
              {cell.active && (
                <input
                  value={cell.letter || ''}
                  onChange={(e) => onInput(i, e.target.value)}
                  maxLength={1}
                  className="crossword-input"
                  style={inputStyle}
                  readOnly={!onUpdate}
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

