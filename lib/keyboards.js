const { loadApps } = require('./apps');
const { loadMacros } = require('./macros');
const { loadCharacters } = require('./characters');
const { loadSpawnPoints } = require('./spawnpoints');

function kb(rows) {
  return { keyboard: rows, resize_keyboard: true, is_persistent: true };
}

const MAIN_ROWS = [
  ['📊 Статус', '🖥 Скриншот'],
  ['🎥 Автоскрин', '🎮 Приложения'],
  ['🖱 Клик', '🖥 Мониторы'],
  ['🔧 Диагностика экранов', '🔀 Поменять мониторы'],
  ['📋 Процессы', '🔍 Найти процесс'],
  ['❌ Kill PID'],
  ['💻 Команда', '📁 Файл с ПК'],
  ['🔔 Уведомление', '🔒 Блокировка'],
  ['💤 Сон'],
  ['🔁 Перезагрузка', '🔌 Выключение'],
  ['🛑 Отменить shutdown'],
  ['🚀 Автозапуск'],
  ['📲 Пульт'],
];

function mainMenu() {
  return kb(MAIN_ROWS);
}

function monitorMenu() {
  return kb([
    ['5 сек', '10 сек', '30 сек'],
    ['⏹ Выключить'],
    ['🔙 Меню'],
  ]);
}

// Макросы вида "Имя: действие" считаются привязанными к приложению "Имя" —
// такое приложение в списке превращается в одну кнопку-группу, которая
// открывает подменю с его действиями, а не запускается напрямую.
function linkedMacros(appName) {
  return Object.keys(loadMacros()).filter((m) => m.startsWith(appName + ':'));
}

function appsMenu() {
  const apps = loadApps();
  const names = Object.keys(apps);
  const rows = [];
  for (let i = 0; i < names.length; i += 2) rows.push(names.slice(i, i + 2));
  rows.push(['➕ Добавить приложение']);
  rows.push(['🔙 Меню']);
  return kb(rows);
}

function appGroupMenu(appName) {
  const rows = linkedMacros(appName).map((m) => [`▶️ ${m}`]);
  if (Object.keys(loadCharacters()).length) rows.push([`👤 ${appName}: персонаж`]);
  rows.push([`🚀 Просто открыть: ${appName}`]);
  rows.push(['🔙 Приложения']);
  return kb(rows);
}

function confirmMenu() {
  return kb([['✅ Да', '❌ Отмена']]);
}

function listMenu(names, backLabel = '🔙 Меню') {
  const rows = [];
  for (let i = 0; i < names.length; i += 2) rows.push(names.slice(i, i + 2));
  rows.push([backLabel]);
  return kb(rows);
}

function charactersMenu() {
  return listMenu(Object.keys(loadCharacters()));
}

function spawnPointsMenu(characterName) {
  return listMenu(Object.keys(loadSpawnPoints(characterName)));
}

const MAIN_TEXT = 'Меню управления ПК:';
const APPS_TEXT = 'Выбери приложение/игру:';
const MONITOR_TEXT = 'Автоскриншоты — выбери интервал или выключи:';
const CONFIRM_TEXT = {
  restart: 'Точно перезагрузить ПК?',
  shutdown: 'Точно выключить ПК?',
  sleep: 'Точно уйти в сон?',
};

module.exports = {
  mainMenu,
  monitorMenu,
  appsMenu,
  appGroupMenu,
  linkedMacros,
  confirmMenu,
  charactersMenu,
  spawnPointsMenu,
  MAIN_TEXT,
  APPS_TEXT,
  MONITOR_TEXT,
  CONFIRM_TEXT,
  MAIN_ROWS,
};
