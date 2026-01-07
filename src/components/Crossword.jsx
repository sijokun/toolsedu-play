import { useMemo } from 'react'

function Crossword({ data, answers = [], currentWordIndex = -1 }) {
  if (!data || !data.words) {
    return null
  }

  const { width, height, words } = data

  // Build a grid with letters from answers
  // Each cell stores: { active: boolean, letter: string | null, highlight: boolean }
  const grid = useMemo(() => {
    const cells = Array(height).fill(null).map(() => 
      Array(width).fill(null).map(() => ({ active: false, letter: null, highlight: false }))
    )

    words.forEach((word, wordIndex) => {
      const { x, y, length, direction } = word
      const answer = answers[wordIndex] || ''
      const isCurrentWord = wordIndex === currentWordIndex
      
      for (let i = 0; i < length; i++) {
        const letter = answer[i] || null
        
        if (direction === 'horizontal') {
          if (y < height && x + i < width) {
            cells[y][x + i].active = true
            if (isCurrentWord) {
              cells[y][x + i].highlight = true
            }
            // Only set letter if we have one (don't overwrite existing letters)
            if (letter) {
              cells[y][x + i].letter = letter.toUpperCase()
            }
          }
        } else {
          if (y + i < height && x < width) {
            cells[y + i][x].active = true
            if (isCurrentWord) {
              cells[y + i][x].highlight = true
            }
            if (letter) {
              cells[y + i][x].letter = letter.toUpperCase()
            }
          }
        }
      }
    })

    return cells
  }, [width, height, words, answers, currentWordIndex])

  return (
    <div className="crossword-container">
      <table className="crossword-table">
        <tbody>
          {grid.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, colIndex) => (
                <td
                  key={`${rowIndex}-${colIndex}`}
                  className={`${cell.active ? '' : 'empty'} ${cell.highlight ? 'highlight' : ''}`}
                >
                  {cell.active && (
                    <div className={`content ${cell.letter ? 'answer-content' : ''}`}>
                      {cell.letter || ''}
                    </div>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default Crossword

