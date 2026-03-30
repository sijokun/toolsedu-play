<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import QrcodeVue from 'qrcode.vue'
import { API_URL, WS_URL, HOST_URL } from '../config'
import Crossword from './Crossword.vue'
import WordSearchGrid from './WordSearchGrid.vue'
import Logo from '../logo/2_horizontal.svg'

const GameState = {
  WAITING_FOR_PLAYERS: 'waiting_for_players',
  WAITING_FOR_ANSWER: 'waiting_for_answer',
  ACTIVE: 'active',
  ROUND_FINISHED: 'round_finished',
  FINISHED: 'finished',
}

const ResponseType = {
  GAME_STATE: 'game_state',
  NEW_PLAYER: 'new_player',
  ROUND_START: 'round_start',
  ROUND_FINISHED: 'round_finished',
  GAME_FINISHED: 'game_finished',
  ROUND_END_TIMER: 'round_end_timer',
  PLAYER_ANSWERED: 'player_answered',
  WORD_FOUND: 'word_found',
  MATCH_FOUND: 'match_found',
  UNKNOWN: 'unknown',
}

const route = useRoute()
const router = useRouter()

const gameCode = ref(route.params.gameCode || null)
const hostUid = ref(route.params.uid || null)
const game = ref(null)
const status = ref('Creating game...')
const error = ref(null)
const finalScores = ref(null)
const roundTimer = ref(null)
const roundEndTimestamp = ref(null)
const correctAnswer = ref(null)
const roundQuestion = ref(null)
const autoNextCountdown = ref(null)

let ws = null
let reconnectTimeout = null
let timerInterval = null
let autoNextTimeout = null
let autoNextInterval = null
let isCreating = false
let shouldConnect = true
let wsConnected = false
let connectionAttempts = 0
let isInitialConnection = true

// Derived values
const players = computed(() => Object.values(game.value?.players || {}))
const sortedPlayers = computed(() => [...players.value].sort((a, b) => b.score - a.score))
const top3Players = computed(() => sortedPlayers.value.slice(0, 3))
const currentQuestion = computed(() => {
  if (!game.value || !game.value.questions || game.value.questions.length === 0) return null
  return game.value.questions[game.value.questions.length - 1]
})
const answeredCount = computed(() => players.value.filter(p => p.answered).length)
const isWordSearch = computed(() => game.value?.game_type === 'word-search')
const isMatching = computed(() => game.value?.game_type === 'matching')

// Matching derived values
const foundPairs = computed(() => Object.values(game.value?.data?.found_pairs || {}))
const matchedLeft = computed(() => new Set(foundPairs.value.map(p => p.left)))
const matchedRight = computed(() => new Set(foundPairs.value.map(p => p.right)))
const pairByLeft = computed(() => Object.fromEntries(foundPairs.value.map(p => [p.left, p])))
const matchingQuestions = computed(() => game.value?.questions || [])
const matchingOptions = computed(() => game.value?.data?.options || [])
const matchingFoundCount = computed(() => foundPairs.value.length)
const matchingTotalCount = computed(() => game.value?.data?.pair_count || 0)

// Word search derived values
const wsGrid = computed(() => game.value?.data?.grid)
const wsFoundWords = computed(() => game.value?.data?.found_words || {})
const wsAllWords = computed(() => {
  const questions = game.value?.questions || []
  let words = questions.map(q => q.text)
  if (words.length === 0 && game.value?.data?.word_bank) {
    words = [...game.value.data.word_bank]
  }
  const found = wsFoundWords.value
  Object.keys(found).forEach(w => {
    if (!words.some(aw => aw.toLowerCase() === w)) {
      words.push(w)
    }
  })
  return words
})
const wsFoundCount = computed(() => Object.keys(wsFoundWords.value).length)
const wsTotalCount = computed(() => wsAllWords.value.length || wsFoundCount.value)
const wsSortedWords = computed(() =>
  [...wsAllWords.value].sort((a, b) => {
    const aFound = !!wsFoundWords.value[a.toLowerCase()]
    const bFound = !!wsFoundWords.value[b.toLowerCase()]
    return aFound - bFound
  })
)

// Game over derived values
const podiumOrder = computed(() => {
  if (!finalScores.value) return []
  return [finalScores.value[1], finalScores.value[0], finalScores.value[2]].filter(Boolean)
})
const restPlayers = computed(() => {
  if (!finalScores.value) return []
  return finalScores.value.slice(3)
})

function isTextOnlyType() {
  const t = game.value?.game_type
  return t === 'scramble' || t === 'fill-the-gaps' || (t !== 'crossword' && t !== 'multiple-choice' && t !== 'matching' && t !== 'word-search')
}

function getQuestionBoxText(question) {
  if (!question) return ''
  const gameType = game.value?.game_type
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

function podiumRank(p) {
  return finalScores.value.indexOf(p) + 1
}

function podiumLabel(rank) {
  const labels = { 1: 'gold', 2: 'silver', 3: 'bronze' }
  return labels[rank]
}

function podiumHeight(rank) {
  const heights = { 1: 200, 2: 150, 3: 110 }
  return heights[rank]
}

const remainingWordBank = computed(() => {
  if (!game.value?.data?.word_bank) return []
  return game.value.data.word_bank.filter(w => !(game.value.answers || []).includes(w))
})

const showWordBank = computed(() => remainingWordBank.value.length > 0)

// WebSocket and API

async function createGame() {
  console.log(new Date().toLocaleString('en-GB', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3,hour12:false}), '[HOST] createGame() called')
  try {
    console.log(new Date().toLocaleString('en-GB', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3,hour12:false}), '[HOST] fetching', `${API_URL}/create`)
    const response = await fetch(`${API_URL}/create`, { method: 'POST' })
    const data = await response.json()
    console.log(new Date().toLocaleString('en-GB', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3,hour12:false}), '[HOST] game created:', data.code, data.host_uid)
    gameCode.value = data.code
    hostUid.value = data.host_uid
    status.value = 'Game created! Connecting...'
    window.history.replaceState(null, '', `/host/${data.code}/${data.host_uid}`)
    shouldConnect = true
    connectionAttempts = 0
    connectWebSocket(data.code, data.host_uid)
  } catch (err) {
    console.log(new Date().toLocaleString('en-GB', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3,hour12:false}), '[HOST] createGame error:', err.message)
    error.value = 'Failed to create game: ' + err.message
  }
}

function connectWebSocket(code, uid) {
  console.log(new Date().toLocaleString('en-GB', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3,hour12:false}), '[HOST] connectWebSocket() called', { code, uid, shouldConnect, wsState: ws?.readyState })
  if (!shouldConnect) { console.log(new Date().toLocaleString('en-GB', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3,hour12:false}), '[HOST] SKIP: shouldConnect=false'); return }
  if (ws && ws.readyState === WebSocket.OPEN) { console.log(new Date().toLocaleString('en-GB', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3,hour12:false}), '[HOST] SKIP: already OPEN'); return }
  if (ws && ws.readyState !== WebSocket.CLOSED) {
    console.log(new Date().toLocaleString('en-GB', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3,hour12:false}), '[HOST] closing old ws (state:', ws.readyState, ')')
    ws.close(1000, 'Reconnecting')
  }
  connectionAttempts += 1
  const url = `${WS_URL}/ws/${code}?uid=${uid}`
  console.log(new Date().toLocaleString('en-GB', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3,hour12:false}), '[HOST] new WebSocket()', url, 'attempt:', connectionAttempts)
  const thisWs = new WebSocket(url)
  ws = thisWs
  wsConnected = false

  thisWs.onopen = () => {
    console.log(new Date().toLocaleString('en-GB', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3,hour12:false}), '[HOST] ws.onopen fired, stale:', ws !== thisWs)
    wsConnected = true
    connectionAttempts = 0
    isInitialConnection = false
    error.value = null
    status.value = 'Connected, waiting for game state...'
  }

  thisWs.onmessage = (event) => {
    console.log(new Date().toLocaleString('en-GB', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3,hour12:false}), '[HOST] ws.onmessage, stale:', ws !== thisWs, 'data length:', event.data?.length)
    if (!event.data) return
    try { handleMessage(JSON.parse(event.data)) } catch (e) { console.log(new Date().toLocaleString('en-GB', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3,hour12:false}), '[HOST] parse error:', e.message, event.data) }
  }

  thisWs.onerror = (e) => {
    console.log(new Date().toLocaleString('en-GB', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3,hour12:false}), '[HOST] ws.onerror, stale:', ws !== thisWs, e)
    if (ws === thisWs) error.value = 'Connection error'
  }

  thisWs.onclose = (event) => {
    console.log(new Date().toLocaleString('en-GB', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3,hour12:false}), '[HOST] ws.onclose', { code: event.code, reason: event.reason, stale: ws !== thisWs, wsConnected, shouldConnect })
    if (ws !== thisWs) { console.log(new Date().toLocaleString('en-GB', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3,hour12:false}), '[HOST] SKIP onclose: stale socket'); return }
    if (!wsConnected && shouldConnect) {
      if (connectionAttempts >= 3 && !isInitialConnection) {
        console.log(new Date().toLocaleString('en-GB', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3,hour12:false}), '[HOST] giving up after', connectionAttempts, 'attempts')
        error.value = 'Game not found. Redirecting...'
        shouldConnect = false
        setTimeout(() => router.push('/'), 1500)
        return
      }
      console.log(new Date().toLocaleString('en-GB', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3,hour12:false}), '[HOST] reconnecting in 1s...')
      reconnectTimeout = setTimeout(() => connectWebSocket(code, uid), 1000)
      return
    }
    if (shouldConnect && event.code !== 1000 && event.code !== 1001) {
      console.log(new Date().toLocaleString('en-GB', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3,hour12:false}), '[HOST] unexpected close, reconnecting in 1s...')
      reconnectTimeout = setTimeout(() => connectWebSocket(code, uid), 1000)
    }
  }
}

function handleMessage(message) {
  console.log(new Date().toLocaleString('en-GB', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3,hour12:false}), '[HOST] handleMessage:', message.event, message)

  switch (message.event) {
    case ResponseType.GAME_STATE:
      game.value = message.data
      if (message.data.state === GameState.WAITING_FOR_PLAYERS) {
        status.value = 'Waiting for players...'
      } else if (message.data.state === GameState.WAITING_FOR_ANSWER) {
        status.value = `Round ${message.data.round + 1} in progress`
      } else if (message.data.state === GameState.ACTIVE) {
        if (message.data.game_type === 'matching') {
          const found = Object.keys(message.data.data?.found_pairs || {}).length
          const total = message.data.data?.pair_count || 0
          status.value = `Matching — ${found}/${total} matched`
        } else {
          const found = Object.keys(message.data.data?.found_words || {}).length
          const total = message.data.questions?.length || 0
          status.value = `Word Search — ${found}/${total} found`
        }
      } else if (message.data.state === GameState.ROUND_FINISHED) {
        status.value = 'Round finished!'
      } else {
        status.value = 'Connected'
      }
      break

    case ResponseType.NEW_PLAYER:
      if (!game.value) break
      game.value.players = { ...game.value.players, [message.data.uid]: message.data }
      status.value = `${message.data.name} joined!`
      break

    case ResponseType.ROUND_START:
      game.value = message.data
      roundTimer.value = null
      roundEndTimestamp.value = null
      correctAnswer.value = null
      roundQuestion.value = null
      status.value = `Round ${message.data.round + 1} started`
      break

    case ResponseType.WORD_FOUND: {
      if (!game.value) break
      const newFound = { ...(game.value.data?.found_words || {}) }
      newFound[message.data.word] = {
        finder_name: message.data.finder_name,
        coords: message.data.coords,
      }
      const newPlayers = message.data.players.reduce((acc, p) => { acc[p.uid] = p; return acc }, {})
      game.value.data = { ...game.value.data, found_words: newFound }
      game.value.players = newPlayers
      status.value = `${message.data.finder_name} found "${message.data.word}"! (${message.data.found_count}/${message.data.total_count})`
      break
    }

    case ResponseType.MATCH_FOUND: {
      if (!game.value) break
      const newFoundPairs = { ...(game.value.data?.found_pairs || {}) }
      const existingKeys = Object.keys(newFoundPairs).map(Number).filter(n => !isNaN(n))
      const nextIdx = String(existingKeys.length > 0 ? Math.max(...existingKeys) + 1 : 0)
      const alreadyExists = Object.values(newFoundPairs).some(p => p.left === message.data.left && p.right === message.data.right)
      if (!alreadyExists) {
        newFoundPairs[nextIdx] = {
          finder_uid: message.data.finder_uid || '',
          finder_name: message.data.finder_name,
          left: message.data.left,
          right: message.data.right,
        }
      }
      const newMatchPlayers = message.data.players.reduce((acc, p) => { acc[p.uid] = p; return acc }, {})
      game.value.data = { ...game.value.data, found_pairs: newFoundPairs }
      game.value.players = newMatchPlayers
      status.value = `${message.data.finder_name} matched! (${message.data.found_count}/${message.data.total_count})`
      break
    }

    case ResponseType.ROUND_FINISHED: {
      roundTimer.value = null
      roundEndTimestamp.value = null
      correctAnswer.value = message.data.correct_answer
      roundQuestion.value = message.data.question
      if (!game.value) break
      game.value.state = GameState.ROUND_FINISHED
      game.value.answers = [...(game.value.answers || []), message.data.correct_answer]
      game.value.players = message.data.players.reduce((acc, p) => { acc[p.uid] = p; return acc }, {})
      startAutoNext()
      break
    }

    case ResponseType.GAME_FINISHED:
      status.value = 'Game finished!'
      finalScores.value = message.data
      break

    case ResponseType.PLAYER_ANSWERED:
      if (!game.value) break
      game.value.players = {
        ...game.value.players,
        [message.data.uid]: { ...game.value.players[message.data.uid], ...message.data },
      }
      break

    case ResponseType.ROUND_END_TIMER:
      roundEndTimestamp.value = message.data
      break

    default:
      console.log('Unknown event:', message)
  }
}

function startGame() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send('NEXT')
    status.value = 'Starting game...'
  }
}

function nextRound() {
  cancelAutoNext()
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send('NEXT')
    status.value = 'Starting next round...'
  }
}

function startAutoNext() {
  cancelAutoNext()
  autoNextCountdown.value = 10
  autoNextInterval = setInterval(() => {
    autoNextCountdown.value--
    if (autoNextCountdown.value <= 0) {
      nextRound()
    }
  }, 1000)
}

function cancelAutoNext() {
  if (autoNextInterval) { clearInterval(autoNextInterval); autoNextInterval = null }
  autoNextCountdown.value = null
}

function endGame() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send('END_GAME')
  }
}

function goHome() {
  router.push('/')
}

// Timer watcher
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

// Mount / unmount
onMounted(() => {
  console.log(new Date().toLocaleString('en-GB', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3,hour12:false}), '[HOST] onMounted', { gameCode: route.params.gameCode, uid: route.params.uid, isCreating })
  // Cancel any pending reconnect from a previous instance
  if (reconnectTimeout) { clearTimeout(reconnectTimeout); reconnectTimeout = null }
  if (ws) { ws.close(1000, 'Remounting'); ws = null }
  const init = () => {
    if (route.params.gameCode && route.params.uid) {
      shouldConnect = true
      connectionAttempts = 0
      isInitialConnection = false
      gameCode.value = route.params.gameCode
      hostUid.value = route.params.uid
      status.value = 'Connecting...'
      connectWebSocket(route.params.gameCode, route.params.uid)
    } else if (!isCreating) {
      isCreating = true
      shouldConnect = true
      connectionAttempts = 0
      isInitialConnection = true
      createGame()
    }
  }
  setTimeout(init, 0)
})

onUnmounted(() => {
  shouldConnect = false
  if (ws) { ws.close(1000, 'Component unmounting'); ws = null }
  if (reconnectTimeout) clearTimeout(reconnectTimeout)
  if (timerInterval) clearInterval(timerInterval)
  if (autoNextTimeout) clearInterval(autoNextTimeout)
  cancelAutoNext()
})
</script>

<template>
  <!-- Game Over Screen -->
  <div v-if="finalScores" class="host-gameover">
    <h1 class="host-gameover-title">Game Over</h1>

    <div class="host-podium">
      <div
        v-for="p in podiumOrder"
        :key="p.uid"
        :class="['host-podium-slot', `host-podium-${podiumLabel(podiumRank(p))}`]"
      >
        <div class="host-podium-name">{{ p.name }}</div>
        <div class="host-podium-score">{{ p.score }} pts</div>
        <div class="host-podium-bar" :style="{ height: `${podiumHeight(podiumRank(p))}px` }">
          <span class="host-podium-rank">#{{ podiumRank(p) }}</span>
        </div>
      </div>
    </div>

    <div v-if="restPlayers.length > 0" class="host-gameover-rest">
      <div v-for="(p, idx) in restPlayers" :key="p.uid" class="host-gameover-row">
        <span>{{ idx + 4 }}. {{ p.name }}</span>
        <span>{{ p.score }} pts</span>
      </div>
    </div>

    <button class="host-gameover-btn" @click="goHome">Back to Menu</button>
  </div>

  <!-- Loading / no game state -->
  <div v-else-if="!game" class="container">
    <h1>Host</h1>
    <p>{{ status }}</p>
    <div v-if="error" class="status error">{{ error }}</div>
  </div>

  <!-- Main game view -->
  <div v-else class="container">
    <!-- Round timer -->
    <div v-if="roundTimer !== null && roundTimer > 0" class="timer">
      ⏱ {{ roundTimer }}s
    </div>

    <!-- Waiting for players -->
    <div v-if="game.state === GameState.WAITING_FOR_PLAYERS" class="waiting-room">
      <div class="waiting-room-header">
        <img :src="Logo" alt="Logo" class="waiting-logo" />
      </div>

      <div class="waiting-room-join">
        <div class="waiting-room-code">
          <div class="code-label">https://play.toolsedu.com/</div>
          <div class="code-value">{{ gameCode }}</div>
        </div>
        <div class="waiting-room-qr">
          <QrcodeVue
            :value="`${HOST_URL}/player/${gameCode}`"
            :size="160"
            background="transparent"
            foreground="#785feb"
            level="M"
            render-as="svg"
          />
          <div class="qr-label">Scan to join</div>
        </div>
      </div>

      <div class="waiting-room-players">
        <div class="players-count">{{ players.length }} player{{ players.length !== 1 ? 's' : '' }} joined</div>
        <div class="players-list">
          <div v-for="player in players" :key="player.uid" class="player-item">
            {{ player.name }}
          </div>
        </div>
      </div>

      <div class="waiting-room-actions">
        <button @click="startGame" :disabled="players.length === 0" class="btn-start">
          Start Game
        </button>
      </div>

      <div v-if="error" class="status error">{{ error }}</div>
    </div>

    <!-- Active: Word Search -->
    <template v-if="game.state === GameState.ACTIVE && isWordSearch">
      <div class="host-header">
        <div class="game-code-small">{{ gameCode }}</div>
        <img :src="Logo" alt="Logo" class="host-logo" />
        <span>{{ wsFoundCount }}/{{ wsTotalCount }} words found</span>
      </div>

      <div class="host-game-layout">
        <div class="host-main">
          <WordSearchGrid
            v-if="wsGrid"
            :grid="wsGrid"
            :foundWords="wsFoundWords"
            :interactive="false"
          />
        </div>

        <div class="host-sidebar">
          <div class="top-players">
            <h3>Top Players</h3>
            <div
              v-for="(p, idx) in top3Players"
              :key="p.uid"
              :class="['top-player-item', idx === 0 ? 'gold' : idx === 1 ? 'silver' : 'bronze']"
            >
              <span>{{ p.name }}</span>
              <span>{{ p.score }}</span>
            </div>
            <div
              v-if="players.length > 3"
              :style="{ textAlign: 'center', marginTop: '8px', fontSize: '12px', color: '#666' }"
            >
              +{{ players.length - 3 }} more
            </div>
          </div>

          <div class="ws-word-list">
            <h3>Words</h3>
            <div
              v-for="(word, idx) in wsSortedWords"
              :key="idx"
              :class="['ws-word-item', wsFoundWords[word.toLowerCase()] ? 'ws-word-found' : '']"
            >
              <span>{{ word }}</span>
              <span v-if="wsFoundWords[word.toLowerCase()]" class="ws-word-finder">{{ wsFoundWords[word.toLowerCase()].finder_name }}</span>
            </div>
          </div>

          <button class="btn-end-game" @click="endGame">End Game</button>
        </div>
      </div>
    </template>

    <!-- Active / Waiting: Matching -->
    <template v-if="(game.state === GameState.ACTIVE || game.state === GameState.WAITING_FOR_ANSWER) && isMatching">
      <div class="host-header">
        <div class="game-code-small">{{ gameCode }}</div>
        <img :src="Logo" alt="Logo" class="host-logo" />
        <span>{{ matchingFoundCount }}/{{ matchingTotalCount }} pairs matched</span>
      </div>

      <div class="matching-host-layout">
        <div class="matching-host-section">
          <div class="matching-host-section-header">Left</div>
          <div class="matching-host-scroll">
            <div
              v-for="(q, idx) in matchingQuestions"
              :key="idx"
              :class="['matching-board-item', matchedLeft.has(q.text) ? 'matching-board-matched' : '']"
            >
              <span class="matching-board-label">{{ idx + 1 }}</span>
              <span class="matching-board-text">{{ q.text }}</span>
              <span v-if="pairByLeft[q.text]" class="matching-board-pair">{{ pairByLeft[q.text].finder_name }}</span>
            </div>
          </div>
        </div>

        <div class="matching-host-section">
          <div class="matching-host-section-header">Right</div>
          <div class="matching-host-scroll">
            <div
              v-for="(opt, idx) in matchingOptions"
              :key="idx"
              :class="['matching-board-item', matchedRight.has(opt) ? 'matching-board-matched' : '']"
            >
              <span class="matching-board-label">{{ String.fromCharCode(65 + idx) }}</span>
              <span class="matching-board-text">{{ opt }}</span>
            </div>
          </div>
        </div>

        <div class="host-sidebar">
          <div class="top-players">
            <h3>Top Players</h3>
            <div
              v-for="(p, idx) in top3Players"
              :key="p.uid"
              :class="['top-player-item', idx === 0 ? 'gold' : idx === 1 ? 'silver' : 'bronze']"
            >
              <span>{{ p.name }}</span>
              <span>{{ p.score }}</span>
            </div>
            <div
              v-if="players.length > 3"
              :style="{ textAlign: 'center', marginTop: '8px', fontSize: '12px', color: '#666' }"
            >
              +{{ players.length - 3 }} more
            </div>
          </div>

          <button class="btn-end-game" @click="endGame">End Game</button>
        </div>
      </div>
    </template>

    <!-- Waiting for answer (non-matching) -->
    <template v-if="game.state === GameState.WAITING_FOR_ANSWER && !isMatching">
      <div class="host-header">
        <div class="game-code-small">{{ gameCode }}</div>
        <img :src="Logo" alt="Logo" class="host-logo" />
        <span>Round {{ game.round + 1 }} &middot; {{ answeredCount }}/{{ players.length }} answered</span>
      </div>

      <div class="question-box">
        {{ getQuestionBoxText(currentQuestion) }}
      </div>

      <div class="host-game-layout">
        <div class="host-main">
          <!-- Crossword -->
          <Crossword
            v-if="game.game_type === 'crossword' && currentQuestion"
            :gridData="game.data"
            :questions="game.questions"
            :answers="game.answers"
            :currentRound="game.round"
          />

          <!-- Multiple choice -->
          <div v-else-if="game.game_type === 'multiple-choice' && currentQuestion" class="mc-options-host">
            <div
              v-for="(option, idx) in currentQuestion.data?.options"
              :key="idx"
              :class="['mc-option-card', `mc-color-${idx % 4}`]"
            >
              <span class="mc-option-label">{{ String.fromCharCode(65 + idx) }}</span>
              <span class="mc-option-text">{{ option }}</span>
            </div>
          </div>

          <!-- Scramble -->
          <div v-else-if="game.game_type === 'scramble' && currentQuestion" class="scramble-host">
            <div class="scramble-letters">
              <div v-for="(letter, idx) in currentQuestion.text.split('')" :key="idx" class="scramble-tile">{{ letter }}</div>
            </div>
          </div>

          <!-- Fill the gaps -->
          <div v-else-if="game.game_type === 'fill-the-gaps' && currentQuestion" class="fill-gaps-host">
            <div class="fill-gaps-sentence">
              <span v-for="(part, idx) in currentQuestion.text.split('_____')" :key="idx">
                {{ part }}<span v-if="idx < currentQuestion.text.split('_____').length - 1" class="fill-gaps-blank">__________</span>
              </span>
            </div>
          </div>

          <!-- Generic -->
          <div v-else-if="currentQuestion" class="generic-question">{{ currentQuestion.text }}</div>
        </div>

        <div class="host-sidebar">
          <div class="top-players">
            <h3>Top Players</h3>
            <div
              v-for="(player, idx) in top3Players"
              :key="player.uid"
              :class="['top-player-item', idx === 0 ? 'gold' : idx === 1 ? 'silver' : 'bronze']"
            >
              <span>{{ player.name }}</span>
              <span>{{ player.score }}</span>
            </div>
            <div
              v-if="players.length > 3"
              :style="{ textAlign: 'center', marginTop: '8px', fontSize: '12px', color: '#666' }"
            >
              +{{ players.length - 3 }} more
            </div>
          </div>

          <!-- Word bank in sidebar for non-text-only types -->
          <div v-if="!isTextOnlyType() && showWordBank" :class="['word-bank']">
            <h3>Word Bank</h3>
            <div class="word-bank-list">
              <div v-for="(word, idx) in remainingWordBank" :key="idx" class="word-bank-item">{{ word }}</div>
            </div>
          </div>

          <button class="btn-next-round" @click="nextRound">Next</button>
          <button class="btn-end-game" @click="endGame">End Game</button>
        </div>
      </div>

      <!-- Word bank below for text-only types -->
      <div v-if="isTextOnlyType() && showWordBank" class="word-bank word-bank-main">
        <h3>Word Bank</h3>
        <div class="word-bank-list">
          <div v-for="(word, idx) in remainingWordBank" :key="idx" class="word-bank-item">{{ word }}</div>
        </div>
      </div>
    </template>

    <!-- Round finished -->
    <template v-if="game.state === GameState.ROUND_FINISHED">
      <div class="host-header">
        <div class="game-code-small">{{ gameCode }}</div>
        <img :src="Logo" alt="Logo" class="host-logo" />
        <span>Round {{ game.round + 1 }} Complete</span>
      </div>

      <div class="host-game-layout">
        <div class="host-main">
          <!-- Crossword (reveal) -->
          <Crossword
            v-if="game.game_type === 'crossword' && (roundQuestion || currentQuestion)"
            :gridData="game.data"
            :questions="game.questions"
            :answers="game.answers"
            :currentRound="-1"
          />

          <!-- Multiple choice (reveal) -->
          <div v-else-if="game.game_type === 'multiple-choice' && (roundQuestion || currentQuestion)" class="mc-options-host">
            <div
              v-for="(option, idx) in (roundQuestion || currentQuestion).data?.options"
              :key="idx"
              :class="['mc-option-card', `mc-color-${idx % 4}`, option === correctAnswer ? 'mc-correct' : '']"
            >
              <span class="mc-option-label">{{ String.fromCharCode(65 + idx) }}</span>
              <span class="mc-option-text">{{ option }}</span>
            </div>
          </div>

          <!-- Scramble (reveal) -->
          <div v-else-if="game.game_type === 'scramble' && (roundQuestion || currentQuestion)" class="scramble-host">
            <div class="scramble-letters">
              <div v-for="(letter, idx) in (roundQuestion || currentQuestion).text.split('')" :key="idx" class="scramble-tile">{{ letter }}</div>
            </div>
          </div>

          <!-- Fill the gaps (reveal) -->
          <div v-else-if="game.game_type === 'fill-the-gaps' && (roundQuestion || currentQuestion)" class="fill-gaps-host">
            <div class="fill-gaps-sentence">
              <span v-for="(part, idx) in (roundQuestion || currentQuestion).text.split('_____')" :key="idx">
                {{ part }}<span v-if="idx < (roundQuestion || currentQuestion).text.split('_____').length - 1" class="fill-gaps-blank">__________</span>
              </span>
            </div>
          </div>

          <!-- Generic (reveal) -->
          <div v-else-if="roundQuestion || currentQuestion" class="generic-question">{{ (roundQuestion || currentQuestion).text }}</div>
        </div>

        <div class="host-sidebar">
          <div class="top-players">
            <h3>Top Players</h3>
            <div
              v-for="(player, idx) in top3Players"
              :key="player.uid"
              :class="['top-player-item', idx === 0 ? 'gold' : idx === 1 ? 'silver' : 'bronze']"
            >
              <span>{{ player.name }}</span>
              <span>{{ player.score }}</span>
            </div>
            <div
              v-if="players.length > 3"
              :style="{ textAlign: 'center', marginTop: '8px', fontSize: '12px', color: '#666' }"
            >
              +{{ players.length - 3 }} more
            </div>
          </div>

          <!-- Word bank in sidebar for non-text-only types -->
          <div v-if="!isTextOnlyType() && showWordBank" class="word-bank">
            <h3>Word Bank</h3>
            <div class="word-bank-list">
              <div v-for="(word, idx) in remainingWordBank" :key="idx" class="word-bank-item">{{ word }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Word bank below for text-only types -->
      <div v-if="isTextOnlyType() && showWordBank" class="word-bank word-bank-main">
        <h3>Word Bank</h3>
        <div class="word-bank-list">
          <div v-for="(word, idx) in remainingWordBank" :key="idx" class="word-bank-item">{{ word }}</div>
        </div>
      </div>

      <!-- Modal popup -->
      <div class="modal-overlay">
        <div class="modal-content">
          <h2>Round {{ game.round + 1 }} Complete!</h2>
          <div class="correct-answer-big">{{ correctAnswer }}</div>

          <div class="modal-leaderboard">
            <h3>Standings</h3>
            <div
              v-for="(player, idx) in sortedPlayers"
              :key="player.uid"
              :class="['leaderboard-item', idx === 0 ? 'first' : idx === 1 ? 'second' : idx === 2 ? 'third' : '']"
            >
              <span>{{ idx + 1 }}. {{ player.name }}</span>
              <span>{{ player.score }} pts</span>
            </div>
          </div>

          <button @click="nextRound">
            Next Round<span v-if="autoNextCountdown"> ({{ autoNextCountdown }}s)</span>
          </button>
          <button v-if="autoNextCountdown" class="btn-cancel-auto" @click="cancelAutoNext">Cancel Auto-start</button>
        </div>
      </div>
    </template>

    <!-- Global error -->
    <div v-if="error" class="status error">{{ error }}</div>
  </div>
</template>

<style scoped>
.container {
  max-width: calc(100% - 40px);
  margin: 20px auto;
  background: white;
  padding: 24px;
  border-radius: 12px;
  height: calc(100vh - 40px);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
}

.players-list {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
}

.player-item {
  padding: 12px 24px;
  background: #785feb;
  color: white;
  border-radius: 8px;
  font-weight: 700;
  font-size: 16px;
  box-shadow: 0 3px 0 #5f48c9;
  animation: playerJoin 0.3s ease-out;
}

@keyframes playerJoin {
  0% {
    opacity: 0;
    transform: scale(0.8);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}

.question-box {
  background: #785feb;
  color: white;
  padding: 10px;
  border-radius: 12px;
  margin: 20px 0;
  font-size: 22px;
  font-weight: 700;
  text-align: center;
}

.leaderboard {
  margin: 20px 0;
}

.leaderboard-item {
  padding: 14px 20px;
  background: #f3f4f6;
  margin: 8px 0;
  border-radius: 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
  transition: transform 0.15s;
}

.leaderboard-item:hover {
  transform: translateX(4px);
}

.leaderboard-item.first {
  background: #fbbf24;
  color: #333;
}

.leaderboard-item.second {
  background: #d1d5db;
  color: #333;
}

.leaderboard-item.third {
  background: #d97706;
  color: white;
}

/* ── Host Game Over Screen ── */
.host-gameover {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 40px;
  background: linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4338ca 100%);
  color: white;
}

.host-gameover-title {
  font-size: 56px;
  font-weight: 900;
  margin-bottom: 56px;
  color: #ffffff;
  text-shadow: 0 2px 20px rgba(99, 102, 241, 0.5);
  letter-spacing: 2px;
  text-transform: uppercase;
}

.host-podium {
  display: flex;
  align-items: flex-end;
  gap: 16px;
  margin-bottom: 48px;
}

.host-podium-slot {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 180px;
}

.host-podium-name {
  font-size: 24px;
  font-weight: 800;
  margin-bottom: 4px;
  text-shadow: 0 1px 8px rgba(0, 0, 0, 0.3);
}

.host-podium-score {
  font-size: 17px;
  opacity: 0.85;
  margin-bottom: 12px;
  font-weight: 600;
}

.host-podium-bar {
  width: 100%;
  border-radius: 14px 14px 0 0;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
}

.host-podium-rank {
  font-size: 36px;
  font-weight: 900;
  color: rgba(255, 255, 255, 0.85);
}

.host-podium-gold .host-podium-bar {
  background: linear-gradient(180deg, #fcd34d, #f59e0b, #d97706);
  box-shadow: 0 4px 24px rgba(245, 158, 11, 0.4);
}

.host-podium-gold .host-podium-name {
  color: #fcd34d;
}

.host-podium-silver .host-podium-bar {
  background: linear-gradient(180deg, #e5e7eb, #9ca3af, #6b7280);
  box-shadow: 0 4px 24px rgba(156, 163, 175, 0.3);
}

.host-podium-bronze .host-podium-bar {
  background: linear-gradient(180deg, #fdba74, #ea580c, #c2410c);
  box-shadow: 0 4px 24px rgba(234, 88, 12, 0.3);
}

.host-gameover-rest {
  width: 100%;
  max-width: 500px;
  margin-bottom: 32px;
}

.host-gameover-row {
  display: flex;
  justify-content: space-between;
  padding: 12px 20px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  margin-bottom: 8px;
  font-size: 18px;
  font-weight: 600;
}

.host-gameover-btn {
  margin-top: 8px;
  padding: 14px 48px;
  font-size: 18px;
  font-weight: 700;
  background: white;
  color: #312e81;
  border: none;
  border-radius: 12px;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  transition: transform 0.15s, box-shadow 0.15s;
}

.host-gameover-btn:hover {
  background: #e0e7ff;
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
}

.game-code {
  font-size: 56px;
  font-weight: 900;
  color: #3e63fa;
  text-align: center;
  padding: 30px;
  background: #f3f4f6;
  border-radius: 12px;
  margin: 20px 0;
  letter-spacing: 8px;
}

.game-code-small {
  display: inline-block;
  font-size: 14px;
  font-weight: 800;
  color: white;
  background: #785feb;
  padding: 8px 16px;
  border-radius: 20px;
  letter-spacing: 3px;
}

/* Host game layout */
.host-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 2px solid #e5e7eb;
}

.host-header span {
  font-weight: 700;
  color: #6b7280;
}

.host-logo {
  height: 36px;
  width: auto;
}

/* Waiting Room */
.waiting-room {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: calc(100vh - 80px);
  padding: 20px;
}

.waiting-room-header {
  margin-bottom: 30px;
}

.waiting-logo {
  height: 50px;
  width: auto;
}

.waiting-room-join {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 40px;
  margin-bottom: 40px;
  padding: 30px;
  background: #f8f7ff;
  border-radius: 16px;
}

.waiting-room-code {
  text-align: center;
}

.waiting-room-qr {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.qr-label {
  font-size: 12px;
  font-weight: 600;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.code-label {
  font-size: 14px;
  font-weight: 600;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 2px;
  margin-bottom: 8px;
}

.code-value {
  font-size: 72px;
  font-weight: 900;
  color: #785feb;
  letter-spacing: 8px;
  line-height: 1;
}

.waiting-room-players {
  flex: 1;
  width: 100%;
  max-width: 600px;
  margin-bottom: 30px;
}

.players-count {
  text-align: center;
  font-size: 16px;
  font-weight: 600;
  color: #6b7280;
  margin-bottom: 16px;
}

.waiting-room-actions {
  display: flex;
  gap: 12px;
}

.btn-start {
  background: #22c55e;
  box-shadow: 0 4px 0 #16a34a;
  padding: 16px 48px;
  font-size: 18px;
}

.btn-start:hover {
  box-shadow: 0 6px 0 #16a34a;
}

.btn-start:disabled {
  background: #ccc;
  box-shadow: 0 4px 0 #999;
}

.btn-back {
  background: #f3f4f6;
  color: #374151;
  box-shadow: 0 4px 0 #d1d5db;
}

.btn-back:hover {
  box-shadow: 0 6px 0 #d1d5db;
}

.host-game-layout {
  display: flex;
  gap: 24px;
  align-items: stretch;
  flex: 1;
  min-height: 0;
}

.host-main {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.host-sidebar {
  width: 200px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-height: 100%;
}

.top-players {
  background: #f9fafb;
  border-radius: 8px;
  padding: 14px;
  border: 1px solid #e5e7eb;
  overflow-y: auto;
  flex-shrink: 1;
  min-height: 0;
}

.top-players h3 {
  margin: 0 0 10px 0;
  font-size: 11px;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.top-player-item {
  display: flex;
  justify-content: space-between;
  padding: 8px 10px;
  margin: 4px 0;
  background: white;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  color: #374151;
}

.top-player-item.gold {
  background: #fef3c7;
  color: #92400e;
}

.top-player-item.silver {
  background: #f3f4f6;
  color: #4b5563;
}

.top-player-item.bronze {
  background: #ffedd5;
  color: #9a3412;
}

/* Modal/Popup styles */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 2000;
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.modal-content {
  background: white;
  border-radius: 16px;
  padding: 40px;
  max-width: 480px;
  width: 90%;
  max-height: 90vh;
  overflow-y: auto;
  text-align: center;
  animation: slideUp 0.3s ease;
}

@keyframes slideUp {
  from { transform: translateY(20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

.modal-content h2 {
  margin: 0 0 20px 0;
  color: #333;
  font-size: 24px;
  font-weight: 800;
}

.correct-answer-big {
  font-size: 48px;
  font-weight: 900;
  color: #22c55e;
  margin: 24px 0;
  text-transform: uppercase;
  letter-spacing: 4px;
}

.modal-leaderboard {
  margin: 30px 0;
  text-align: left;
}

.modal-leaderboard h3 {
  text-align: center;
  margin-bottom: 15px;
  color: #6b7280;
  font-weight: 700;
}

/* Host: option cards grid */
.mc-options-host {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  padding: 20px;
  height: 100%;
  align-content: center;
}

.mc-option-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 28px;
  border-radius: 12px;
  color: white;
  font-weight: 700;
  font-size: 26px;
  transition: transform 0.2s, box-shadow 0.2s;
}

.mc-option-card.mc-correct {
  outline: 4px solid #22c55e;
  outline-offset: -4px;
  box-shadow: 0 0 20px rgba(34, 197, 94, 0.4);
}

.mc-option-label {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  background: rgba(255, 255, 255, 0.25);
  border-radius: 8px;
  font-weight: 900;
  font-size: 18px;
  flex-shrink: 0;
}

.mc-option-text {
  flex: 1;
}

/* Color variants */
.mc-color-0 { background: #e21b3c; }
.mc-color-1 { background: #1368ce; }
.mc-color-2 { background: #d89e00; }
.mc-color-3 { background: #26890c; }

/* Word bank (host sidebar) */
.word-bank {
  background: #f9fafb;
  border-radius: 10px;
  padding: 16px;
  border: 1px solid #e5e7eb;
  margin-top: 12px;
  overflow-y: auto;
  max-height: 200px;
}

.word-bank h3 {
  margin: 0 0 12px 0;
  font-size: 13px;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 1px;
  font-weight: 700;
}

.word-bank-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.word-bank-item {
  padding: 8px 16px;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 700;
  color: #374151;
  text-transform: uppercase;
}

/* Word bank below the question box for text-only game types */
.word-bank.word-bank-main {
  margin: 0 0 16px 0;
  padding: 20px 24px;
  text-align: center;
  max-height: 300px;
}

.word-bank.word-bank-main .word-bank-list {
  justify-content: center;
  gap: 10px;
}

.word-bank.word-bank-main .word-bank-item {
  padding: 10px 20px;
  font-size: 18px;
  border-radius: 10px;
  box-shadow: 0 2px 0 #e5e7eb;
}

.btn-next-round {
  margin-top: 16px;
  width: 100%;
  padding: 10px 16px;
  font-size: 12px;
  background: #3b82f6;
  box-shadow: 0 3px 0 #2563eb;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.btn-next-round:hover {
  box-shadow: 0 5px 0 #2563eb;
}

.btn-end-game {
  margin-top: 8px;
  width: 100%;
  padding: 10px 16px;
  font-size: 12px;
  background: #ef4444;
  box-shadow: 0 3px 0 #dc2626;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.btn-end-game:hover {
  box-shadow: 0 5px 0 #dc2626;
}

/* Scramble host */
.scramble-host {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
  padding: 40px;
}

.scramble-letters {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: center;
}

.scramble-tile {
  width: 90px;
  height: 90px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #785feb;
  color: white;
  font-size: 42px;
  font-weight: 900;
  border-radius: 14px;
  box-shadow: 0 5px 0 #5f48c9;
}

/* Fill gaps host */
.fill-gaps-host {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
  padding: 40px;
}

.fill-gaps-sentence {
  font-size: 40px;
  font-weight: 700;
  color: #333;
  text-align: center;
  line-height: 1.6;
}

.fill-gaps-blank {
  color: #785feb;
  padding: 0 4px;
  font-weight: 900;
}

/* ── Matching Board (Host) ── */
.matching-host-layout {
  display: flex;
  gap: 16px;
  flex: 1;
  min-height: 0;
}

.matching-host-section {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background: white;
  border-radius: 12px;
  overflow: hidden;
}

.matching-host-section-header {
  padding: 8px 14px;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: #6b7280;
  flex-shrink: 0;
}

.matching-host-scroll {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 10px 10px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.matching-board-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #f3f4f6;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  color: #333;
  transition: opacity 0.3s, background 0.3s;
}

.matching-board-item.matching-board-matched {
  background: #dcfce7;
  opacity: 0.55;
}

.matching-board-label {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  background: #785feb;
  color: white;
  font-weight: 800;
  font-size: 12px;
  flex-shrink: 0;
}

.matching-board-matched .matching-board-label {
  background: #22c55e;
}

.matching-board-text {
  flex: 1;
  line-height: 1.3;
}

.matching-board-pair {
  font-size: 11px;
  color: #22c55e;
  font-weight: 700;
  white-space: nowrap;
}

/* Host sidebar word list */
.ws-word-list {
  background: #f9fafb;
  border-radius: 8px;
  padding: 14px;
  border: 1px solid #e5e7eb;
  margin-top: 12px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.ws-word-list h3 {
  margin: 0 0 10px 0;
  font-size: 11px;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.ws-word-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 8px;
  margin: 3px 0;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 600;
  color: #374151;
}

.ws-word-item.ws-word-found {
  text-decoration: line-through;
  color: #9ca3af;
  background: #f3f4f6;
}

.ws-word-finder {
  font-size: 11px;
  color: #6b7280;
  font-weight: 500;
}

/* Generic question (fallback) */
.generic-question {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
  padding: 40px;
  font-size: 40px;
  font-weight: 700;
  color: #333;
  text-align: center;
}

.btn-cancel-auto {
  display: block;
  margin: 8px auto 0;
  padding: 8px 20px;
  font-size: 12px;
  background: transparent;
  color: #9ca3af;
  box-shadow: none;
  text-transform: none;
  letter-spacing: 0;
}

.btn-cancel-auto:hover {
  color: #ef4444;
  background: transparent;
  box-shadow: none;
  transform: none;
}
</style>
