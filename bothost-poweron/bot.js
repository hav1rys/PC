require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const { guard, isAllowed, allowedIds } = require('./lib/auth');
const kb = require('./lib/keyboards');
const tuya = require('./lib/tuya');

const TOKEN = process.env.BOT_TOKEN;

if (!TOKEN) {
  console.error('BOT_TOKEN не задан. Заполни .env (см. .env.example).');
  process.exit(1);
}
if (allowedIds.length === 0) {
  console.warn('ВНИМАНИЕ: ALLOWED_IDS пуст — никто не сможет пройти проверку доступа.');
}

const bot = new TelegramBot(TOKEN, { polling: true });

function sendMainMenu(chatId) {
  bot.sendMessage(chatId, kb.MAIN_TEXT, { reply_markup: kb.mainMenu() });
}

bot.onText(/\/start|\/help|\/menu/, guard(bot, (msg) => {
  sendMainMenu(msg.chat.id);
}));

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data;

  if (!isAllowed(query.from.id)) {
    return bot.answerCallbackQuery(query.id, { text: 'Доступ запрещён', show_alert: true });
  }
  bot.answerCallbackQuery(query.id).catch(() => {});

  const edit = (text, keyboard) =>
    bot.editMessageText(text, { chat_id: chatId, message_id: messageId, reply_markup: keyboard }).catch(() => {});

  try {
    if (data === 'menu:main') return edit(kb.MAIN_TEXT, kb.mainMenu());

    if (data === 'confirm:on') {
      return edit('Точно включить ПК (подать питание на розетку)?', kb.confirmMenu('on'));
    }

    if (data === 'do:on') {
      await tuya.setSwitch(true);
      bot.sendMessage(
        chatId,
        'Питание на розетку подано. Если в BIOS настроено "Restore on AC Power Loss" — ПК загрузится сам в течение примерно 10-30 сек.'
      );
      return edit(kb.MAIN_TEXT, kb.mainMenu());
    }

    if (data === 'act:status') {
      const on = await tuya.getStatus();
      const text = on === null ? 'Не удалось получить статус.' : `Розетка сейчас: ${on ? 'включена 🟢' : 'выключена 🔴'}`;
      return bot.sendMessage(chatId, text);
    }
  } catch (e) {
    bot.sendMessage(chatId, `Ошибка: ${e.message || e}`);
  }
});

bot.on('polling_error', (err) => console.error('polling_error:', err.message));

console.log('Power-on bot запущен. Разрешённые ID:', allowedIds.length ? allowedIds : '(нет — задай ALLOWED_IDS в .env)');
