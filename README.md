# BetArena (Node.js + MongoDB)

Полноценный прототип игровой платформы со ставками:
- Тёмный минималистичный интерфейс с жёлтыми CTA-кнопками.
- Sidebar + центральный игровой блок + чат.
- Игры: Jackpot, Battle Game, Fast Game, 1vs1.
- Авторизация (регистрация/вход), хеширование паролей (bcrypt), JWT.
- Хранение пользователей и истории игр в MongoDB.
- Обновления игр и чата в реальном времени через WebSocket (socket.io).

## Экономика
- Баланс хранится в монетах.
- Конвертация в профиле: `1 MDL = 10 монет`.
- Для игровых шансов (билеты): `1 монета = 10 билетов` (эквивалентно `1 MDL = 100 билетов`).

## Запуск
```bash
npm install
cp .env.example .env
npm run start
```

Открыть: `http://localhost:3000`.

## Переменные окружения
Создайте `.env`:
```env
PORT=3000
MONGO_URI=mongodb://127.0.0.1:27017/balti_games
JWT_SECRET=change_me
```

## API (кратко)
- `POST /api/auth/register` — регистрация.
- `POST /api/auth/login` — вход.
- `GET /api/me` — профиль и баланс.
- `GET /api/history` — история игрока.
- `POST /api/games/:mode/bet` — ставка (`jackpot | fast | duel`).
- `POST /api/games/battle/bet` — ставка в команду (`blue|red`).
