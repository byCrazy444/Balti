const socket = io();
let token = localStorage.getItem('token') || '';
let currentUser = null;
let gameState = null;
let currentGame = 'jackpot';

const authModal = document.getElementById('authModal');
const authStatus = document.getElementById('authStatus');
const gameTitle = document.getElementById('gameTitle');
const gameId = document.getElementById('gameId');
const gamePot = document.getElementById('gamePot');
const gameStatus = document.getElementById('gameStatus');
const playersList = document.getElementById('playersList');

async function api(path, method = 'GET', body) {
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'API error');
  return data;
}

function updateProfile() {
  document.getElementById('nickname').textContent = currentUser?.username || 'Гость';
  document.getElementById('avatar').textContent = currentUser?.avatar || '🎮';
  document.getElementById('balanceCoins').textContent = `${currentUser?.balanceCoins || 0} монет`;
  document.getElementById('balanceMdl').textContent = `${currentUser?.balanceMDL || 0} MDL`;
}

function renderGame() {
  if (!gameState) return;
  const game = gameState[currentGame];
  gameTitle.textContent = document.querySelector(`[data-game='${currentGame}']`).textContent;
  gameId.textContent = `ID: ${game.id}`;

  let entries = [];
  if (currentGame === 'battle') {
    entries = [...game.teams.blue, ...game.teams.red];
  } else if (currentGame === 'fast') {
    entries = game.slots.filter(Boolean);
  } else if (currentGame === 'duel') {
    entries = game.players.filter(Boolean);
  } else {
    entries = game.players;
  }

  const pot = entries.reduce((s, p) => s + p.betCoins, 0);
  const totalTickets = entries.reduce((s, p) => s + p.tickets, 0) || 1;
  gamePot.textContent = `Банк: ${pot} монет`;
  gameStatus.textContent = `Статус: ${game.status || 'waiting'}`;

  playersList.innerHTML = entries.map((p) => {
    const chance = ((p.tickets / totalTickets) * 100).toFixed(2);
    return `<li><span>${p.username} (${p.betCoins} мон.)</span><strong>${chance}%</strong></li>`;
  }).join('') || '<li>Пока нет участников</li>';
}

async function refreshMeAndHistory() {
  if (!token) return;
  try {
    currentUser = await api('/api/me');
    updateProfile();
    authModal.classList.add('hidden');

    const history = await api('/api/history');
    document.getElementById('history').innerHTML = history.map((h) =>
      `<div>${new Date(h.createdAt).toLocaleString()} — ${h.gameType} — ${h.result} (${h.betCoins}/${h.winCoins})</div>`
    ).join('') || 'Пусто';
  } catch (error) {
    token = '';
    localStorage.removeItem('token');
    authModal.classList.remove('hidden');
  }
}

document.getElementById('registerBtn').onclick = async () => {
  try {
    await api('/api/auth/register', 'POST', {
      username: document.getElementById('username').value,
      password: document.getElementById('password').value
    });
    authStatus.textContent = 'Регистрация успешна, теперь войдите.';
  } catch (error) {
    authStatus.textContent = error.message;
  }
};

document.getElementById('loginBtn').onclick = async () => {
  try {
    const result = await api('/api/auth/login', 'POST', {
      username: document.getElementById('username').value,
      password: document.getElementById('password').value
    });
    token = result.token;
    localStorage.setItem('token', token);
    await refreshMeAndHistory();
  } catch (error) {
    authStatus.textContent = error.message;
  }
};

document.querySelectorAll('.tabs button').forEach((button) => {
  button.onclick = () => {
    document.querySelectorAll('.tabs button').forEach((btn) => btn.classList.remove('active'));
    button.classList.add('active');
    currentGame = button.dataset.game;
    renderGame();
  };
});

document.getElementById('betBtn').onclick = async () => {
  const betCoins = Number(document.getElementById('betAmount').value);
  if (!token) return alert('Войдите в аккаунт');
  try {
    if (currentGame === 'battle') {
      await api('/api/games/battle/bet', 'POST', {
        betCoins,
        side: document.getElementById('battleSide').value
      });
    } else {
      await api(`/api/games/${currentGame}/bet`, 'POST', { betCoins });
    }
    await refreshMeAndHistory();
  } catch (error) {
    alert(error.message);
  }
};

document.getElementById('chatSend').onclick = () => {
  const chatInput = document.getElementById('chatInput');
  socket.emit('chat:send', {
    username: currentUser?.username || 'Гость',
    text: chatInput.value
  });
  chatInput.value = '';
};

socket.on('state:update', (state) => {
  gameState = state;
  renderGame();
});

socket.on('game:result', (data) => {
  if (data?.winner) {
    alert(`Победитель ${data.gameType}: ${data.winner.username}, выигрыш: ${data.pot} монет`);
  }
  refreshMeAndHistory();
});

socket.on('chat:update', (messages) => {
  document.getElementById('chatMessages').innerHTML = messages.map((m) =>
    `<div class='message'><strong>${m.username}</strong><div>${m.text}</div></div>`
  ).join('');
});

refreshMeAndHistory();
