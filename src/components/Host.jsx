import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { API_URL, WS_URL, HOST_URL } from '../config'
import Crossword from './Crossword'
import WordSearchGrid from './WordSearchGrid'
import Logo from '../logo/2_horizontal.svg'

const GameState = {
  WAITING_FOR_PLAYERS: "waiting_for_players",
  WAITING_FOR_ANSWER: "waiting_for_answer",
  ACTIVE: "active",
  ROUND_FINISHED: "round_finished",
  FINISHED: "finished"
}

const ResponseType = {
  GAME_STATE: "game_state",
  NEW_PLAYER: "new_player",
  ROUND_START: "round_start",
  ROUND_FINISHED: "round_finished",
  GAME_FINISHED: "game_finished",
  ROUND_END_TIMER: "round_end_timer",
  PLAYER_ANSWERED: "player_answered",
  WORD_FOUND: "word_found",
  UNKNOWN: "unknown"
}

function Host() {
  const params = useParams()
  const navigate = useNavigate()
  const [gameCode, setGameCode] = useState(params.gameCode || null)
  const [hostUid, setHostUid] = useState(params.uid || null)
  const [game, setGame] = useState(null)
  const [status, setStatus] = useState('Creating game...')
  const [error, setError] = useState(null)
  const [finalScores, setFinalScores] = useState(null)
  const [roundTimer, setRoundTimer] = useState(null)
  const [roundEndTimestamp, setRoundEndTimestamp] = useState(null)
  const [correctAnswer, setCorrectAnswer] = useState(null)
  const [roundQuestion, setRoundQuestion] = useState(null)
  const wsRef = useRef(null)
  const reconnectTimeoutRef = useRef(null)
  const timerIntervalRef = useRef(null)
  const autoNextTimeoutRef = useRef(null)
  const isCreatingRef = useRef(false)
  const shouldConnectRef = useRef(true)
  const wsConnectedRef = useRef(false)
  const connectionAttempts = useRef(0)
  const isInitialConnection = useRef(true)

  useEffect(() => {
    if (params.gameCode && params.uid) {
      shouldConnectRef.current = true
      connectionAttempts.current = 0
      isInitialConnection.current = false
      setGameCode(params.gameCode)
      setHostUid(params.uid)
      setStatus('Connecting...')
      connectWebSocket(params.gameCode, params.uid)
    } else if (!isCreatingRef.current) {
      isCreatingRef.current = true
      shouldConnectRef.current = true
      connectionAttempts.current = 0
      isInitialConnection.current = true
      createGame()
    }

    return () => {
      shouldConnectRef.current = false
      if (wsRef.current) wsRef.current.close(1000, 'Component unmounting')
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current)
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current)
      if (autoNextTimeoutRef.current) clearInterval(autoNextTimeoutRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (roundEndTimestamp) {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current)
      const updateTimer = () => {
        const now = Math.floor(Date.now() / 1000)
        const remaining = roundEndTimestamp - now
        setRoundTimer(remaining > 0 ? remaining : 0)
      }
      updateTimer()
      timerIntervalRef.current = setInterval(updateTimer, 1000)
      return () => { if (timerIntervalRef.current) clearInterval(timerIntervalRef.current) }
    } else {
      setRoundTimer(null)
      if (timerIntervalRef.current) { clearInterval(timerIntervalRef.current); timerIntervalRef.current = null }
    }
  }, [roundEndTimestamp])

  const createGame = async () => {
    try {
      const response = await fetch(`${API_URL}/create`, { method: 'POST' })
      const data = await response.json()
      setGameCode(data.code)
      setHostUid(data.host_uid)
      setStatus('Game created! Connecting...')
      window.history.replaceState(null, '', `/host/${data.code}/${data.host_uid}`)
      shouldConnectRef.current = true
      connectionAttempts.current = 0
      connectWebSocket(data.code, data.host_uid)
    } catch (err) {
      setError('Failed to create game: ' + err.message)
    }
  }

  const connectWebSocket = (code, uid) => {
    if (!shouldConnectRef.current) return
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return
    if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
      wsRef.current.close(1000, 'Reconnecting')
    }
    connectionAttempts.current += 1
    const ws = new WebSocket(`${WS_URL}/ws/${code}?uid=${uid}`)
    wsRef.current = ws
    wsConnectedRef.current = false

    ws.onopen = () => {
      wsConnectedRef.current = true
      connectionAttempts.current = 0
      isInitialConnection.current = false
      setError(null)
    }
    ws.onmessage = (event) => {
      if (!event.data) return
      try { handleMessage(JSON.parse(event.data)) } catch (e) { console.log('Non-JSON message:', event.data) }
    }
    ws.onerror = () => setError('Connection error')
    ws.onclose = (event) => {
      if (!wsConnectedRef.current && shouldConnectRef.current) {
        if (connectionAttempts.current >= 3 && !isInitialConnection.current) {
          setError('Game not found. Redirecting...')
          shouldConnectRef.current = false
          setTimeout(() => navigate('/'), 1500)
          return
        }
        reconnectTimeoutRef.current = setTimeout(() => connectWebSocket(code, uid), 1000)
        return
      }
      if (shouldConnectRef.current && event.code !== 1000 && event.code !== 1001) {
        reconnectTimeoutRef.current = setTimeout(() => connectWebSocket(code, uid), 1000)
      }
    }
  }

  const handleMessage = (message) => {
    console.log('Received:', message)

    switch (message.event) {
      case ResponseType.GAME_STATE:
        setGame(message.data)
        if (message.data.state === GameState.WAITING_FOR_PLAYERS) {
          setStatus('Waiting for players...')
        } else if (message.data.state === GameState.WAITING_FOR_ANSWER) {
          setStatus(`Round ${message.data.round + 1} in progress`)
        } else if (message.data.state === GameState.ACTIVE) {
          const found = Object.keys(message.data.data?.found_words || {}).length
          const total = message.data.questions?.length || 0
          setStatus(`Word Search — ${found}/${total} found`)
        } else if (message.data.state === GameState.ROUND_FINISHED) {
          setStatus('Round finished!')
        } else {
          setStatus('Connected')
        }
        break

      case ResponseType.NEW_PLAYER:
        setGame(prev => ({
          ...prev,
          players: { ...prev?.players, [message.data.uid]: message.data }
        }))
        setStatus(`${message.data.name} joined!`)
        break

      case ResponseType.ROUND_START:
        setGame(message.data)
        setRoundTimer(null)
        setRoundEndTimestamp(null)
        setCorrectAnswer(null)
        setRoundQuestion(null)
        setStatus(`Round ${message.data.round + 1} started`)
        break

      case ResponseType.WORD_FOUND:
        setGame(prev => {
          if (!prev) return prev
          const newFound = { ...(prev.data?.found_words || {}) }
          newFound[message.data.word] = {
            finder_name: message.data.finder_name,
            coords: message.data.coords
          }
          const newPlayers = message.data.players.reduce((acc, p) => {
            acc[p.uid] = p
            return acc
          }, {})
          return {
            ...prev,
            data: { ...prev.data, found_words: newFound },
            players: newPlayers
          }
        })
        setStatus(`${message.data.finder_name} found "${message.data.word}"! (${message.data.found_count}/${message.data.total_count})`)
        break

      case ResponseType.ROUND_FINISHED:
        setRoundTimer(null)
        setRoundEndTimestamp(null)
        setCorrectAnswer(message.data.correct_answer)
        setRoundQuestion(message.data.question)
        setGame(prev => ({
          ...prev,
          state: GameState.ROUND_FINISHED,
          answers: [...(prev?.answers || []), message.data.correct_answer],
          players: message.data.players.reduce((acc, p) => { acc[p.uid] = p; return acc }, {})
        }))
        break

      case ResponseType.GAME_FINISHED:
        setStatus('Game finished!')
        setFinalScores(message.data)
        break

      case ResponseType.PLAYER_ANSWERED:
        setGame(prev => {
          if (!prev) return prev
          return {
            ...prev,
            players: {
              ...prev.players,
              [message.data.uid]: { ...prev.players[message.data.uid], ...message.data }
            }
          }
        })
        break

      case ResponseType.ROUND_END_TIMER:
        setRoundEndTimestamp(message.data)
        break

      default:
        console.log('Unknown event:', message)
    }
  }

  const startGame = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send('NEXT')
      setStatus('Starting game...')
    }
  }

  const nextRound = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send('NEXT')
      setStatus('Starting next round...')
    }
  }

  const endGame = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send('END_GAME')
    }
  }

  const getCurrentQuestion = () => {
    if (!game || !game.questions || game.questions.length === 0) return null
    return game.questions[game.questions.length - 1]
  }

  const renderQuestionContent = (question, isReveal = false) => {
    if (!question) return null
    const gameType = game.game_type

    switch (gameType) {
      case 'crossword':
        return (
          <Crossword
            gridData={game.data}
            questions={game.questions}
            answers={game.answers}
            currentRound={isReveal ? -1 : game.round}
          />
        )

      case 'multiple-choice':
        return (
          <div className="mc-options-host">
            {question.data?.options?.map((option, idx) => (
              <div
                key={idx}
                className={`mc-option-card mc-color-${idx % 4} ${isReveal && option === correctAnswer ? 'mc-correct' : ''}`}
              >
                <span className="mc-option-label">{String.fromCharCode(65 + idx)}</span>
                <span className="mc-option-text">{option}</span>
              </div>
            ))}
          </div>
        )

      case 'matching': {
        const usedAnswers = game.answers || []
        return (
          <div className="matching-host">
            <div className="matching-left-term">{question.text}</div>
            <div className="matching-options">
              {game.data?.options?.map((opt, idx) => {
                const isUsed = usedAnswers.includes(opt) && opt !== correctAnswer
                return (
                  <div
                    key={idx}
                    className={`matching-option-card ${isReveal && opt === correctAnswer ? 'mc-correct' : ''} ${isUsed ? 'matching-used' : ''}`}
                  >
                    {opt}
                  </div>
                )
              })}
            </div>
          </div>
        )
      }

      case 'scramble':
        return (
          <div className="scramble-host">
            <div className="scramble-letters">
              {question.text.split('').map((letter, idx) => (
                <div key={idx} className="scramble-tile">{letter}</div>
              ))}
            </div>
          </div>
        )

      case 'fill-the-gaps':
        return (
          <div className="fill-gaps-host">
            <div className="fill-gaps-sentence">
              {question.text.split('_____').map((part, idx, arr) => (
                <span key={idx}>
                  {part}
                  {idx < arr.length - 1 && <span className="fill-gaps-blank">__________</span>}
                </span>
              ))}
            </div>
          </div>
        )

      default:
        return <div className="generic-question">{question.text}</div>
    }
  }

  const isTextOnlyType = () => {
    const t = game.game_type
    return t === 'scramble' || t === 'fill-the-gaps' || (t !== 'crossword' && t !== 'multiple-choice' && t !== 'matching' && t !== 'word-search')
  }

  const renderWordBank = () => {
    if (!game.data?.word_bank) return null
    const remaining = game.data.word_bank.filter(w => !(game.answers || []).includes(w))
    if (remaining.length === 0) return null
    return (
      <div className={`word-bank ${isTextOnlyType() ? 'word-bank-main' : ''}`}>
        <h3>Word Bank</h3>
        <div className="word-bank-list">
          {remaining.map((word, idx) => (
            <div key={idx} className="word-bank-item">{word}</div>
          ))}
        </div>
      </div>
    )
  }

  const getQuestionBoxText = (question) => {
    if (!question) return ''
    const gameType = game.game_type
    switch (gameType) {
      case 'crossword': return question.text
      case 'multiple-choice': return question.text
      case 'scramble': return 'Unscramble this word!'
      case 'fill-the-gaps': return 'Fill in the blank!'
      case 'matching': return 'Match the pair!'
      case 'word-search': return `Find the word: ${question.text}`
      default: return question.text
    }
  }

  // ── Word search host view ──
  const renderWordSearchHost = () => {
    const grid = game.data?.grid
    const foundWords = game.data?.found_words || {}
    const questions = game.questions || []
    // Build word list: from questions if available, otherwise from found_words + word_bank
    let allWords = questions.map(q => q.text)
    if (allWords.length === 0 && game.data?.word_bank) {
      allWords = game.data.word_bank
    }
    // Also include any found words not in the list
    Object.keys(foundWords).forEach(w => {
      if (!allWords.some(aw => aw.toLowerCase() === w)) {
        allWords.push(w)
      }
    })
    const foundCount = Object.keys(foundWords).length
    const totalCount = allWords.length || foundCount

    return (
      <>
        <div className="host-header">
          <div className="game-code-small">{gameCode}</div>
          <img src={Logo} alt="Logo" className="host-logo" />
          <span>{foundCount}/{totalCount} words found</span>
        </div>

        <div className="host-game-layout">
          <div className="host-main">
            {grid && (
              <WordSearchGrid
                grid={grid}
                foundWords={foundWords}
                interactive={false}
              />
            )}
          </div>

          <div className="host-sidebar">
            <div className="top-players">
              <h3>Top Players</h3>
              {top3Players.map((p, idx) => (
                <div
                  key={p.uid}
                  className={`top-player-item ${idx === 0 ? 'gold' : idx === 1 ? 'silver' : 'bronze'}`}
                >
                  <span>{p.name}</span>
                  <span>{p.score}</span>
                </div>
              ))}
              {players.length > 3 && (
                <div style={{ textAlign: 'center', marginTop: '8px', fontSize: '12px', color: '#666' }}>
                  +{players.length - 3} more
                </div>
              )}
            </div>

            <div className="ws-word-list">
              <h3>Words</h3>
              {[...allWords].sort((a, b) => {
                const aFound = !!foundWords[a.toLowerCase()]
                const bFound = !!foundWords[b.toLowerCase()]
                return aFound - bFound
              }).map((word, idx) => {
                const wordLower = word.toLowerCase()
                const found = foundWords[wordLower]
                return (
                  <div key={idx} className={`ws-word-item ${found ? 'ws-word-found' : ''}`}>
                    <span>{word}</span>
                    {found && <span className="ws-word-finder">{found.finder_name}</span>}
                  </div>
                )
              })}
            </div>

            <button className="btn-next-round" onClick={nextRound}>Next</button>
            <button className="btn-end-game" onClick={endGame}>End Game</button>
          </div>
        </div>
      </>
    )
  }

  if (finalScores) {
    const podiumOrder = [finalScores[1], finalScores[0], finalScores[2]].filter(Boolean)
    const rest = finalScores.slice(3)
    return (
      <div className="host-gameover">
        <h1 className="host-gameover-title">Game Over</h1>

        <div className="host-podium">
          {podiumOrder.map((p) => {
            const rank = finalScores.indexOf(p) + 1
            const heights = { 1: 200, 2: 150, 3: 110 }
            const labels = { 1: 'gold', 2: 'silver', 3: 'bronze' }
            return (
              <div key={p.uid} className={`host-podium-slot host-podium-${labels[rank]}`}>
                <div className="host-podium-name">{p.name}</div>
                <div className="host-podium-score">{p.score} pts</div>
                <div className="host-podium-bar" style={{ height: `${heights[rank]}px` }}>
                  <span className="host-podium-rank">#{rank}</span>
                </div>
              </div>
            )
          })}
        </div>

        {rest.length > 0 && (
          <div className="host-gameover-rest">
            {rest.map((p, idx) => (
              <div key={p.uid} className="host-gameover-row">
                <span>{idx + 4}. {p.name}</span>
                <span>{p.score} pts</span>
              </div>
            ))}
          </div>
        )}

        <button className="host-gameover-btn" onClick={() => navigate('/')}>Back to Menu</button>
      </div>
    )
  }

  if (!game) {
    return (
      <div className="container">
        <h1>Host</h1>
        <p>{status}</p>
        {error && <div className="status error">{error}</div>}
      </div>
    )
  }

  const players = Object.values(game.players || {})
  const sortedPlayers = [...players].sort((a, b) => b.score - a.score)
  const top3Players = sortedPlayers.slice(0, 3)
  const currentQuestion = getCurrentQuestion()
  const answeredCount = players.filter(p => p.answered).length
  const isWordSearch = game.game_type === 'word-search'

  return (
    <div className="container">
      {roundTimer !== null && roundTimer > 0 && (
        <div className="timer">
          ⏱ {roundTimer}s
        </div>
      )}

      {game.state === GameState.WAITING_FOR_PLAYERS && (
        <div className="waiting-room">
          <div className="waiting-room-header">
            <img src={Logo} alt="Logo" className="waiting-logo" />
          </div>

          <div className="waiting-room-join">
            <div className="waiting-room-code">
              <div className="code-label">https://play.toolsedu.com/</div>
              <div className="code-value">{gameCode}</div>
            </div>
            <div className="waiting-room-qr">
              <QRCodeSVG
                value={`${HOST_URL}/player/${gameCode}`}
                size={160}
                bgColor="transparent"
                fgColor="#785feb"
                level="M"
              />
              <div className="qr-label">Scan to join</div>
            </div>
          </div>

          <div className="waiting-room-players">
            <div className="players-count">{players.length} player{players.length !== 1 ? 's' : ''} joined</div>
            <div className="players-list">
              {players.map(player => (
                <div key={player.uid} className="player-item">
                  {player.name}
                </div>
              ))}
            </div>
          </div>

          <div className="waiting-room-actions">
            <button onClick={startGame} disabled={players.length === 0} className="btn-start">
              Start Game
            </button>
          </div>

          {error && <div className="status error">{error}</div>}
        </div>
      )}

      {game.state === GameState.ACTIVE && isWordSearch && renderWordSearchHost()}

      {game.state === GameState.WAITING_FOR_ANSWER && (
        <>
          <div className="host-header">
            <div className="game-code-small">{gameCode}</div>
            <img src={Logo} alt="Logo" className="host-logo" />
            <span>Round {game.round + 1} &middot; {answeredCount}/{players.length} answered</span>
          </div>

          <div className="question-box">
            {getQuestionBoxText(currentQuestion)}
          </div>

          <div className="host-game-layout">
            <div className="host-main">
              {renderQuestionContent(currentQuestion)}
            </div>

            <div className="host-sidebar">
              <div className="top-players">
                <h3>Top Players</h3>
                {top3Players.map((player, idx) => (
                  <div
                    key={player.uid}
                    className={`top-player-item ${idx === 0 ? 'gold' : idx === 1 ? 'silver' : 'bronze'}`}
                  >
                    <span>{player.name}</span>
                    <span>{player.score}</span>
                  </div>
                ))}
                {players.length > 3 && (
                  <div style={{ textAlign: 'center', marginTop: '8px', fontSize: '12px', color: '#666' }}>
                    +{players.length - 3} more
                  </div>
                )}
              </div>
              {!isTextOnlyType() && renderWordBank()}
              <button className="btn-next-round" onClick={nextRound}>Next</button>
              <button className="btn-end-game" onClick={endGame}>End Game</button>
            </div>
          </div>

          {isTextOnlyType() && renderWordBank()}
        </>
      )}

      {game.state === GameState.ROUND_FINISHED && (
        <>
          <div className="host-header">
            <div className="game-code-small">{gameCode}</div>
            <img src={Logo} alt="Logo" className="host-logo" />
            <span>Round {game.round + 1} Complete</span>
          </div>

          <div className="host-game-layout">
            <div className="host-main">
              {renderQuestionContent(roundQuestion || currentQuestion, true)}
            </div>

            <div className="host-sidebar">
              <div className="top-players">
                <h3>Top Players</h3>
                {top3Players.map((player, idx) => (
                  <div
                    key={player.uid}
                    className={`top-player-item ${idx === 0 ? 'gold' : idx === 1 ? 'silver' : 'bronze'}`}
                  >
                    <span>{player.name}</span>
                    <span>{player.score}</span>
                  </div>
                ))}
                {players.length > 3 && (
                  <div style={{ textAlign: 'center', marginTop: '8px', fontSize: '12px', color: '#666' }}>
                    +{players.length - 3} more
                  </div>
                )}
              </div>
              {!isTextOnlyType() && renderWordBank()}
            </div>
          </div>

          {isTextOnlyType() && renderWordBank()}

          {/* Modal popup */}
          <div className="modal-overlay">
            <div className="modal-content">
              <h2>Round {game.round + 1} Complete!</h2>
              <div className="correct-answer-big">{correctAnswer}</div>

              <div className="modal-leaderboard">
                <h3>Standings</h3>
                {sortedPlayers.map((player, idx) => (
                  <div
                    key={player.uid}
                    className={`leaderboard-item ${idx === 0 ? 'first' : idx === 1 ? 'second' : idx === 2 ? 'third' : ''}`}
                  >
                    <span>{idx + 1}. {player.name}</span>
                    <span>{player.score} pts</span>
                  </div>
                ))}
              </div>

              <button onClick={nextRound}>Next Round</button>
            </div>
          </div>
        </>
      )}

      {error && <div className="status error">{error}</div>}
    </div>
  )
}

export default Host
