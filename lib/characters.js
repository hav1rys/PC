const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'characters.json');

function loadAll() {
  if (!fs.existsSync(FILE)) return {};
  return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}

function loadCharacters() {
  const all = loadAll();
  const chars = {};
  Object.keys(all).forEach((k) => {
    if (k !== '_confirm') chars[k] = all[k];
  });
  return chars;
}

function confirmCoords() {
  const all = loadAll();
  return all._confirm || [0.5, 0.876];
}

module.exports = { loadAll, loadCharacters, confirmCoords };
