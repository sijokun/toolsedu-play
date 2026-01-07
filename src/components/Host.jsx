import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { API_URL, WS_URL, HOST_URL } from '../config'
import Crossword from './Crossword'
import Logo from '../logo/2_horizontal.svg'

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
  ROUND_END_TIMER: "round_end_timer",
  PLAYER_ANSWERED: "player_answered",
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
    // If we have URL params, reconnect to existing game
    if (params.gameCode && params.uid) {
      shouldConnectRef.current = true
      connectionAttempts.current = 0
      isInitialConnection.current = false // We're reconnecting to existing game
      setGameCode(params.gameCode)
      setHostUid(params.uid)
      setStatus('Connecting...')
      connectWebSocket(params.gameCode, params.uid)
    } 
    // Otherwise create a new game
    else if (!isCreatingRef.current) {
      isCreatingRef.current = true
      shouldConnectRef.current = true
      connectionAttempts.current = 0
      isInitialConnection.current = true // This is a brand new game creation
      createGame()
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
      if (autoNextTimeoutRef.current) {
        clearInterval(autoNextTimeoutRef.current)
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

  const createGame = async () => {
    try {
      const response = await fetch(`${API_URL}/create`, { method: 'POST' })
      const data = await response.json()
      setGameCode(data.code)
      setHostUid(data.host_uid)
      setStatus('Game created! Connecting...')
      
      // Update URL without triggering navigation/remount
      window.history.replaceState(null, '', `/host/${data.code}/${data.host_uid}`)
      
      shouldConnectRef.current = true  // Ensure we can connect
      connectionAttempts.current = 0  // Reset attempt counter
      connectWebSocket(data.code, data.host_uid)
    } catch (err) {
      setError('Failed to create game: ' + err.message)
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

    connectionAttempts.current += 1
    console.log(`WebSocket connection attempt ${connectionAttempts.current}`)

    const ws = new WebSocket(`${WS_URL}/ws/${code}?uid=${uid}`)
    wsRef.current = ws
    wsConnectedRef.current = false

    ws.onopen = () => {
      console.log('WebSocket connected')
      wsConnectedRef.current = true
      connectionAttempts.current = 0 // Reset on successful connection
      isInitialConnection.current = false
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
      
      // If connection closed without ever opening, might be game not found
      // But only redirect after multiple attempts to avoid race conditions
      if (!wsConnectedRef.current && shouldConnectRef.current) {
        // If this is the initial connection from a fresh page load with params,
        // or we've tried multiple times, assume game not found
        if (connectionAttempts.current >= 3 && !isInitialConnection.current) {
          console.log('Connection failed after multiple attempts - game not found')
          setError('Game not found. Redirecting...')
          shouldConnectRef.current = false
          setTimeout(() => {
            navigate('/')
          }, 1500)
          return
        } else {
          // Retry connection
          console.log('Connection failed, retrying...')
          reconnectTimeoutRef.current = setTimeout(() => {
            connectWebSocket(code, uid)
          }, 1000)
          return
        }
      }
      
      // Only reconnect if component is still mounted and it wasn't a normal close
      if (shouldConnectRef.current && event.code !== 1000 && event.code !== 1001) {
        console.log('Reconnecting after abnormal close...')
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
        } else if (message.data.state === GameState.WAITING_FOR_ANSWER) {
          setStatus(`Round ${message.data.round + 1} in progress`)
        } else if (message.data.state === GameState.ROUND_FINISHED) {
          setStatus('Round finished!')
        } else {
          setStatus('Connected')
        }
        break

      case ResponseType.NEW_PLAYER:
        setGame(prev => ({
          ...prev,
          players: {
            ...prev?.players,
            [message.data.uid]: message.data
          }
        }))
        setStatus(`${message.data.name} joined!`)
        break

      case ResponseType.ROUND_START:
        setGame(message.data)
        setRoundTimer(null)
        setRoundEndTimestamp(null)
        setStatus(`Round ${message.data.round + 1} started`)
        break

      case ResponseType.ROUND_FINISHED:
        setRoundTimer(null)
        setRoundEndTimestamp(null)
        setCorrectAnswer(message.data.correct_answer)
        setGame(prev => ({
          ...prev,
          state: GameState.ROUND_FINISHED,
          answers: [...(prev?.answers || []), message.data.correct_answer],
          players: message.data.players.reduce((acc, p) => {
            acc[p.uid] = p
            return acc
          }, {})
        }))
        // wsRef.current.send('NEXT')
        break

      case ResponseType.GAME_FINISHED:
        setStatus('Game finished!')
        setFinalScores(message.data)
        break

      case ResponseType.PLAYER_ANSWERED:
        setStatus(`Player answered!`)
        break

      case ResponseType.ROUND_END_TIMER:
        // message.data is a UTC timestamp in seconds
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

  if (finalScores) {
    return (
      <div className="container">
        <h1>Game Finished!</h1>
        <div className="leaderboard">
          <h2>Final Scores</h2>
          {finalScores.map((player, idx) => (
            <div 
              key={player.uid} 
              className={`leaderboard-item ${idx === 0 ? 'first' : idx === 1 ? 'second' : idx === 2 ? 'third' : ''}`}
            >
              <span>{idx + 1}. {player.name}</span>
              <span>{player.score} points</span>
            </div>
          ))}
        </div>
        <button onClick={() => navigate('/')}>Back to Menu</button>
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
            {/* <button onClick={() => navigate('/')} className="btn-back">Back to Menu</button> */}
            <button onClick={startGame} disabled={players.length === 0} className="btn-start">
              Start Game
            </button>
          </div>
          
          {error && <div className="status error">{error}</div>}
        </div>
      )}

      {game.state === GameState.WAITING_FOR_ANSWER && (
        <>
          <div className="host-header">
            <div className="game-code-small">{gameCode}</div>
            <img src={Logo} alt="Logo" className="host-logo" />
            <span>Round {game.round + 1}</span>
          </div>
          
          <div className="question-box">
            {game.questions[game.round]}
          </div>

          <div className="host-game-layout">
            <div className="host-main">
              {game.data && <Crossword data={game.data} answers={game.answers} currentWordIndex={game.round} />}
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
            </div>
          </div>
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
              {game.data && <Crossword data={game.data} answers={game.answers} />}
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
            </div>
          </div>

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

