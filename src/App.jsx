import { Routes, Route, useNavigate } from 'react-router-dom'
import Host from './components/Host'
import Player from './components/Player'

function Home() {
  const navigate = useNavigate()

  return (
    <div className="container">
      <h1>Quiz Game</h1>
      <p>Choose your role:</p>
      <div>
        <button onClick={() => navigate('/host')}>Create Game (Host)</button>
        <button onClick={() => navigate('/player')}>Join Game (Player)</button>
      </div>
    </div>
  )
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Player />} />
      <Route path="/menu" element={<Home />} />
      <Route path="/host" element={<Host />} />
      <Route path="/host/:gameCode/:uid" element={<Host />} />
      <Route path="/player" element={<Player />} />
      <Route path="/player/:gameCode" element={<Player />} />
      <Route path="/:gameCode" element={<Player />} />
      <Route path="/player/:gameCode/:uid" element={<Player />} />
    </Routes>
  )
}

export default App

