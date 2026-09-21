const allowedIds = (process.env.ALLOWED_IDS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean)
  .map(Number);

function isAllowed(userId) {
  return allowedIds.includes(Number(userId));
}

function guard(bot, handler) {
  return (msg, ...args) => {
    if (!isAllowed(msg.from.id)) {
      bot.sendMessage(
        msg.chat.id,
        `Доступ запрещён. Твой Telegram ID: ${msg.from.id}\nДобавь его в ALLOWED_IDS в .env, если это ты.`
      );
      return;
    }
    return handler(msg, ...args);
  };
}

module.exports = { isAllowed, guard, allowedIds };
