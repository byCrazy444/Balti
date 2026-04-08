require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*'
  }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-change-me';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/balti_games';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

mongoose.connect(MONGO_URI).then(() => {
  console.log('MongoDB connected');
}).catch((error) => {
  console.error('MongoDB connection error:', error.message);
});

const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  passwordHash: { type: String, required: true },
  balanceCoins: { type: Number, default: 1000 },
  avatar: { type: String, default: '🎮' }
}, { timestamps: true });

const historySchema = new mongoose.Schema({
  gameType: { type: String, required: true },
  gameId: { type: String, required: true },
  betCoins: { type: Number, required: true },
  winCoins: { type: Number, default: 0 },
  chancePercent: { type: Number, default: 0 },
  result: { type: String, enum: ['win', 'lose'], required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
const GameHistory = mongoose.model('GameHistory', historySchema);

const gameState = {
  jackpot: {
    id: `JP-${Date.now()}`,
    status: 'waiting',
    endsAt: Date.now() + 45000,
    players: []
  },
  battle: {
    id: `BT-${Date.now()}`,
    status: 'waiting',
    endsAt: Date.now() + 60000,
    teams: { blue: [], red: [] }
  },
  fast: {
    id: `FG-${Date.now()}`,
    status: 'waiting',
    slots: [null, null, null]
  },
  duel: {
    id: `D1-${Date.now()}`,
    status: 'waiting',
    players: [null, null]
  },
  chat: []
};

function toTicketsFromCoins(coins) {
  return coins * 10;
}

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const token = header.split(' ')[1];
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

async function ensureBalance(userId, betCoins) {
  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }
  if (betCoins <= 0) {
    throw new Error('Bet must be positive');
  }
  if (user.balanceCoins < betCoins) {
    throw new Error('Insufficient balance');
  }
  user.balanceCoins -= betCoins;
  await user.save();
  return user;
}

function pickWinnerByTickets(entries) {
  const totalTickets = entries.reduce((sum, entry) => sum + entry.tickets, 0);
  let roll = Math.random() * totalTickets;
  for (const entry of entries) {
    roll -= entry.tickets;
    if (roll <= 0) {
      return entry;
    }
  }
  return entries[entries.length - 1];
}

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password || password.length < 6) {
      return res.status(400).json({ error: 'Username/password invalid (min 6 chars).' });
    }
    const exists = await User.findOne({ username });
    if (exists) {
      return res.status(409).json({ error: 'User already exists' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ username, passwordHash });
    return res.status(201).json({ message: 'Registered', userId: user._id });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ userId: user._id.toString(), username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    return res.json({ token });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/api/me', auth, async (req, res) => {
  const user = await User.findById(req.user.userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json({
    username: user.username,
    avatar: user.avatar,
    balanceCoins: user.balanceCoins,
    balanceMDL: Number((user.balanceCoins / 10).toFixed(2))
  });
});

app.get('/api/history', auth, async (req, res) => {
  const items = await GameHistory.find({ userId: req.user.userId }).sort({ createdAt: -1 }).limit(50);
  res.json(items);
});

app.get('/api/games/state', (_req, res) => {
  res.json(gameState);
});

app.post('/api/games/jackpot/bet', auth, async (req, res) => {
  try {
    const betCoins = Number(req.body.betCoins);
    const user = await ensureBalance(req.user.userId, betCoins);
    gameState.jackpot.players.push({
      userId: user._id.toString(),
      username: user.username,
      betCoins,
      tickets: toTicketsFromCoins(betCoins)
    });
    io.emit('state:update', gameState);
    res.json({ message: 'Bet accepted' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/games/battle/bet', auth, async (req, res) => {
  try {
    const betCoins = Number(req.body.betCoins);
    const side = req.body.side === 'red' ? 'red' : 'blue';
    const user = await ensureBalance(req.user.userId, betCoins);
    gameState.battle.teams[side].push({
      userId: user._id.toString(),
      username: user.username,
      betCoins,
      tickets: toTicketsFromCoins(betCoins)
    });
    io.emit('state:update', gameState);
    res.json({ message: 'Battle bet accepted' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/games/fast/bet', auth, async (req, res) => {
  try {
    const betCoins = Number(req.body.betCoins);
    const user = await ensureBalance(req.user.userId, betCoins);

    const first = gameState.fast.slots.find(Boolean);
    if (first) {
      const min = first.betCoins * 0.9;
      const max = first.betCoins * 1.1;
      if (betCoins < min || betCoins > max) {
        throw new Error(`Bet must be within ±10%: ${min.toFixed(2)}-${max.toFixed(2)}`);
      }
    }

    const slotIndex = gameState.fast.slots.findIndex((slot) => !slot);
    if (slotIndex === -1) {
      throw new Error('No free slots in fast game');
    }

    gameState.fast.slots[slotIndex] = {
      userId: user._id.toString(),
      username: user.username,
      betCoins,
      tickets: toTicketsFromCoins(betCoins)
    };
    io.emit('state:update', gameState);
    res.json({ message: 'Fast game entry confirmed' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/games/duel/bet', auth, async (req, res) => {
  try {
    const betCoins = Number(req.body.betCoins);
    const user = await ensureBalance(req.user.userId, betCoins);

    const freeIndex = gameState.duel.players.findIndex((slot) => !slot);
    if (freeIndex === -1) {
      throw new Error('1vs1 already full');
    }

    gameState.duel.players[freeIndex] = {
      userId: user._id.toString(),
      username: user.username,
      betCoins,
      tickets: toTicketsFromCoins(betCoins)
    };

    io.emit('state:update', gameState);
    res.json({ message: '1vs1 bet accepted' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

function resetJackpot() {
  gameState.jackpot = {
    id: `JP-${Date.now()}`,
    status: 'waiting',
    endsAt: Date.now() + 45000,
    players: []
  };
}

async function settleGame(gameType, entries, pot) {
  if (entries.length < 2) {
    return null;
  }
  const winner = pickWinnerByTickets(entries);
  const winnerUser = await User.findById(winner.userId);
  if (winnerUser) {
    winnerUser.balanceCoins += pot;
    await winnerUser.save();
  }

  const totalTickets = entries.reduce((s, e) => s + e.tickets, 0);
  await Promise.all(entries.map((entry) => GameHistory.create({
    gameType,
    gameId: `${gameType}-${Date.now()}`,
    betCoins: entry.betCoins,
    winCoins: entry.userId === winner.userId ? pot : 0,
    chancePercent: Number(((entry.tickets / totalTickets) * 100).toFixed(2)),
    result: entry.userId === winner.userId ? 'win' : 'lose',
    userId: entry.userId
  })));

  return winner;
}

setInterval(async () => {
  const now = Date.now();

  if (now >= gameState.jackpot.endsAt) {
    const players = gameState.jackpot.players;
    const pot = players.reduce((s, p) => s + p.betCoins, 0);
    const winner = await settleGame('jackpot', players, pot);
    io.emit('game:result', { gameType: 'jackpot', winner, pot });
    resetJackpot();
  }

  const battleEntries = [...gameState.battle.teams.blue, ...gameState.battle.teams.red];
  if (battleEntries.length >= 2 && now >= gameState.battle.endsAt) {
    const pot = battleEntries.reduce((s, p) => s + p.betCoins, 0);
    const winner = await settleGame('battle', battleEntries, pot);
    io.emit('game:result', { gameType: 'battle', winner, pot });
    gameState.battle = {
      id: `BT-${Date.now()}`,
      status: 'waiting',
      endsAt: Date.now() + 60000,
      teams: { blue: [], red: [] }
    };
  }

  if (gameState.fast.slots.every(Boolean)) {
    const entries = gameState.fast.slots;
    const pot = entries.reduce((s, p) => s + p.betCoins, 0);
    const winner = await settleGame('fast', entries, pot);
    io.emit('game:result', { gameType: 'fast', winner, pot });
    gameState.fast = { id: `FG-${Date.now()}`, status: 'waiting', slots: [null, null, null] };
  }

  if (gameState.duel.players.every(Boolean)) {
    const entries = gameState.duel.players;
    const pot = entries.reduce((s, p) => s + p.betCoins, 0);
    const winner = await settleGame('duel', entries, pot);
    io.emit('game:result', { gameType: 'duel', winner, pot });
    gameState.duel = { id: `D1-${Date.now()}`, status: 'waiting', players: [null, null] };
  }

  io.emit('state:update', gameState);
}, 1000);

io.on('connection', (socket) => {
  socket.emit('state:update', gameState);
  socket.emit('chat:update', gameState.chat);

  socket.on('chat:send', (payload) => {
    const message = {
      username: payload.username || 'Гость',
      text: String(payload.text || '').slice(0, 250),
      at: new Date().toISOString()
    };
    if (!message.text.trim()) {
      return;
    }
    gameState.chat.push(message);
    if (gameState.chat.length > 100) {
      gameState.chat.shift();
    }
    io.emit('chat:update', gameState.chat);
  });
});

server.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
});
