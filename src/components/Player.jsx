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
    
    // If we have URL params, reconnect to existing game
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
      // Clear any existing interval
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current)
      }

      // Update immediately
      const updateTimer = () => {
        const now = Math.floor(Date.now() / 1000) // Current UTC timestamp in seconds
        const remaining = roundEndTimestamp - now
        setRoundTimer(remaining > 0 ? remaining : 0)
      }

      updateTimer()
      
      // Update every second
      timerIntervalRef.current = setInterval(updateTimer, 1000)

      return () => {
        if (timerIntervalRef.current) {
          clearInterval(timerIntervalRef.current)
        }
      }
    } else {
      // Clear timer when no end timestamp
      setRoundTimer(null)
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current)
        timerIntervalRef.current = null
      }
    }
  }, [roundEndTimestamp])

  const joinGame = async (e) => {
    e.preventDefault()
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
      // Update URL without triggering remount
      const code = gameCode.trim().toUpperCase()
      window.history.replaceState(null, '', `/player/${code}/${data.uid}`)
      shouldConnectRef.current = true  // Ensure we can connect
      connectWebSocket(code, data.uid)
    } catch (err) {
      setError('Failed to join game: ' + err.message)
    }
  }

  const connectWebSocket = (code, uid) => {
    if (!shouldConnectRef.current) {
      console.log('Component unmounted, skipping WebSocket connection')
      return
    }

    // Don't reconnect if already connected
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      console.log('WebSocket already connected, skipping')
      return
    }

    // Close existing connection only if it exists and is not open
    if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
      wsRef.current.close(1000, 'Reconnecting')
    }

    const ws = new WebSocket(`${WS_URL}/ws/${code}?uid=${uid}`)
    wsRef.current = ws
    wsConnectedRef.current = false

    ws.onopen = () => {
      console.log('WebSocket connected')
      wsConnectedRef.current = true
      hasEverConnectedRef.current = true
      retryCountRef.current = 0
      setError(null)
    }

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data)
      handleMessage(message)
    }

    ws.onerror = (err) => {
      console.error('WebSocket error:', err)
      setError('Connection error')
    }

    ws.onclose = (event) => {
      console.log('WebSocket closed:', event.code, event.reason)
      
      // If connection closed without ever opening
      if (!wsConnectedRef.current && shouldConnectRef.current) {
        // Check if it's a 404 (game not found) - HTTP 404 results in close code 1006
        // with specific patterns, but we can't reliably detect it
        // So we retry a few times before giving up
        
        if (!hasEverConnectedRef.current) {
          retryCountRef.current++
          
          if (retryCountRef.current >= MAX_INITIAL_RETRIES) {
            // After max retries, assume game doesn't exist
            console.log('Connection failed after max retries - game not found')
            setError('Game not found. Redirecting...')
            shouldConnectRef.current = false
            setTimeout(() => {
              navigate('/')
            }, 1500)
            return
          }
          
          // Keep trying
          console.log(`Connection failed, retrying... (${retryCountRef.current}/${MAX_INITIAL_RETRIES})`)
          setError(`Connection failed, retrying... (${retryCountRef.current}/${MAX_INITIAL_RETRIES})`)
          reconnectTimeoutRef.current = setTimeout(() => {
            connectWebSocket(code, uid)
          }, 1000)
          return
        }
      }
      
      // Only reconnect if component is still mounted and it wasn't a normal close
      if (shouldConnectRef.current && event.code !== 1000 && event.code !== 1001) {
        console.log('Reconnecting...')
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
        setStatus(`Round ${message.data.round + 1} started!`)
        break

      case ResponseType.ANSWER:
        if (message.data.correct) {
          setStatus(`Correct! +${message.data.score_delta} points`)
          setAnswered(true)
          // Update local score
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
        // Update player from leaderboard
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
        // message.data is a UTC timestamp in seconds
        setRoundEndTimestamp(message.data)
        break

      default:
        console.log('Unknown event:', message)
    }
  }

  const submitAnswer = (e) => {
    e.preventDefault()
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && answer.trim()) {
      wsRef.current.send(answer.trim())
      setStatus('Answer submitted...')
    }
  }

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

        <button className="player-leave-btn" onClick={() => navigate('/')}>Back to Menu</button>
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
          <button type="submit">Enter</button>
          <button type="button" className="back-btn" onClick={() => navigate('/')}>Back</button>
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
            <div className="player-question">
              {game.questions[game.round]}
            </div>
            
            {answered ? (
              <div className="player-correct-badge">
                <div className="checkmark">✓</div>
                <div className="text">Correct! Waiting for others...</div>
              </div>
            ) : (
              <>
                {status && (status.toLowerCase().includes('wrong') || status.toLowerCase().includes('incorrect')) && (
                  <div className="player-status error">{status}</div>
                )}
                <form onSubmit={submitAnswer} className="player-answer-form">
                  <input
                    type="text"
                    placeholder="Type your answer..."
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    required
                    autoFocus
                    autoComplete="off"
                    autoCapitalize="off"
                  />
                  <button type="submit" className="btn-green">Submit</button>
                </form>
              </>
            )}
          </>
        )}

        {game.state === GameState.ROUND_FINISHED && (
          <div className="player-round-result">
            <p >The answer was</p>
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

      <button className="player-leave-btn" onClick={() => navigate('/')}>Leave Game</button>
    </div>
  )
}

export default Player

