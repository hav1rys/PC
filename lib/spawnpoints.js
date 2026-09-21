const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'spawnpoints.json');

function loadAll() {
  if (!fs.existsSync(FILE)) return {};
  return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}

// Точки спавна для конкретного персонажа (у разных персонажей может быть
// разный набор — свои организации/аренда/квартира).
function loadSpawnPoints(characterName) {
  const all = loadAll();
  const forChar = all[characterName] || {};
  const points = {};
  Object.keys(forChar).forEach((k) => {
    if (k !== '_confirm') points[k] = forChar[k];
  });
  return points;
}

function confirmCoords(characterName) {
  const all = loadAll();
  const forChar = all[characterName] || {};
  return forChar._confirm || [0.5, 0.75];
}

module.exports = { loadAll, loadSpawnPoints, confirmCoords };
