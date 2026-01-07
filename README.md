# Quiz Game Frontend

Simple React frontend for the quiz game.

## Setup

```bash
npm install
```

## Run Development Server

```bash
npm run dev
```

The app will be available at `http://localhost:3000`

## Usage

1. Make sure the backend is running at `http://localhost:8000`
2. Open the frontend in your browser
3. Choose to be a Host or Player
4. **Host**: Creates a game and gets a code to share
5. **Player**: Joins using the game code

## URL Structure

The app uses URL routing to maintain game state on refresh:

- `/` - Home page (choose role)
- `/host` - Create new game
- `/host/:gameCode/:uid` - Host game view (automatically set after game creation)
- `/player` - Join game form
- `/player/:gameCode/:uid` - Player game view (automatically set after joining)

**Example URLs:**
- Host: `http://localhost:3000/host/TEST123/abc-123-def`
- Player: `http://localhost:3000/player/TEST123/xyz-456-ghi`

Users can refresh the page and automatically reconnect to their game!

## Features

- Host can see all players and start the game
- Players can answer questions (retry if wrong)
- Real-time updates via WebSocket
- Round timer display
- Leaderboard after each round
- Final scores at game end
- Automatic reconnection on disconnect
- **Page refresh maintains game connection** (via URL params)

