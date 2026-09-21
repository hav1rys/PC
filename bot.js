require('dotenv').config();
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const notifier = require('node-notifier');

const { guard, isAllowed, allowedIds } = require('./lib/auth');
const { captureCombined, captureAllScreens, loadMonitorConfig, setMonitorSwap } = require('./lib/screenshots');
const sys = require('./lib/system');
const apps = require('./lib/apps');
const input = require('./lib/input');
const macros = require('./lib/macros');
const characters = require('./lib/characters');
const spawnpoints = require('./lib/spawnpoints');
const kb = require('./lib/keyboards');
const { startAdminServer, remoteUrl, remoteUrlFor } = require('./lib/admin');
const { startQuickTunnel, getTunnelUrl } = require('./lib/tunnel');

const ADMIN_PORT = Number(process.env.ADMIN_PORT) || 4100;

const TOKEN = process.env.BOT_TOKEN;
const INCOMING_DIR = path.resolve(process.env.INCOMING_DIR || './incoming');

if (!TOKEN) {
  console.error('BOT_TOKEN не задан. Заполни .env (см. .env.example).');
  process.exit(1);
}
if (allowedIds.length === 0) {
  console.warn('ВНИМАНИЕ: ALLOWED_IDS пуст — никто не сможет пройти проверку доступа.');
}
if (!fs.existsSync(INCOMING_DIR)) fs.mkdirSync(INCOMING_DIR, { recursive: true });

const bot = new TelegramBot(TOKEN, { polling: true });

let monitorTimer = null;
// chatId -> 'kill' | 'run' | 'notify' | 'getfile' | 'click'  (ждём следующее сообщение как аргумент)
const pending = {};
// chatId -> 'restart' | 'shutdown' | 'sleep'  (ждём "Да"/"Отмена")
const pendingConfirm = {};
// chatId -> { name }  (промежуточное состояние диалога "Добавить приложение")
const addAppState = {};
// chatId -> имя выбранного персонажа (для точек спавна конкретно под него)
const selectedCharacter = {};

async function sendScreens(chatId) {
  const buffer = await captureCombined();
  await bot.sendPhoto(chatId, buffer, {}, { filename: 'screens.jpg', contentType: 'image/jpeg' });
}

function showMain(chatId, text = kb.MAIN_TEXT) {
  bot.sendMessage(chatId, text, { reply_markup: kb.mainMenu() });
}

function showCharacterPicker(chatId) {
  bot.sendMessage(chatId, '👤 Выбери персонажа:', { reply_markup: kb.charactersMenu() });
}

function showSpawnPicker(chatId, characterName) {
  bot.sendMessage(chatId, '📍 Выбери точку спавна:', { reply_markup: kb.spawnPointsMenu(characterName) });
}

bot.onText(/\/start|\/help|\/menu/, guard(bot, (msg) => showMain(msg.chat.id)));

const ASK_PROMPTS = {
  kill: 'Пришли PID или имя процесса для завершения (например "ecef_process.exe"):',
  run: 'Пришли команду для выполнения в cmd:',
  notify: 'Пришли текст уведомления:',
  getfile: 'Пришли путь к файлу на ПК:',
  findproc: 'Пришли часть имени процесса для поиска (например "gta"):',
  click: 'Пришли координаты клика в формате "x y" (сначала глянь 🖥 Скриншот и 🖥 Мониторы, чтобы понять систему координат).',
};

bot.on('message', guard(bot, async (msg) => {
  const text = msg.text;
  if (!text || text.startsWith('/')) return;
  const chatId = msg.chat.id;

  // --- подтверждение restart/shutdown/sleep ---
  if (pendingConfirm[chatId]) {
    const action = pendingConfirm[chatId];
    delete pendingConfirm[chatId];
    if (text === '✅ Да') {
      try {
        if (action === 'restart') {
          bot.sendMessage(chatId, 'Перезагрузка через 5 сек...');
          await sys.restart();
        } else if (action === 'shutdown') {
          bot.sendMessage(chatId, 'Выключение через 5 сек...');
          await sys.shutdown();
        } else if (action === 'sleep') {
          bot.sendMessage(chatId, 'Ухожу в сон...');
          await sys.sleep();
        }
      } catch (e) {
        bot.sendMessage(chatId, `Ошибка: ${e}`);
      }
    }
    return showMain(chatId);
  }

  // --- навигация и мгновенные действия ---
  switch (text) {
    case '🔙 Меню':
      delete selectedCharacter[chatId];
      return showMain(chatId);

    case '📊 Статус': {
      const t = await sys.status().catch((e) => `Ошибка: ${e}`);
      return bot.sendMessage(chatId, t);
    }

    case '🖥 Скриншот':
      return sendScreens(chatId).catch((e) => bot.sendMessage(chatId, `Не удалось сделать скриншот: ${e}`));

    case '🖥 Мониторы': {
      const t = await sys.screenInfo().catch((e) => `Ошибка: ${e}`);
      return bot.sendMessage(chatId, t);
    }

    case '🔧 Диагностика экранов': {
      try {
        const shots = await captureAllScreens();
        const info = await sys.screenInfo().catch(() => '(не удалось получить)');
        await bot.sendMessage(chatId, `Границы по Windows:\n${info}\n\nНиже — каждый скриншот отдельно, по порядку обнаружения (0, 1, ...):`);
        for (let i = 0; i < shots.length; i++) {
          await bot.sendPhoto(chatId, shots[i].buffer, { caption: `#${i}  id=${shots[i].id}  name=${shots[i].name}` });
        }
      } catch (e) {
        bot.sendMessage(chatId, `Ошибка: ${e}`);
      }
      return;
    }

    case '🔀 Поменять мониторы': {
      const cfg = loadMonitorConfig();
      setMonitorSwap(!cfg.swap);
      return bot.sendMessage(chatId, `Порядок сопоставления мониторов ${!cfg.swap ? 'поменян местами' : 'возвращён как был'}. Проверь клик по обоим экранам.`);
    }

    case '🎥 Автоскрин':
      return bot.sendMessage(chatId, kb.MONITOR_TEXT, { reply_markup: kb.monitorMenu() });

    case '5 сек':
    case '10 сек':
    case '30 сек': {
      const seconds = parseInt(text, 10);
      if (monitorTimer) clearInterval(monitorTimer);
      monitorTimer = setInterval(() => {
        sendScreens(chatId).catch((e) => console.error('monitor error:', e));
      }, seconds * 1000);
      return bot.sendMessage(chatId, `Автоскриншоты каждые ${seconds} сек включены.`, { reply_markup: kb.monitorMenu() });
    }

    case '⏹ Выключить':
      if (monitorTimer) {
        clearInterval(monitorTimer);
        monitorTimer = null;
      }
      return bot.sendMessage(chatId, 'Автоскриншоты выключены.', { reply_markup: kb.monitorMenu() });

    case '🎮 Приложения':
      return bot.sendMessage(chatId, kb.APPS_TEXT, { reply_markup: kb.appsMenu() });

    case '📋 Процессы': {
      const t = await sys.topProcesses().catch((e) => `Ошибка: ${e}`);
      return bot.sendMessage(chatId, `PID\tCPU\tMEM\tИмя\n${t}`);
    }

    case '🔒 Блокировка':
      await sys.lock().catch((e) => bot.sendMessage(chatId, `Ошибка: ${e}`));
      return bot.sendMessage(chatId, 'Экран заблокирован.');

    case '🛑 Отменить shutdown':
      await sys.cancelShutdown().catch(() => {});
      return bot.sendMessage(chatId, 'Отменено (если что-то было запланировано).');

    case '🚀 Автозапуск': {
      try {
        const enabled = await sys.isAutostartEnabled();
        if (enabled) {
          await sys.disableAutostart();
          bot.sendMessage(chatId, 'Автозапуск выключен (задание в Планировщике удалено).');
        } else {
          await sys.enableAutostart();
          bot.sendMessage(chatId, 'Автозапуск включён — бот будет сам стартовать при входе в Windows.');
        }
      } catch (e) {
        bot.sendMessage(chatId, `Ошибка: ${e}`);
      }
      return;
    }

    case '📲 Пульт': {
      const tunnel = getTunnelUrl();
      const lines = [`Локально (тот же Wi-Fi):\n${remoteUrl(ADMIN_PORT)}`];
      if (tunnel) {
        lines.push(`Из любой точки (интернет):\n${remoteUrlFor(tunnel)}`);
      } else {
        lines.push('Ссылка из интернета (Cloudflare Tunnel) пока не готова — подожди пару секунд после старта бота и попробуй снова.');
      }
      return bot.sendMessage(chatId, lines.join('\n\n'));
    }

    case '➕ Добавить приложение':
      pending[chatId] = 'addapp_name';
      return bot.sendMessage(chatId, 'Как назвать приложение (это будет текст кнопки)?');

    case '💤 Сон':
    case '🔁 Перезагрузка':
    case '🔌 Выключение': {
      const map = { '💤 Сон': 'sleep', '🔁 Перезагрузка': 'restart', '🔌 Выключение': 'shutdown' };
      pendingConfirm[chatId] = map[text];
      return bot.sendMessage(chatId, kb.CONFIRM_TEXT[map[text]], { reply_markup: kb.confirmMenu() });
    }

    case '❌ Kill PID':
    case '💻 Команда':
    case '📁 Файл с ПК':
    case '🔔 Уведомление':
    case '🖱 Клик':
    case '🔍 Найти процесс': {
      const map = {
        '❌ Kill PID': 'kill',
        '💻 Команда': 'run',
        '📁 Файл с ПК': 'getfile',
        '🔔 Уведомление': 'notify',
        '🖱 Клик': 'click',
        '🔍 Найти процесс': 'findproc',
      };
      const action = map[text];
      pending[chatId] = action;
      return bot.sendMessage(chatId, ASK_PROMPTS[action]);
    }
  }

  // --- клик по названию приложения из подменю "Приложения" ---
  const appNames = Object.keys(apps.loadApps());
  if (appNames.includes(text)) {
    if (kb.linkedMacros(text).length) {
      return bot.sendMessage(chatId, `${text} — выбери действие:`, { reply_markup: kb.appGroupMenu(text) });
    }
    try {
      await apps.openApp(text);
      bot.sendMessage(chatId, `Открываю: ${text}`);
    } catch (e) {
      bot.sendMessage(chatId, `Ошибка: ${e}`);
    }
    return;
  }

  // --- "🔙 Приложения" — назад из подменю группы в список приложений ---
  if (text === '🔙 Приложения') {
    return bot.sendMessage(chatId, kb.APPS_TEXT, { reply_markup: kb.appsMenu() });
  }

  // --- "🚀 Просто открыть: <имя>" — прямой запуск без макроса ---
  if (text.startsWith('🚀 Просто открыть: ')) {
    const name = text.slice('🚀 Просто открыть: '.length);
    try {
      await apps.openApp(name);
      bot.sendMessage(chatId, `Открываю: ${name}`);
    } catch (e) {
      bot.sendMessage(chatId, `Ошибка: ${e}`);
    }
    return;
  }

  // --- запуск макроса (кнопка "▶️ <имя>" из подменю "Приложения") ---
  if (text.startsWith('▶️ ')) {
    const macroName = text.slice('▶️ '.length);
    if (Object.keys(macros.loadMacros()).includes(macroName)) {
      bot.sendMessage(chatId, `Выполняю "${macroName}"...`);
      try {
        await macros.runMacro(macroName, () => sendScreens(chatId).catch(() => {}));
        return showCharacterPicker(chatId);
      } catch (e) {
        bot.sendMessage(chatId, `Ошибка макроса: ${e}`);
      }
      return;
    }
  }

  // --- "игра уже открыта, сразу к выбору персонажа" (для любого приложения) ---
  if (/^👤 .+: персонаж$/.test(text)) {
    return showCharacterPicker(chatId);
  }

  // --- выбор персонажа ---
  const characterMap = characters.loadCharacters();
  if (Object.keys(characterMap).includes(text)) {
    bot.sendMessage(chatId, `Выбираю персонажа: ${text}...`);
    try {
      const [cx, cy] = characterMap[text];
      await macros.clickPercent(cx, cy);
      await new Promise((r) => setTimeout(r, 1000));
      const [cfx, cfy] = characters.confirmCoords();
      await macros.clickPercent(cfx, cfy); // "Выбрать персонажа"
      await new Promise((r) => setTimeout(r, 10000));
      await sendScreens(chatId).catch(() => {});
      selectedCharacter[chatId] = text;
      return showSpawnPicker(chatId, text);
    } catch (e) {
      bot.sendMessage(chatId, `Ошибка: ${e}`);
    }
    return;
  }

  // --- выбор точки спавна (набор точек — свой для выбранного персонажа) ---
  const activeCharacter = selectedCharacter[chatId];
  if (activeCharacter) {
    const spawnPoints = spawnpoints.loadSpawnPoints(activeCharacter);
    if (Object.keys(spawnPoints).includes(text)) {
      delete selectedCharacter[chatId];
      bot.sendMessage(chatId, `Точка: ${text}...`);
      try {
        const [sx, sy] = spawnPoints[text];
        await macros.clickPercent(sx, sy);
        await new Promise((r) => setTimeout(r, 1500));
        const [cfx, cfy] = spawnpoints.confirmCoords(activeCharacter);
        await macros.clickPercent(cfx, cfy); // "Подтвердить"
        await sendScreens(chatId).catch(() => {});
        bot.sendMessage(chatId, 'Готово.');
        return showMain(chatId);
      } catch (e) {
        bot.sendMessage(chatId, `Ошибка: ${e}`);
      }
      return;
    }
  }

  // --- ответ на "ask:*" ---
  const action = pending[chatId];
  if (!action) return;
  delete pending[chatId];

  try {
    if (action === 'kill') {
      await sys.killProcess(text.trim());
      bot.sendMessage(chatId, `Процесс ${text.trim()} завершён.`);
    } else if (action === 'run') {
      const out = await apps.runRaw(text);
      bot.sendMessage(chatId, `Готово:\n${String(out).slice(0, 3500) || '(нет вывода)'}`);
    } else if (action === 'findproc') {
      const out = await sys.findProcesses(text.trim());
      bot.sendMessage(chatId, out || 'Ничего не найдено.');
    } else if (action === 'notify') {
      notifier.notify({ title: 'Сообщение из Telegram', message: text });
      bot.sendMessage(chatId, 'Показал уведомление на ПК.');
    } else if (action === 'getfile') {
      const p = text.trim();
      if (!fs.existsSync(p)) return bot.sendMessage(chatId, `Файл не найден: ${p}`);
      await bot.sendDocument(chatId, p);
    } else if (action === 'click') {
      const m = text.trim().match(/^(-?\d+)[\s,]+(-?\d+)$/);
      if (!m) return bot.sendMessage(chatId, 'Не понял координаты. Формат: "x y", например "540 320".');
      await input.click(m[1], m[2]);
      bot.sendMessage(chatId, `Кликнул по (${m[1]}, ${m[2]}).`);
    } else if (action === 'addapp_name') {
      addAppState[chatId] = { name: text.trim() };
      pending[chatId] = 'addapp_path';
      bot.sendMessage(
        chatId,
        'Теперь пришли путь к .exe (например C:\\Games\\Game\\game.exe) или steam://rungameid/<AppID> для игры из Steam:'
      );
    } else if (action === 'addapp_path') {
      const state = addAppState[chatId];
      if (!state) return bot.sendMessage(chatId, 'Что-то пошло не так, начни заново: ➕ Добавить приложение.');
      state.target = text.trim();
      pending[chatId] = 'addapp_elevated';
      bot.sendMessage(chatId, 'Запускать от имени администратора? (да / нет)');
    } else if (action === 'addapp_elevated') {
      const state = addAppState[chatId];
      delete addAppState[chatId];
      if (!state) return bot.sendMessage(chatId, 'Что-то пошло не так, начни заново: ➕ Добавить приложение.');
      const elevated = /^д/i.test(text.trim());
      apps.addApp(state.name, state.target, elevated);
      bot.sendMessage(chatId, `Добавлено: ${state.name} → ${state.target}${elevated ? ' (админ)' : ''}`, {
        reply_markup: kb.appsMenu(),
      });
    }
  } catch (e) {
    bot.sendMessage(chatId, `Ошибка: ${e}`);
  }
}));

bot.on('document', guard(bot, async (msg) => {
  const fileId = msg.document.file_id;
  const fileName = msg.document.file_name || `${fileId}`;
  const dest = path.join(INCOMING_DIR, fileName);
  try {
    await bot.downloadFile(fileId, INCOMING_DIR);
    bot.sendMessage(msg.chat.id, `Сохранено: ${dest}`);
  } catch (e) {
    bot.sendMessage(msg.chat.id, `Ошибка сохранения: ${e.message}`);
  }
}));

bot.on('polling_error', (err) => console.error('polling_error:', err.message));

console.log('PC control bot запущен. Разрешённые ID:', allowedIds.length ? allowedIds : '(нет — задай ALLOWED_IDS в .env)');

startAdminServer(ADMIN_PORT);
startQuickTunnel(ADMIN_PORT);

// Через 5 сек после старта (например, после входа в Windows при автозапуске)
// шлём скриншот рабочего стола — чтобы сразу видеть, что всё загрузилось.
setTimeout(() => {
  allowedIds.forEach((id) => {
    sendScreens(id).catch((e) => console.error('startup screenshot error:', e.message || e));
  });
}, 5000);
