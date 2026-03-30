<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useWebHaptics } from 'web-haptics/vue'
import { API_URL, WS_URL } from '../config'
import WordSearchGrid from './WordSearchGrid.vue'

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
  ANSWER: "answer",
  ROUND_END_TIMER: "round_end_timer",
  PLAYER_ANSWERED: "player_answered",
  WORD_FOUND: "word_found",
  MATCH_FOUND: "match_found",
  UNKNOWN: "unknown"
}

const route = useRoute()
const router = useRouter()
const { trigger } = useWebHaptics()

const gameCode = ref(route.params.gameCode && !route.params.uid ? route.params.gameCode : '')
const playerName = ref('')
const joined = ref(!!route.params.gameCode && !!route.params.uid)
const player = ref(route.params.uid ? { uid: route.params.uid, name: 'Player', score: 0 } : null)
const game = ref(null)
const answer = ref('')
const status = ref('')
const error = ref(null)
const finalScores = ref(null)
const roundTimer = ref(null)
const roundEndTimestamp = ref(null)
const answered = ref(false)
const correctAnswer = ref(null)
const joining = ref(false)
const wsStatus = ref(null)
const matchSelection = ref(null)

// Plain variables for non-reactive refs
let ws = null
let reconnectTimeout = null
let timerInterval = null
let shouldConnect = true
let wsConnected = false
let hasEverConnected = false
let retryCount = 0
let dragState = null
let dragTarget = null
let preventClick = false
const MAX_INITIAL_RETRIES = 5

// DOM refs
const matchBoardRef = ref(null)
const canvasRef = ref(null)

// ── Computed ──
const myRank = computed(() =>
  finalScores.value ? finalScores.value.findIndex(p => p.uid === player.value?.uid) + 1 : 0
)

const players = computed(() => Object.values(game.value?.players || {}))
const sortedPlayers = computed(() => [...players.value].sort((a, b) => b.score - a.score))
const currentRank = computed(() => sortedPlayers.value.findIndex(p => p.uid === player.value?.uid) + 1)
const currentQuestion = computed(() => {
  if (!game.value || !game.value.questions || game.value.questions.length === 0) return null
  return game.value.questions[game.value.questions.length - 1]
})
const isWordSearch = computed(() => game.value?.game_type === 'word-search')
const isMatching = computed(() => game.value?.game_type === 'matching')

const questionDisplay = computed(() => {
  const question = currentQuestion.value
  if (!question) return ''
  switch (game.value?.game_type) {
    case 'crossword': return question.text
    case 'multiple-choice': return question.text
    case 'scramble': return null
    case 'fill-the-gaps': return null
    case 'matching': return question.text
    case 'word-search': return `Find: ${question.text}`
    default: return question.text
  }
})

// ── Matching computed ──
const matchingQuestions = computed(() => game.value?.questions || [])
const matchingOptions = computed(() => game.value?.data?.options || [])
const foundPairs = computed(() => Object.values(game.value?.data?.found_pairs || {}))
const foundCount = computed(() => foundPairs.value.length)
const matchTotalCount = computed(() => game.value?.data?.pair_count || 0)
const matchedLeft = computed(() => new Set(foundPairs.value.map(p => p.left)))
const matchedRight = computed(() => new Set(foundPairs.value.map(p => p.right)))

const sortedLeftItems = computed(() =>
  [...matchingQuestions.value.map((q, idx) => ({ q, idx }))]
    .sort((a, b) => (matchedLeft.value.has(a.q.text) ? 1 : 0) - (matchedLeft.value.has(b.q.text) ? 1 : 0))
)

const sortedRightItems = computed(() =>
  [...matchingOptions.value.map((opt, idx) => ({ opt, idx }))]
    .sort((a, b) => (matchedRight.value.has(a.opt) ? 1 : 0) - (matchedRight.value.has(b.opt) ? 1 : 0))
)

// ── Word search computed ──
const wsGrid = computed(() => game.value?.data?.grid)
const wsFoundWords = computed(() => game.value?.data?.found_words || {})
const wsAllWords = computed(() => {
  const questions = game.value?.questions || []
  let allWords = questions.map(q => q.text)
  if (allWords.length === 0 && game.value?.data?.word_bank) {
    allWords = game.value.data.word_bank
  }
  const fw = wsFoundWords.value
  Object.keys(fw).forEach(w => {
    if (!allWords.some(aw => aw.toLowerCase() === w)) {
      allWords.push(w)
    }
  })
  return allWords
})
const wsFoundCount = computed(() => Object.keys(wsFoundWords.value).length)
const wsTotalCount = computed(() => wsAllWords.value.length || wsFoundCount.value)

// ── Timer watcher ──
watch(roundEndTimestamp, (newVal) => {
  if (newVal) {
    if (timerInterval) clearInterval(timerInterval)
    const updateTimer = () => {
      const now = Math.floor(Date.now() / 1000)
      const remaining = newVal - now
      roundTimer.value = remaining > 0 ? remaining : 0
    }
    updateTimer()
    timerInterval = setInterval(updateTimer, 1000)
  } else {
    roundTimer.value = null
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null }
  }
})

// ── Event hooks ──
const onCorrectAnswer = (scoreDelta) => {
  console.log('Correct answer! +' + scoreDelta)
  trigger([
    { duration: 30 },
    { delay: 60, duration: 40, intensity: 1 },
  ])
}

const onIncorrectAnswer = (message) => {
  console.log('Incorrect answer:', message)
  trigger([
    { duration: 40, intensity: 0.7 },
    { delay: 40, duration: 40, intensity: 0.7 },
    { delay: 40, duration: 40, intensity: 0.9 },
    { delay: 40, duration: 50, intensity: 0.6 },
  ])
}

const onRoundStart = (roundIndex) => {
  console.log('Round started:', roundIndex + 1)
  trigger([
    { duration: 80, intensity: 0.16 },
    { delay: 50, duration: 80, intensity: 0.3 },
  ])
}

const onTimerStart = (timestamp) => {
  console.log('15s timer started, ends at:', timestamp)
  let ms_to_end = 15 * 1000 - (Date.now() - timestamp * 1000)
  trigger([
    { duration: ms_to_end },
  ], { intensity: 0.05 })
}

// ── WebSocket message handler ──
const handleMessage = (message) => {
  console.log('Received:', message)

  switch (message.event) {
    case ResponseType.GAME_STATE:
      game.value = message.data
      if (message.data.state === GameState.WAITING_FOR_PLAYERS) {
        status.value = 'Waiting for players...'
      }
      if (player.value && message.data.players?.[player.value.uid]) {
        player.value = message.data.players[player.value.uid]
      }
      break

    case ResponseType.NEW_PLAYER:
      if (message.data.uid !== player.value?.uid) {
        status.value = `${message.data.name} joined!`
      }
      if (game.value) {
        game.value.players = { ...game.value.players, [message.data.uid]: message.data }
      }
      break

    case ResponseType.ROUND_START:
      game.value = message.data
      answered.value = false
      answer.value = ''
      roundTimer.value = null
      roundEndTimestamp.value = null
      correctAnswer.value = null
      status.value = `Round ${message.data.round + 1} started!`
      onRoundStart(message.data.round)
      break

    case ResponseType.ANSWER:
      if (message.data.correct) {
        onCorrectAnswer(message.data.score_delta)
        if (game.value?.game_type === 'word-search' || game.value?.game_type === 'matching') {
          wsStatus.value = { type: 'success', text: `Correct! +${message.data.score_delta} point` }
          if (player.value) player.value.score += message.data.score_delta
          setTimeout(() => { wsStatus.value = null }, 2000)
        } else {
          status.value = `Correct! +${message.data.score_delta} points`
          answered.value = true
          if (player.value) player.value.score += message.data.score_delta
        }
      } else {
        onIncorrectAnswer(message.data.message)
        if (game.value?.game_type === 'matching' && message.data.message === 'Already matched!' && lastMatchSubmission) {
          // Server says already matched but we don't have it locally — add it
          const questions = game.value.questions || []
          const options = game.value.data?.options || []
          const leftQ = questions[lastMatchSubmission.leftIdx - 1]
          const rightOpt = options[lastMatchSubmission.letter.charCodeAt(0) - 65]
          if (leftQ && rightOpt) {
            const fp = game.value.data?.found_pairs || {}
            const exists = Object.values(fp).some(p => p.left === leftQ.text && p.right === rightOpt)
            if (!exists) {
              const existingKeys = Object.keys(fp).map(Number).filter(n => !isNaN(n))
              const nextIdx = String(existingKeys.length > 0 ? Math.max(...existingKeys) + 1 : 0)
              const newFound = { ...fp }
              newFound[nextIdx] = { finder_uid: '', finder_name: '', left: leftQ.text, right: rightOpt }
              game.value = { ...game.value, data: { ...game.value.data, found_pairs: newFound } }
            }
          }
          wsStatus.value = { type: 'error', text: message.data.message }
          setTimeout(() => { wsStatus.value = null }, 2000)
        } else if (game.value?.game_type === 'word-search' || game.value?.game_type === 'matching') {
          wsStatus.value = { type: 'error', text: message.data.message }
          setTimeout(() => { wsStatus.value = null }, 2000)
        } else {
          wsStatus.value = { type: 'error', text: message.data.message || 'Incorrect!' }
          setTimeout(() => { wsStatus.value = null }, 2000)
          answered.value = false
          answer.value = ''
        }
      }
      break

    case ResponseType.WORD_FOUND:
      if (game.value) {
        const newFound = { ...(game.value.data?.found_words || {}) }
        newFound[message.data.word] = {
          finder_name: message.data.finder_name,
          coords: message.data.coords
        }
        const newPlayers = message.data.players.reduce((acc, p) => { acc[p.uid] = p; return acc }, {})
        game.value = {
          ...game.value,
          data: { ...game.value.data, found_words: newFound },
          players: newPlayers
        }
      }
      if (player.value) {
        const me = message.data.players.find(p => p.uid === player.value.uid)
        if (me) player.value = me
      }
      break

    case ResponseType.MATCH_FOUND:
      if (game.value) {
        const newFound = { ...(game.value.data?.found_pairs || {}) }
        // Use a key that won't collide — find max existing numeric key + 1
        const existingKeys = Object.keys(newFound).map(Number).filter(n => !isNaN(n))
        const nextIdx = String(existingKeys.length > 0 ? Math.max(...existingKeys) + 1 : 0)
        // Don't add if this pair already exists
        const alreadyExists = Object.values(newFound).some(p => p.left === message.data.left && p.right === message.data.right)
        if (!alreadyExists) {
          newFound[nextIdx] = {
            finder_uid: message.data.finder_uid || '',
            finder_name: message.data.finder_name,
            left: message.data.left,
            right: message.data.right
          }
        }
        const newPlayers = message.data.players.reduce((acc, p) => { acc[p.uid] = p; return acc }, {})
        game.value = {
          ...game.value,
          data: { ...game.value.data, found_pairs: newFound },
          players: newPlayers
        }
      }
      if (player.value) {
        const me = message.data.players.find(p => p.uid === player.value.uid)
        if (me) player.value = me
      }
      matchSelection.value = null
      break

    case ResponseType.PLAYER_ANSWERED:
      if (game.value) {
        game.value.players = {
          ...game.value.players,
          [message.data.uid]: { ...game.value.players[message.data.uid], ...message.data }
        }
      }
      break

    case ResponseType.ROUND_FINISHED:
      status.value = 'Round finished!'
      answered.value = false
      roundTimer.value = null
      roundEndTimestamp.value = null
      correctAnswer.value = message.data.correct_answer
      if (game.value) {
        game.value.state = GameState.ROUND_FINISHED
        game.value.players = message.data.players.reduce((acc, p) => { acc[p.uid] = p; return acc }, {})
      }
      if (player.value) {
        const myPlayer = message.data.players.find(p => p.uid === player.value.uid)
        if (myPlayer) player.value = myPlayer
      }
      break

    case ResponseType.GAME_FINISHED:
      status.value = 'Game finished!'
      finalScores.value = message.data
      break

    case ResponseType.ROUND_END_TIMER:
      roundEndTimestamp.value = message.data
      onTimerStart(message.data)
      break

    default:
      console.log('Unknown event:', message)
  }
}

// ── WebSocket connection ──
const connectWebSocket = (code, uid) => {
  if (!shouldConnect) return
  if (ws && ws.readyState === WebSocket.OPEN) return
  if (ws && ws.readyState !== WebSocket.CLOSED) {
    ws.close(1000, 'Reconnecting')
  }
  const thisWs = new WebSocket(`${WS_URL}/ws/${code}?uid=${uid}`)
  ws = thisWs
  wsConnected = false

  thisWs.onopen = () => {
    wsConnected = true
    hasEverConnected = true
    retryCount = 0
    error.value = null
  }
  thisWs.onmessage = (event) => {
    if (!event.data) return
    try { handleMessage(JSON.parse(event.data)) } catch (e) { console.log('Non-JSON message:', event.data) }
  }
  thisWs.onerror = () => {
    if (ws === thisWs) error.value = 'Connection error'
  }
  thisWs.onclose = (event) => {
    if (ws !== thisWs) return
    if (!wsConnected && shouldConnect) {
      if (!hasEverConnected) {
        retryCount++
        if (retryCount >= MAX_INITIAL_RETRIES) {
          error.value = 'Game not found. Redirecting...'
          setTimeout(() => leaveGame(), 1500)
          return
        }
        error.value = `Connection failed, retrying... (${retryCount}/${MAX_INITIAL_RETRIES})`
        reconnectTimeout = setTimeout(() => connectWebSocket(code, uid), 1000)
        return
      }
    }
    if (shouldConnect && event.code !== 1000 && event.code !== 1001) {
      error.value = 'Connection lost, reconnecting...'
      reconnectTimeout = setTimeout(() => connectWebSocket(code, uid), 1000)
    }
  }
}

// ── Lifecycle ──
onMounted(() => {
  // Cancel any pending reconnect from a previous instance
  if (reconnectTimeout) { clearTimeout(reconnectTimeout); reconnectTimeout = null }
  if (ws) { ws.close(1000, 'Remounting'); ws = null }
  shouldConnect = true
  const init = () => {
    if (route.params.gameCode && route.params.uid) {
      joined.value = true
      player.value = { uid: route.params.uid, name: 'Player', score: 0 }
      status.value = 'Reconnecting...'
      connectWebSocket(route.params.gameCode, route.params.uid)
    }
  }
  setTimeout(init, 0)
})

onUnmounted(() => {
  shouldConnect = false
  if (ws) { ws.close(1000, 'Component unmounting'); ws = null }
  if (reconnectTimeout) clearTimeout(reconnectTimeout)
  if (timerInterval) clearInterval(timerInterval)
})

// ── Actions ──
const joinGame = async (e) => {
  e.preventDefault()
  if (joining.value) return
  joining.value = true
  error.value = null
  try {
    const response = await fetch(
      `${API_URL}/join/${gameCode.value.trim().toUpperCase()}?player_name=${encodeURIComponent(playerName.value)}`
    , { method: 'POST' })
    if (!response.ok) throw new Error('Failed to join game')
    const data = await response.json()
    player.value = data
    joined.value = true
    status.value = 'Joined game! Waiting for host to start...'
    const code = gameCode.value.trim().toUpperCase()
    window.history.replaceState(null, '', `/player/${code}/${data.uid}`)
    shouldConnect = true
    connectWebSocket(code, data.uid)
    trigger('success')
  } catch (err) {
    error.value = 'Failed to join game: ' + err.message
    joining.value = false
    trigger('error')
  }
}

const leaveGame = () => {
  shouldConnect = false
  if (ws) { ws.close(1000, 'Player leaving'); ws = null }
  if (reconnectTimeout) clearTimeout(reconnectTimeout)
  if (timerInterval) clearInterval(timerInterval)
  game.value = null; joined.value = false; player.value = null; gameCode.value = ''; playerName.value = ''
  answer.value = ''; status.value = ''; error.value = null; finalScores.value = null
  roundTimer.value = null; roundEndTimestamp.value = null; answered.value = false
  correctAnswer.value = null; joining.value = false; wsStatus.value = null
  wsConnected = false; hasEverConnected = false; retryCount = 0
  window.history.replaceState(null, '', '/player')
}

const submitAnswer = (e) => {
  e.preventDefault()
  if (ws && ws.readyState === WebSocket.OPEN && answer.value.trim()) {
    ws.send(answer.value.trim())
    status.value = 'Answer submitted...'
  }
}

const submitChoice = (option) => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(option)
    status.value = 'Answer submitted...'
  }
}

const submitWordSearchCoords = (coords) => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(coords)
  }
}

const onAnswerInput = (e) => {
  answer.value = e.target.value.replace(/ /g, '-')
}

// ── Matching selection ──
let lastMatchSubmission = null // { leftIdx, letter } for "Already matched" local update

const selectMatchItem = (side, value) => {
  if (preventClick) return
  if (!matchSelection.value) {
    matchSelection.value = { side, value }
    return
  }
  if (matchSelection.value.side === side) {
    matchSelection.value = matchSelection.value.value === value ? null : { side, value }
    return
  }
  const idx = side === 'left' ? value : matchSelection.value.value
  const letter = side === 'right' ? value : matchSelection.value.value
  lastMatchSubmission = { leftIdx: idx, letter }
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(`${idx}:${letter}`)
  }
  matchSelection.value = null
}

// ── Matching drag-to-connect ──
const drawDragLine = (startRect, touchX, touchY) => {
  const canvas = canvasRef.value
  const board = matchBoardRef.value
  if (!canvas || !board) return
  const boardRect = board.getBoundingClientRect()
  canvas.width = boardRect.width
  canvas.height = boardRect.height
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  const sx = startRect.left + startRect.width / 2 - boardRect.left
  const sy = startRect.top + startRect.height / 2 - boardRect.top
  const ex = touchX - boardRect.left
  const ey = touchY - boardRect.top
  ctx.beginPath()
  ctx.moveTo(sx, sy)
  ctx.lineTo(ex, ey)
  ctx.strokeStyle = 'rgba(251, 191, 36, 0.8)'
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  ctx.stroke()
}

const clearDragLine = () => {
  const canvas = canvasRef.value
  if (!canvas) return
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height)
}

const handleMatchDragStart = (e, side, value) => {
  const clientX = e.touches ? e.touches[0].clientX : e.clientX
  const clientY = e.touches ? e.touches[0].clientY : e.clientY
  dragState = {
    side, value,
    el: e.currentTarget,
    startX: clientX,
    startY: clientY,
    moved: false
  }
  if (!e.touches) {
    e.preventDefault()
    document.addEventListener('mousemove', handleMatchDragMoveDoc)
    document.addEventListener('mouseup', handleMatchDragEndDoc)
  }
}

const handleMatchDragMoveImpl = (clientX, clientY, preventDefault) => {
  if (!dragState) return
  const dx = clientX - dragState.startX
  const dy = clientY - dragState.startY
  if (!dragState.moved && Math.sqrt(dx * dx + dy * dy) < 12) return
  dragState.moved = true
  if (preventDefault) preventDefault()
  drawDragLine(dragState.el.getBoundingClientRect(), clientX, clientY)

  const el = document.elementFromPoint(clientX, clientY)
  const btn = el?.closest('.matching-player-item')
  if (dragTarget && dragTarget !== btn) {
    dragTarget.classList.remove('matching-player-drag-target')
  }
  if (btn && btn.dataset.side && btn.dataset.side !== dragState.side) {
    btn.classList.add('matching-player-drag-target')
    dragTarget = btn
  } else {
    dragTarget = null
  }
}

const handleMatchDragMove = (e) => {
  handleMatchDragMoveImpl(e.touches[0].clientX, e.touches[0].clientY, () => e.preventDefault())
}

const handleMatchDragMoveDoc = (e) => {
  handleMatchDragMoveImpl(e.clientX, e.clientY)
}

const handleMatchDragEndImpl = (clientX, clientY) => {
  if (!dragState) return
  if (!dragState.moved) {
    dragState = null
    return false
  }
  preventClick = true
  setTimeout(() => { preventClick = false }, 100)

  const el = document.elementFromPoint(clientX, clientY)
  const btn = el?.closest('.matching-player-item')
  if (btn && btn.dataset.side && btn.dataset.side !== dragState.side) {
    const targetValue = btn.dataset.value
    const idx = dragState.side === 'left' ? dragState.value : targetValue
    const letter = dragState.side === 'right' ? dragState.value : targetValue
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(`${idx}:${letter}`)
    }
  }
  if (dragTarget) {
    dragTarget.classList.remove('matching-player-drag-target')
    dragTarget = null
  }
  clearDragLine()
  dragState = null
  matchSelection.value = null
  return true
}

const handleMatchDragEnd = (e) => {
  const touch = e.changedTouches[0]
  handleMatchDragEndImpl(touch.clientX, touch.clientY)
}

const handleMatchDragEndDoc = (e) => {
  document.removeEventListener('mousemove', handleMatchDragMoveDoc)
  document.removeEventListener('mouseup', handleMatchDragEndDoc)
  handleMatchDragEndImpl(e.clientX, e.clientY)
}
</script>

<template>
  <!-- Final Scores Screen -->
  <div v-if="finalScores" class="player-container">
    <div class="player-header">
      <span class="player-name">Game Over</span>
      <span class="player-score">{{ player?.score || 0 }}</span>
    </div>
    <div class="player-main">
      <div v-if="myRank > 0" class="player-rank">
        <div class="rank-number">#{{ myRank }}</div>
        <div class="rank-label">Your Final Rank</div>
      </div>
      <div class="player-leaderboard">
        <div
          v-for="(p, idx) in finalScores"
          :key="p.uid"
          :class="[
            'player-leaderboard-item',
            player && p.uid === player.uid ? 'you' : '',
            idx === 0 ? 'gold' : idx === 1 ? 'silver' : idx === 2 ? 'bronze' : ''
          ]"
        >
          <span>{{ idx + 1 }}. {{ p.name }}</span>
          <span>{{ p.score }} pts</span>
        </div>
      </div>
    </div>
    <button class="player-leave-btn" @click="leaveGame">Leave Game</button>
  </div>

  <!-- Join Form Screen -->
  <div v-else-if="!joined" class="player-container">
    <div :style="{ textAlign: 'center', padding: '50px 20px 30px' }">
      <h1 :style="{ fontSize: '32px', marginBottom: '12px', color: 'white', fontWeight: '900' }">Join Game!</h1>
      <p :style="{ color: 'rgba(255,255,255,0.7)', fontSize: '16px' }">Enter the PIN shown on screen</p>
    </div>
    <form class="join-form" @submit="joinGame">
      <input type="text" placeholder="Game PIN" :value="gameCode"
        @input="gameCode = $event.target.value.toUpperCase()" required autocomplete="off" />
      <input type="text" placeholder="Nickname" v-model="playerName"
        required :style="{ textTransform: 'none' }" />
      <button type="submit" :disabled="joining">{{ joining ? 'Joining...' : 'Enter' }}</button>
    </form>
    <div v-if="error" class="player-status error">{{ error }}</div>
  </div>

  <!-- Loading / Waiting Screen (no game data yet) -->
  <div v-else-if="!game" class="player-container">
    <div class="player-header">
      <span class="player-name">{{ player?.name || 'Loading...' }}</span>
      <span class="player-score">{{ player?.score || 0 }}</span>
    </div>
    <div class="player-waiting-screen">
      <p>{{ status }}</p>
      <div class="player-waiting-dots"><span></span><span></span><span></span></div>
    </div>
    <div v-if="error" class="player-status error">{{ error }}</div>
  </div>

  <!-- Main Game Screen -->
  <div v-else class="player-container">
    <div v-if="roundTimer !== null && roundTimer > 0" class="timer">
      &#9201; {{ roundTimer }}s
    </div>

    <div class="player-header">
      <span class="player-name">{{ player?.name }}</span>
      <span class="player-score">{{ player?.score || 0 }}</span>
    </div>

    <div class="player-main">
      <!-- Waiting for Players -->
      <div v-if="game.state === GameState.WAITING_FOR_PLAYERS" class="player-waiting-screen">
        <h2>Waiting for host to start...</h2>
        <p :style="{ marginBottom: '20px' }">{{ players.length }} player{{ players.length !== 1 ? 's' : '' }} joined</p>
        <div class="player-waiting-dots"><span></span><span></span><span></span></div>
      </div>

      <!-- Word Search Active -->
      <template v-if="game.state === GameState.ACTIVE && isWordSearch">
        <div v-if="wsStatus" :class="['ws-toast', wsStatus.type === 'success' ? 'ws-toast-success' : 'ws-toast-error']">
          {{ wsStatus.text }}
        </div>

        <div class="ws-progress-player">
          {{ wsFoundCount }}/{{ wsTotalCount }} words found
        </div>

        <WordSearchGrid
          v-if="wsGrid"
          :grid="wsGrid"
          :foundWords="wsFoundWords"
          :onSelect="submitWordSearchCoords"
          :interactive="true"
          :playerUid="player?.uid"
        />

        <div class="ws-words-player">
          <span
            v-for="(word, idx) in wsAllWords"
            :key="idx"
            :class="['ws-word-tag', wsFoundWords[word.toLowerCase()] ? 'ws-word-tag-found' : '']"
          >
            {{ word }}
          </span>
        </div>
      </template>

      <!-- Matching Active -->
      <template v-if="(game.state === GameState.ACTIVE || game.state === GameState.WAITING_FOR_ANSWER) && isMatching">
        <div class="matching-player-wrapper" ref="matchBoardRef">
          <div v-if="wsStatus" :class="['ws-toast', wsStatus.type === 'success' ? 'ws-toast-success' : 'ws-toast-error']">
            {{ wsStatus.text }}
          </div>

          <div v-if="matchSelection" class="matching-player-hint">
            Now tap on the other side to match
          </div>

          <div class="matching-player-section">
            <div class="matching-player-section-header">
              <span>Left</span>
              <span class="matching-progress-mobile">{{ foundCount }}/{{ matchTotalCount }} matched</span>
            </div>
            <div class="matching-player-scroll">
              <button
                v-for="{ q, idx } in sortedLeftItems"
                :key="idx"
                data-side="left"
                :data-value="idx + 1"
                :class="[
                  'matching-player-item',
                  'matching-player-left',
                  matchedLeft.has(q.text) ? 'matching-board-matched' : '',
                  matchSelection?.side === 'left' && matchSelection.value === idx + 1 ? 'matching-player-selected' : '',
                  matchSelection?.side === 'right' && !matchedLeft.has(q.text) ? 'matching-player-ready' : ''
                ]"
                @click="selectMatchItem('left', idx + 1)"
                @touchstart="handleMatchDragStart($event, 'left', idx + 1)"
                @touchmove="handleMatchDragMove"
                @touchend="handleMatchDragEnd"
                @mousedown="handleMatchDragStart($event, 'left', idx + 1)"
              >
                <span class="matching-board-label">{{ idx + 1 }}</span>
                <span class="matching-board-text">{{ q.text }}</span>
              </button>
            </div>
          </div>

          <div class="matching-player-section">
            <div class="matching-player-section-header">
              <span>Right</span>
            </div>
            <div class="matching-player-scroll">
              <button
                v-for="{ opt, idx } in sortedRightItems"
                :key="idx"
                data-side="right"
                :data-value="String.fromCharCode(65 + idx)"
                :class="[
                  'matching-player-item',
                  'matching-player-right',
                  matchedRight.has(opt) ? 'matching-board-matched' : '',
                  matchSelection?.side === 'right' && matchSelection.value === String.fromCharCode(65 + idx) ? 'matching-player-selected' : '',
                  matchSelection?.side === 'left' && !matchedRight.has(opt) ? 'matching-player-ready' : ''
                ]"
                @click="selectMatchItem('right', String.fromCharCode(65 + idx))"
                @touchstart="handleMatchDragStart($event, 'right', String.fromCharCode(65 + idx))"
                @touchmove="handleMatchDragMove"
                @touchend="handleMatchDragEnd"
                @mousedown="handleMatchDragStart($event, 'right', String.fromCharCode(65 + idx))"
              >
                <span class="matching-board-label">{{ String.fromCharCode(65 + idx) }}</span>
                <span class="matching-board-text">{{ opt }}</span>
              </button>
            </div>
          </div>
        </div>
      </template>

      <!-- Waiting for Answer (non-matching) -->
      <template v-if="game.state === GameState.WAITING_FOR_ANSWER && !isMatching">
        <div v-if="questionDisplay" class="player-question">
          {{ questionDisplay }}
        </div>

        <template v-if="answered">
          <div class="player-correct-badge">
            <div class="checkmark">&#10003;</div>
            <div class="text">Correct! Waiting for others...</div>
          </div>
        </template>

        <template v-else>
          <div v-if="wsStatus" :class="['ws-toast', wsStatus.type === 'success' ? 'ws-toast-success' : 'ws-toast-error']">
            {{ wsStatus.text }}
          </div>

          <!-- Multiple Choice -->
          <template v-if="game.game_type === 'multiple-choice'">
            <div class="mc-options-player">
              <button
                v-for="(option, idx) in currentQuestion?.data?.options"
                :key="idx"
                :class="`mc-option-btn mc-color-${idx % 4}`"
                @click="submitChoice(option)"
              >
                <span class="mc-option-label">{{ String.fromCharCode(65 + idx) }}</span>
                <span class="mc-option-text">{{ option }}</span>
              </button>
            </div>
          </template>

          <!-- Scramble -->
          <template v-else-if="game.game_type === 'scramble'">
            <div class="scramble-player">
              <div class="scramble-letters-player">
                <div v-for="(letter, idx) in currentQuestion?.text?.split('')" :key="idx" class="scramble-tile-player">
                  {{ letter }}
                </div>
              </div>
            </div>
            <form class="player-answer-form" @submit="submitAnswer">
              <input type="text" placeholder="Type the unscrambled word..." :value="answer"
                @input="onAnswerInput" required autofocus autocomplete="off" autocapitalize="off" />
              <button type="submit" class="btn-green">Submit</button>
            </form>
          </template>

          <!-- Fill the Gaps -->
          <template v-else-if="game.game_type === 'fill-the-gaps'">
            <div class="fill-gaps-player">
              <template v-for="(part, idx) in currentQuestion?.text?.split('_____')" :key="idx">
                <span>{{ part }}</span>
                <span v-if="idx < currentQuestion?.text?.split('_____').length - 1" class="fill-gaps-blank-player">_____</span>
              </template>
            </div>
            <form class="player-answer-form" @submit="submitAnswer">
              <input type="text" placeholder="Type the missing word..." :value="answer"
                @input="onAnswerInput" required autofocus autocomplete="off" autocapitalize="off" />
              <button type="submit" class="btn-green">Submit</button>
            </form>
          </template>

          <!-- Crossword / Default -->
          <template v-else>
            <form class="player-answer-form" @submit="submitAnswer">
              <input type="text" placeholder="Type your answer..." :value="answer"
                @input="onAnswerInput" required autofocus autocomplete="off" autocapitalize="off" />
              <button type="submit" class="btn-green">Submit</button>
            </form>
          </template>
        </template>
      </template>

      <!-- Round Finished -->
      <div v-if="game.state === GameState.ROUND_FINISHED" class="player-round-result">
        <p>The answer was</p>
        <div class="answer-reveal">{{ correctAnswer }}</div>
        <div v-if="currentRank > 0" class="player-rank">
          <div class="rank-number">#{{ currentRank }}</div>
          <div class="rank-label">Current Rank</div>
        </div>
        <div class="player-leaderboard">
          <div
            v-for="(p, idx) in sortedPlayers.slice(0, 5)"
            :key="p.uid"
            :class="[
              'player-leaderboard-item',
              player && p.uid === player.uid ? 'you' : '',
              idx === 0 ? 'gold' : idx === 1 ? 'silver' : idx === 2 ? 'bronze' : ''
            ]"
          >
            <span>{{ idx + 1 }}. {{ p.name }}</span>
            <span>{{ p.score }} pts</span>
          </div>
        </div>
        <div class="player-status waiting">Waiting for next round...</div>
      </div>
    </div>

    <button class="player-leave-btn" @click="leaveGame">Leave Game</button>
  </div>
</template>

<style scoped>
/* ============================================
   PLAYER MOBILE STYLES
   ============================================ */

.player-container {
  margin: 0 auto;
  padding: 0;
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: #785feb;
}

.player-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  background: rgba(0,0,0,0.1);
}

.player-name {
  font-size: 16px;
  font-weight: 700;
  color: white;
}

.player-score {
  font-size: 28px;
  font-weight: 900;
  color: white;
}

.player-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px;
  overflow-y: auto;
  min-height: 0;
}

.player-question {
  background: white;
  color: #333;
  width: 100%;
  max-width: 500px;
  padding: 20px;
  border-radius: 12px;
  font-size: 20px;
  font-weight: 700;
  text-align: center;
  margin-bottom: 20px;
  line-height: 1.4;
}

.player-answer-form {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 500px;
  gap: 12px;
}

.player-answer-form input {
  width: 100%;
  max-width: 100%;
  padding: 16px;
  font-size: 18px;
  font-weight: 600;
  border: none;
  border-radius: 8px;
  text-align: center;
  background: white;
}

.player-answer-form input:focus {
  outline: 3px solid rgba(255,255,255,0.5);
}

.player-answer-form button {
  width: 100%;
  padding: 16px;
  font-size: 18px;
  font-weight: 800;
  border-radius: 8px;
  /* background: #22c55e;
  box-shadow: 0 4px 0 #16a34a; */
}

.player-status {
  padding: 16px;
  border-radius: 8px;
  text-align: center;
  font-size: 15px;
  font-weight: 700;
  margin: 20px auto;
  max-width: 400px;
  width: calc(100% - 40px);
}

.player-status.success {
  background: #22c55e;
  color: white;
}

.player-status.error {
  background: #ef4444;
  color: white;
}

.player-status.waiting {
  background: rgba(255,255,255,0.2);
  color: white;
}

.player-correct-badge {
  background: #22c55e;
  color: white;
  padding: 32px;
  border-radius: 12px;
  text-align: center;
  width: 100%;
  max-width: 500px;
}

.player-correct-badge .checkmark {
  font-size: 56px;
  margin-bottom: 10px;
}

.player-correct-badge .text {
  font-size: 16px;
  font-weight: 700;
}

.player-waiting-screen {
  text-align: center;
  padding: 60px 20px;
}

.player-waiting-screen h2 {
  color: white;
  font-size: 20px;
  font-weight: 700;
  margin-bottom: 20px;
}

.player-waiting-screen p {
  color: rgba(255,255,255,0.7);
}

.player-waiting-dots {
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-top: 30px;
}

.player-waiting-dots span {
  width: 14px;
  height: 14px;
  background: white;
  border-radius: 50%;
  animation: bounce 1.4s infinite ease-in-out both;
}

.player-waiting-dots span:nth-child(1) { animation-delay: -0.32s; }
.player-waiting-dots span:nth-child(2) { animation-delay: -0.16s; }

@keyframes bounce {
  0%, 80%, 100% { transform: scale(0); }
  40% { transform: scale(1); }
}

.player-round-result {
  text-align: center;
  padding: 20px;
  max-width: 500px;
  margin: 0 auto;
  width: 100%;
}

.player-round-result p {
  color: white;
  font-size: 14px;
  margin-bottom: 8px;
}

.player-round-result .answer-reveal {
  font-size: 32px;
  font-weight: 900;
  color: white;
  text-transform: uppercase;
  letter-spacing: 2px;
  margin: 12px 0 20px 0;
  padding: 16px 24px;
  background: rgba(255,255,255,0.2);
  border-radius: 10px;
  display: inline-block;
}

.player-rank {
  background: rgba(255,255,255,0.2);
  color: white;
  padding: 20px;
  border-radius: 10px;
  margin: 20px auto;
  max-width: 500px;
  width: 100%;
}

.player-rank .rank-number {
  font-size: 48px;
  font-weight: 900;
}

.player-rank .rank-label {
  font-size: 12px;
  font-weight: 700;
  opacity: 0.7;
  text-transform: uppercase;
  letter-spacing: 2px;
}

.player-leave-btn {
  margin-top: auto;
  margin-left: 20px;
  margin-right: 20px;
  margin-bottom: 20px;
  padding: 14px;
  background: rgba(255,255,255,0.15);
  color: white;
  border: none;
  font-size: 14px;
  box-shadow: none;
}

.player-leave-btn:hover {
  background: rgba(255,255,255,0.25);
  transform: none;
  box-shadow: none;
}

/* Join game form mobile */
.join-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
  max-width: 600px;
  margin: 0 auto;
}

.join-form input {
  width: 100%;
  max-width: 100%;
  padding: 16px;
  font-size: 20px;
  font-weight: 700;
  border: none;
  border-radius: 8px;
  text-align: center;
  text-transform: uppercase;
  background: white;
}

.join-form input::placeholder {
  text-transform: none;
  font-weight: 600;
  color: #9ca3af;
}

.join-form button {
  width: 100%;
  padding: 16px;
  font-size: 18px;
  font-weight: 800;
  border-radius: 8px;
  background: #22c55e;
  box-shadow: 0 4px 0 #16a34a;
  margin: 0 0 5px 0;
  /* margin-bottom: 10px; */
}

.join-form button:hover {
  box-shadow: 0 6px 0 #16a34a;
  transform: translateY(-2px);
}

.join-form button:active {
  box-shadow: 0 2px 0 #16a34a;
  transform: translateY(2px);
}

.join-form .back-btn {
  background: rgba(255,255,255,0.15);
  color: white;
  box-shadow: none !important;
}

.join-form .back-btn:hover {
  box-shadow: none !important;
  transform: none;
  background: rgba(255,255,255,0.25);
}

.join-form .back-btn:active {
  box-shadow: none !important;
  transform: none;
}

/* Mobile leaderboard for player */
.player-leaderboard {
  margin: 12px auto;
  max-width: 500px;
  width: 100%;
}

.player-leaderboard-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  margin: 6px 0;
  background: rgba(255,255,255,0.15);
  border-radius: 8px;
  font-weight: 600;
  font-size: 14px;
  color: white;
}

.player-leaderboard-item.you {
  background: rgba(255,255,255,0.3);
  border: 2px solid white;
}

.player-leaderboard-item.gold {
  background: rgba(255,255,255,0.25);
}

.player-leaderboard-item.silver {
  background: rgba(255,255,255,0.2);
}

.player-leaderboard-item.bronze {
  background: rgba(255,255,255,0.15);
}

/* Player: clickable option buttons */
.mc-options-player {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  width: 100%;
  max-width: 500px;
  margin: 0 auto;
}

.mc-option-btn {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 18px 20px;
  border: none;
  border-radius: 12px;
  color: white;
  font-family: 'Montserrat', sans-serif;
  font-weight: 700;
  font-size: 16px;
  cursor: pointer;
  text-align: left;
  text-transform: none;
  letter-spacing: 0;
  margin: 0;
  transition: transform 0.1s, filter 0.1s;
}

.mc-option-label {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  background: rgba(255, 255, 255, 0.25);
  border-radius: 8px;
  font-weight: 900;
  font-size: 16px;
  flex-shrink: 0;
}

.mc-option-text {
  flex: 1;
}

.mc-color-0 { background: #e21b3c; }
.mc-color-1 { background: #1368ce; }
.mc-color-2 { background: #d89e00; }
.mc-color-3 { background: #26890c; }

.mc-color-0.mc-option-btn { box-shadow: 0 4px 0 #b01530; }
.mc-color-1.mc-option-btn { box-shadow: 0 4px 0 #0e52a3; }
.mc-color-2.mc-option-btn { box-shadow: 0 4px 0 #a67b00; }
.mc-color-3.mc-option-btn { box-shadow: 0 4px 0 #1d6b09; }

.mc-option-btn:hover {
  filter: brightness(1.1);
  transform: translateY(-2px);
}

.mc-option-btn:active {
  transform: translateY(2px);
}

/* Scramble player */
.scramble-player {
  margin-bottom: 20px;
}

.scramble-letters-player {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
}

.scramble-tile-player {
  width: 52px;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: white;
  color: #785feb;
  font-size: 24px;
  font-weight: 900;
  border-radius: 10px;
}

/* Fill gaps player */
.fill-gaps-player {
  background: white;
  color: #333;
  padding: 20px;
  border-radius: 12px;
  font-size: 18px;
  font-weight: 700;
  text-align: center;
  margin-bottom: 20px;
  line-height: 1.6;
}

.fill-gaps-blank-player {
  color: #785feb;
  padding: 0 2px;
  font-weight: 900;
}

/* ── Matching Board (Player) ── */

.matching-player-hint {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  text-align: center;
  font-size: 13px;
  font-weight: 600;
  color: #333;
  background: #fbbf24;
  padding: 6px 16px;
  border-radius: 20px;
  z-index: 10;
  white-space: nowrap;
}

.matching-player-wrapper {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  width: 100%;
  gap: 8px;
}

.matching-player-section {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  max-height: calc((100vh - 110px) / 2);
  max-height: calc((100dvh - 110px) / 2);
  background: white;
  border-radius: 12px;
  overflow: hidden;
}

.matching-progress-desktop {
  display: none;
}

.matching-progress-mobile {
  display: inline;
}

@media (min-width: 768px) {
  .matching-player-wrapper {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 8px 16px;
  }
  .matching-progress-desktop {
    display: block;
    text-align: center;
    font-size: 14px;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.7);
    width: 100%;
    flex-shrink: 0;
  }
  .matching-player-section {
    max-height: calc(100vh - 140px);
    max-height: calc(100dvh - 140px);
  }
  .matching-progress-mobile {
    display: none;
  }
}

.matching-player-section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 14px;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: #6b7280;
  flex-shrink: 0;
}

.matching-player-scroll {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 5px 10px 10px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  -webkit-overflow-scrolling: touch;
}

.matching-player-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: none;
  border-radius: 10px;
  background: #f3f4f6;
  color: #333;
  font-family: 'Montserrat', sans-serif;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  text-align: left;
  text-transform: none;
  letter-spacing: 0;
  margin: 0;
  transition: all 0.15s;
  flex-shrink: 0;
  box-shadow: none;
}

.matching-board-label {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 7px;
  background: #785feb;
  color: white;
  font-weight: 800;
  font-size: 13px;
  flex-shrink: 0;
}

.matching-board-text {
  flex: 1;
  font-size: 14px;
  line-height: 1.3;
  min-width: 0;
}

.matching-board-matched .matching-board-label {
  background: #22c55e;
}

.matching-player-item:not(:disabled):not(.matching-board-matched):hover {
  background: #e5e7eb;
}

.matching-player-selected {
  background: #fef3c7 !important;
  outline: 2px solid #fbbf24;
}

.matching-player-selected .matching-board-label {
  background: #fbbf24;
  color: #333;
}

.matching-player-ready:not(:disabled) {
  background: #ede9fe;
}

.matching-player-ready:not(:disabled):hover {
  background: #ddd6fe;
}

.matching-player-item.matching-board-matched {
  opacity: 0.5;
  background: #dcfce7;
  text-decoration: line-through;
}

.matching-player-item.matching-board-matched .matching-board-label {
  background: #22c55e;
}

.matching-player-drag-target {
  background: #fef3c7 !important;
  outline: 2px solid #fbbf24;
}

.matching-player-item:disabled {
  cursor: default;
}

/* Player word search */
.ws-toast {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 24px;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 700;
  z-index: 1000;
  animation: ws-toast-in 0.25s ease-out, ws-toast-out 0.3s ease-in 1.5s forwards;
  pointer-events: none;
}

.ws-toast-success {
  background: #22c55e;
  color: white;
}

.ws-toast-error {
  background: #ef4444;
  color: white;
}

@keyframes ws-toast-in {
  from { opacity: 0; transform: translateX(-50%) translateY(-20px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}

@keyframes ws-toast-out {
  from { opacity: 1; }
  to { opacity: 0; }
}

.ws-progress-player {
  text-align: center;
  font-size: 14px;
  font-weight: 700;
  color: rgba(255,255,255,0.8);
  margin-bottom: 12px;
}

.ws-words-player {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
  margin-top: 14px;
}

.ws-word-tag {
  padding: 5px 12px;
  background: rgba(255,255,255,0.2);
  border-radius: 20px;
  font-size: 13px;
  font-weight: 700;
  color: white;
}

.ws-word-tag-found {
  text-decoration: line-through;
  opacity: 0.4;
}

/* Player grid sizing — targets WordSearchGrid child component */
.player-main :deep(.ws-grid-container) {
  background: white;
  width: min(100%, 70vh);
  max-width: 100%;
}

.player-main :deep(.ws-cell) {
  background: rgba(255,255,255,0.9);
  font-size: clamp(10px, 2.5vw, 14px);
}
</style>
