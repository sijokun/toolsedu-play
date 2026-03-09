import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { API_URL, WS_URL } from '../config'

const GameState = {
  WAITING_FOR_PLAYERS: "waiting_for_players",
  WAITING_FOR_ANSWER: "waiting_for_answer",
  ROUND_FINISHED: "round_finished",
  FINISHED: "finished"
}

const ResponseType = {
  GAME_STATE: "game_state",
  NEW_PLAYER: "new_player",
  ROUND_START: "round_start",
  ROUND_FINISHED: "round_finished",
  GAME_FINISHED: "game_finished",
  ANSWER: "answer",
  ROUND_END_TIMER: "round_end_timer",
  PLAYER_ANSWERED: "player_answered",
  UNKNOWN: "unknown"
}

function Player() {
  const params = useParams()
  const navigate = useNavigate()
  const [gameCode, setGameCode] = useState(params.gameCode && !params.uid ? params.gameCode : '')
  const [playerName, setPlayerName] = useState('')
  const [joined, setJoined] = useState(!!params.gameCode && !!params.uid)
  const [player, setPlayer] = useState(params.uid ? { uid: params.uid, name: 'Player', score: 0 } : null)
  const [game, setGame] = useState(null)
  const [answer, setAnswer] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState(null)
  const [finalScores, setFinalScores] = useState(null)
  const [roundTimer, setRoundTimer] = useState(null)
  const [roundEndTimestamp, setRoundEndTimestamp] = useState(null)
  const [answered, setAnswered] = useState(false)
  const [correctAnswer, setCorrectAnswer] = useState(null)
  const [joining, setJoining] = useState(false)
  const wsRef = useRef(null)
  const reconnectTimeoutRef = useRef(null)
  const timerIntervalRef = useRef(null)
  const shouldConnectRef = useRef(true)
  const wsConnectedRef = useRef(false)
  const hasEverConnectedRef = useRef(false)
  const retryCountRef = useRef(0)
  const MAX_INITIAL_RETRIES = 5

  useEffect(() => {
    shouldConnectRef.current = true

    if (params.gameCode && params.uid) {
      shouldConnectRef.current = true
      setJoined(true)
      setPlayer({ uid: params.uid, name: 'Player', score: 0 })
      setStatus('Reconnecting...')
      connectWebSocket(params.gameCode, params.uid)
    }

    return () => {
      shouldConnectRef.current = false
      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmounting')
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Live timer effect
  useEffect(() => {
    if (roundEndTimestamp) {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current)
      }

      const updateTimer = () => {
        const now = Math.floor(Date.now() / 1000)
        const remaining = roundEndTimestamp - now
        setRoundTimer(remaining > 0 ? remaining : 0)
      }

      updateTimer()
      timerIntervalRef.current = setInterval(updateTimer, 1000)

      return () => {
        if (timerIntervalRef.current) {
          clearInterval(timerIntervalRef.current)
        }
      }
    } else {
      setRoundTimer(null)
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current)
        timerIntervalRef.current = null
      }
    }
  }, [roundEndTimestamp])

  const joinGame = async (e) => {
    e.preventDefault()
    if (joining) return
    setJoining(true)
    setError(null)
    try {
      const response = await fetch(
        `${API_URL}/join/${gameCode.trim().toUpperCase()}?player_name=${encodeURIComponent(playerName)}`
      , { method: 'POST' })

      if (!response.ok) {
        throw new Error('Failed to join game')
      }

      const data = await response.json()
      setPlayer(data)
      setJoined(true)
      setStatus('Joined game! Waiting for host to start...')
      const code = gameCode.trim().toUpperCase()
      window.history.replaceState(null, '', `/player/${code}/${data.uid}`)
      shouldConnectRef.current = true
      connectWebSocket(code, data.uid)
    } catch (err) {
      setError('Failed to join game: ' + err.message)
      setJoining(false)
    }
  }

  const connectWebSocket = (code, uid) => {
    if (!shouldConnectRef.current) return

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return

    if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
      wsRef.current.close(1000, 'Reconnecting')
    }

    const ws = new WebSocket(`${WS_URL}/ws/${code}?uid=${uid}`)
    wsRef.current = ws
    wsConnectedRef.current = false

    ws.onopen = () => {
      wsConnectedRef.current = true
      hasEverConnectedRef.current = true
      retryCountRef.current = 0
      setError(null)
    }

    ws.onmessage = (event) => {
      if (!event.data) return
      try {
        const message = JSON.parse(event.data)
        handleMessage(message)
      } catch (e) {
        console.log('Non-JSON message:', event.data)
      }
    }

    ws.onerror = () => {
      setError('Connection error')
    }

    ws.onclose = (event) => {
      if (!wsConnectedRef.current && shouldConnectRef.current) {
        if (!hasEverConnectedRef.current) {
          retryCountRef.current++

          if (retryCountRef.current >= MAX_INITIAL_RETRIES) {
            setError('Game not found. Redirecting...')
            setTimeout(() => leaveGame(), 1500)
            return
          }

          setError(`Connection failed, retrying... (${retryCountRef.current}/${MAX_INITIAL_RETRIES})`)
          reconnectTimeoutRef.current = setTimeout(() => {
            connectWebSocket(code, uid)
          }, 1000)
          return
        }
      }

      if (shouldConnectRef.current && event.code !== 1000 && event.code !== 1001) {
        setError('Connection lost, reconnecting...')
        reconnectTimeoutRef.current = setTimeout(() => {
          connectWebSocket(code, uid)
        }, 1000)
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
        }
        // Restore player info from game state on reconnect
        if (player && message.data.players?.[player.uid]) {
          setPlayer(message.data.players[player.uid])
        }
        break

      case ResponseType.NEW_PLAYER:
        if (message.data.uid !== player?.uid) {
          setStatus(`${message.data.name} joined!`)
        }
        setGame(prev => ({
          ...prev,
          players: {
            ...prev?.players,
            [message.data.uid]: message.data
          }
        }))
        break

      case ResponseType.ROUND_START:
        setGame(message.data)
        setAnswered(false)
        setAnswer('')
        setRoundTimer(null)
        setRoundEndTimestamp(null)
        setCorrectAnswer(null)
        setStatus(`Round ${message.data.round + 1} started!`)
        break

      case ResponseType.ANSWER:
        if (message.data.correct) {
          setStatus(`Correct! +${message.data.score_delta} points`)
          setAnswered(true)
          setPlayer(prev => prev ? ({
            ...prev,
            score: prev.score + message.data.score_delta
          }) : prev)
        } else {
          setStatus(`Wrong! ${message.data.message}`)
          setAnswered(false)
          setAnswer('')
        }
        break

      case ResponseType.PLAYER_ANSWERED:
        // Update the player's answered status in game state
        setGame(prev => {
          if (!prev) return prev
          return {
            ...prev,
            players: {
              ...prev.players,
              [message.data.uid]: {
                ...prev.players[message.data.uid],
                ...message.data
              }
            }
          }
        })
        break

      case ResponseType.ROUND_FINISHED:
        setStatus('Round finished!')
        setAnswered(false)
        setRoundTimer(null)
        setRoundEndTimestamp(null)
        setCorrectAnswer(message.data.correct_answer)
        setGame(prev => ({
          ...prev,
          state: GameState.ROUND_FINISHED,
          players: message.data.players.reduce((acc, p) => {
            acc[p.uid] = p
            return acc
          }, {})
        }))
        if (player) {
          const myPlayer = message.data.players.find(p => p.uid === player.uid)
          if (myPlayer) {
            setPlayer(myPlayer)
          }
        }
        break

      case ResponseType.GAME_FINISHED:
        setStatus('Game finished!')
        setFinalScores(message.data)
        break

      case ResponseType.ROUND_END_TIMER:
        setRoundEndTimestamp(message.data)
        break

      default:
        console.log('Unknown event:', message)
    }
  }

  const leaveGame = () => {
    shouldConnectRef.current = false
    if (wsRef.current) {
      wsRef.current.close(1000, 'Player leaving')
      wsRef.current = null
    }
    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current)
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current)
    setGame(null)
    setJoined(false)
    setPlayer(null)
    setGameCode('')
    setPlayerName('')
    setAnswer('')
    setStatus('')
    setError(null)
    setFinalScores(null)
    setRoundTimer(null)
    setRoundEndTimestamp(null)
    setAnswered(false)
    setCorrectAnswer(null)
    setJoining(false)
    wsConnectedRef.current = false
    hasEverConnectedRef.current = false
    retryCountRef.current = 0
    window.history.replaceState(null, '', '/player')
  }

  const submitAnswer = (e) => {
    e.preventDefault()
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && answer.trim()) {
      wsRef.current.send(answer.trim())
      setStatus('Answer submitted...')
    }
  }

  const submitChoice = (option) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(option)
      setStatus('Answer submitted...')
    }
  }

  // Helper: get current question object { text, data }
  const getCurrentQuestion = () => {
    if (!game || !game.questions || game.questions.length === 0) return null
    return game.questions[game.questions.length - 1]
  }

  // Render question display text
  const getQuestionDisplay = (question) => {
    if (!question) return ''
    const gameType = game.game_type

    switch (gameType) {
      case 'crossword':
        return question.text
      case 'multiple-choice':
        return question.text
      case 'scramble':
        return null // handled in renderAnswerInput
      case 'fill-the-gaps':
        return null // handled in renderAnswerInput
      case 'matching':
        return question.text
      case 'word-search':
        return `Find: ${question.text}`
      default:
        return question.text
    }
  }

  // Render the answer input area based on game type
  const renderAnswerInput = (question) => {
    if (!question) return null
    const gameType = game.game_type

    switch (gameType) {
      case 'multiple-choice':
        return (
          <>
            {renderWrongStatus()}
            <div className="mc-options-player">
              {question.data?.options?.map((option, idx) => (
                <button
                  key={idx}
                  className={`mc-option-btn mc-color-${idx % 4}`}
                  onClick={() => submitChoice(option)}
                >
                  <span className="mc-option-label">{String.fromCharCode(65 + idx)}</span>
                  <span className="mc-option-text">{option}</span>
                </button>
              ))}
            </div>
          </>
        )

      case 'matching': {
        const usedAnswers = game.answers || []
        return (
          <>
            {renderWrongStatus()}
            <div className="matching-options-player">
              {game.data?.options?.map((option, idx) => {
                const isUsed = usedAnswers.includes(option)
                return (
                  <button
                    key={idx}
                    className={`matching-option-btn ${isUsed ? 'matching-used' : ''}`}
                    onClick={() => submitChoice(option)}
                    disabled={isUsed}
                  >
                    {option}
                  </button>
                )
              })}
            </div>
          </>
        )
      }

      case 'scramble':
        return (
          <>
            <div className="scramble-player">
              <div className="scramble-letters-player">
                {question.text.split('').map((letter, idx) => (
                  <div key={idx} className="scramble-tile-player">{letter}</div>
                ))}
              </div>
            </div>
            {renderWrongStatus()}
            {renderTextInput('Type the unscrambled word...')}
          </>
        )

      case 'fill-the-gaps':
        return (
          <>
            <div className="fill-gaps-player">
              {question.text.split('_____').map((part, idx, arr) => (
                <span key={idx}>
                  {part}
                  {idx < arr.length - 1 && <span className="fill-gaps-blank-player">_____</span>}
                </span>
              ))}
            </div>
            {renderWrongStatus()}
            {renderTextInput('Type the missing word...')}
          </>
        )

      case 'word-search':
        return (
          <>
            {game.data?.puzzle && (
              <div className="word-search-player">
                {game.data.puzzle.map((row, rIdx) => (
                  <div key={rIdx} className="word-search-row-player">
                    {row.map((letter, cIdx) => (
                      <div key={cIdx} className="word-search-cell-player">{letter}</div>
                    ))}
                  </div>
                ))}
              </div>
            )}
            {renderWrongStatus()}
            {renderTextInput('Type the word...')}
          </>
        )

      case 'crossword':
      default:
        return (
          <>
            {renderWrongStatus()}
            {renderTextInput('Type your answer...')}
          </>
        )
    }
  }

  const renderWrongStatus = () => {
    if (status && (status.toLowerCase().includes('wrong') || status.toLowerCase().includes('incorrect'))) {
      return <div className="player-status error">{status}</div>
    }
    return null
  }

  const renderTextInput = (placeholder) => (
    <form onSubmit={submitAnswer} className="player-answer-form">
      <input
        type="text"
        placeholder={placeholder}
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        required
        autoFocus
        autoComplete="off"
        autoCapitalize="off"
      />
      <button type="submit" className="btn-green">Submit</button>
    </form>
  )

  const myRank = finalScores ? finalScores.findIndex(p => p.uid === player?.uid) + 1 : 0

  if (finalScores) {
    return (
      <div className="player-container">
        <div className="player-header">
          <span className="player-name">Game Over</span>
          <span className="player-score">{player?.score || 0}</span>
        </div>

        <div className="player-main">
          {myRank > 0 && (
            <div className="player-rank">
              <div className="rank-number">#{myRank}</div>
              <div className="rank-label">Your Final Rank</div>
            </div>
          )}

          <div className="player-leaderboard">
            {finalScores.map((p, idx) => (
              <div
                key={p.uid}
                className={`player-leaderboard-item ${player && p.uid === player.uid ? 'you' : ''} ${idx === 0 ? 'gold' : idx === 1 ? 'silver' : idx === 2 ? 'bronze' : ''}`}
              >
                <span>{idx + 1}. {p.name}</span>
                <span>{p.score} pts</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (!joined) {
    return (
      <div className="player-container">
        <div style={{ textAlign: 'center', padding: '50px 20px 30px' }}>
          <h1 style={{ fontSize: '32px', marginBottom: '12px', color: 'white', fontWeight: '900' }}>Join Game!</h1>
          <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '16px' }}>Enter the PIN shown on screen</p>
        </div>

        <form onSubmit={joinGame} className="join-form">
          <input
            type="text"
            placeholder="Game PIN"
            value={gameCode}
            onChange={(e) => setGameCode(e.target.value.toUpperCase())}
            required
            autoComplete="off"
          />
          <input
            type="text"
            placeholder="Nickname"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            required
            style={{ textTransform: 'none' }}
          />
          <button type="submit" disabled={joining}>{joining ? 'Joining...' : 'Enter'}</button>
        </form>

        {error && <div className="player-status error">{error}</div>}
      </div>
    )
  }

  if (!game) {
    return (
      <div className="player-container">
        <div className="player-header">
          <span className="player-name">{player?.name || 'Loading...'}</span>
          <span className="player-score">{player?.score || 0}</span>
        </div>
        <div className="player-waiting-screen">
          <p>{status}</p>
          <div className="player-waiting-dots">
            <span></span>
            <span></span>
            <span></span>
          </div>
        </div>
        {error && <div className="player-status error">{error}</div>}
      </div>
    )
  }

  const players = Object.values(game.players || {})
  const sortedPlayers = [...players].sort((a, b) => b.score - a.score)
  const currentRank = sortedPlayers.findIndex(p => p.uid === player?.uid) + 1
  const currentQuestion = getCurrentQuestion()

  return (
    <div className="player-container">
      {roundTimer !== null && roundTimer > 0 && (
        <div className="timer">
          ⏱ {roundTimer}s
        </div>
      )}

      <div className="player-header">
        <span className="player-name">{player?.name}</span>
        <span className="player-score">{player?.score || 0}</span>
      </div>

      <div className="player-main">
        {game.state === GameState.WAITING_FOR_PLAYERS && (
          <div className="player-waiting-screen">
            <h2>Waiting for host to start...</h2>
            <p style={{ marginBottom: '20px' }}>{players.length} player{players.length !== 1 ? 's' : ''} joined</p>
            <div className="player-waiting-dots">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        )}

        {game.state === GameState.WAITING_FOR_ANSWER && (
          <>
            {getQuestionDisplay(currentQuestion) && (
              <div className="player-question">
                {getQuestionDisplay(currentQuestion)}
              </div>
            )}

            {answered ? (
              <div className="player-correct-badge">
                <div className="checkmark">✓</div>
                <div className="text">Correct! Waiting for others...</div>
              </div>
            ) : (
              renderAnswerInput(currentQuestion)
            )}
          </>
        )}

        {game.state === GameState.ROUND_FINISHED && (
          <div className="player-round-result">
            <p>The answer was</p>
            <div className="answer-reveal">{correctAnswer}</div>

            {currentRank > 0 && (
              <div className="player-rank">
                <div className="rank-number">#{currentRank}</div>
                <div className="rank-label">Current Rank</div>
              </div>
            )}

            <div className="player-leaderboard">
              {sortedPlayers.slice(0, 5).map((p, idx) => (
                <div
                  key={p.uid}
                  className={`player-leaderboard-item ${player && p.uid === player.uid ? 'you' : ''} ${idx === 0 ? 'gold' : idx === 1 ? 'silver' : idx === 2 ? 'bronze' : ''}`}
                >
                  <span>{idx + 1}. {p.name}</span>
                  <span>{p.score} pts</span>
                </div>
              ))}
            </div>

            <div className="player-status waiting">Waiting for next round...</div>
          </div>
        )}
      </div>

      <button className="player-leave-btn" onClick={leaveGame}>Leave Game</button>
    </div>
  )
}

export default Player
