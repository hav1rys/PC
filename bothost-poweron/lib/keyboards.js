function mainMenu() {
  return {
    inline_keyboard: [
      [{ text: '🟢 Включить ПК', callback_data: 'confirm:on' }],
      [{ text: '📊 Статус розетки', callback_data: 'act:status' }],
    ],
  };
}

function confirmMenu(action) {
  return {
    inline_keyboard: [
      [{ text: '✅ Да', callback_data: `do:${action}` }, { text: '❌ Отмена', callback_data: 'menu:main' }],
    ],
  };
}

const MAIN_TEXT = 'Включение ПК (через умную розетку):';

module.exports = { mainMenu, confirmMenu, MAIN_TEXT };
