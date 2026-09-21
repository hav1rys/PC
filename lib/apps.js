const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const sys = require('./system');

const APPS_FILE = path.join(__dirname, '..', 'apps.json');

function loadApps() {
  const raw = JSON.parse(fs.readFileSync(APPS_FILE, 'utf8'));
  delete raw._comment;
  return raw;
}

function entryPath(entry) {
  return typeof entry === 'string' ? entry : entry.path;
}

function listApps() {
  const apps = loadApps();
  return Object.keys(apps)
    .map((name) => {
      const e = apps[name];
      const elevated = typeof e === 'object' && e.elevated;
      return `${name} → ${entryPath(e)}${elevated ? ' (админ)' : ''}`;
    })
    .join('\n');
}

function openApp(name) {
  const apps = loadApps();
  const entry = apps[name];
  if (!entry) {
    return Promise.reject(`Приложение "${name}" не найдено в apps.json. Смотри /apps.`);
  }
  if (typeof entry === 'object' && entry.elevated) {
    return sys.launchElevated(name, entry.path);
  }
  return runRaw(`start "" "${entryPath(entry)}"`);
}

function runRaw(cmd) {
  // chcp 65001 — UTF-8 в консоли, иначе кириллица в ошибках Windows превращается в иероглифы.
  return new Promise((resolve, reject) => {
    exec(`chcp 65001>nul && ${cmd}`, { windowsHide: false }, (err, stdout, stderr) => {
      if (err) return reject(stderr || err.message);
      resolve(stdout || 'OK');
    });
  });
}

function addApp(name, target, elevated = false) {
  const raw = JSON.parse(fs.readFileSync(APPS_FILE, 'utf8'));
  raw[name] = elevated ? { path: target, elevated: true } : target;
  fs.writeFileSync(APPS_FILE, JSON.stringify(raw, null, 2), 'utf8');
}

module.exports = { loadApps, listApps, openApp, runRaw, addApp };
