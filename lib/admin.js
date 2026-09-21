const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const screenshots = require('./screenshots');
const input = require('./input');

const ROOT = path.join(__dirname, '..');
const FILES = {
  apps: path.join(ROOT, 'apps.json'),
  macros: path.join(ROOT, 'macros.json'),
  characters: path.join(ROOT, 'characters.json'),
  spawnpoints: path.join(ROOT, 'spawnpoints.json'),
};

let ADMIN_TOKEN = process.env.ADMIN_TOKEN;
if (!ADMIN_TOKEN) {
  ADMIN_TOKEN = crypto.randomBytes(16).toString('hex');
  console.warn(`ADMIN_TOKEN не задан в .env — сгенерирован временный ключ (поменяется при каждом перезапуске): ${ADMIN_TOKEN}`);
  console.warn('Добавь строку ADMIN_TOKEN=' + ADMIN_TOKEN + ' в .env, чтобы ссылка на панель была постоянной.');
}

function readJson(file) {
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function getLanIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

function startAdminServer(port) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // Всё, включая статику, закрыто ключом — иначе экран/клик/клавиатура
  // (в т.ч. ввод паролей) были бы доступны кому угодно в сети.
  app.use((req, res, next) => {
    const key = req.query.key || req.headers['x-admin-key'];
    if (key !== ADMIN_TOKEN) {
      return res.status(401).send('Неверный или отсутствующий ключ доступа. Открой ссылку целиком (с ?key=...) — бот присылает её сам.');
    }
    next();
  });

  app.use(express.static(path.join(__dirname, '..', 'admin', 'public')));

  // --- редактор конфигов (apps/macros/characters/spawnpoints) ---
  app.get('/api/config/:name', (req, res) => {
    const file = FILES[req.params.name];
    if (!file) return res.status(404).json({ error: 'unknown config: ' + req.params.name });
    try {
      res.json(readJson(file));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/config/:name', (req, res) => {
    const file = FILES[req.params.name];
    if (!file) return res.status(404).json({ error: 'unknown config: ' + req.params.name });
    if (typeof req.body !== 'object' || req.body === null) {
      return res.status(400).json({ error: 'body must be a JSON object' });
    }
    try {
      fs.writeFileSync(file, JSON.stringify(req.body, null, 2), 'utf8');
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- веб-пульт: скриншот → тап → клик/клавиатура ---
  let lastManifest = null;

  app.get('/api/remote/screenshot', async (req, res) => {
    try {
      const { buffer, manifest, width, height } = await screenshots.captureCombinedWithManifest();
      lastManifest = { manifest, width, height };
      res.set('Content-Type', 'image/jpeg');
      res.set('Cache-Control', 'no-store');
      res.send(buffer);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/remote/click', async (req, res) => {
    try {
      if (!lastManifest) return res.status(400).json({ error: 'Сначала загрузи скриншот.' });
      const x = Number(req.body.x);
      const y = Number(req.body.y);
      const button = req.body.button === 'right' ? 'right' : 'left';
      const double = !!req.body.double;
      const real = screenshots.mapCompositeClick(lastManifest.manifest, x, y);
      await input.click(real.x, real.y, { button, double });
      res.json({ ok: true, real });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/remote/drag', async (req, res) => {
    try {
      if (!lastManifest) return res.status(400).json({ error: 'Сначала загрузи скриншот.' });
      const p1 = screenshots.mapCompositeClick(lastManifest.manifest, Number(req.body.x1), Number(req.body.y1));
      const p2 = screenshots.mapCompositeClick(lastManifest.manifest, Number(req.body.x2), Number(req.body.y2));
      await input.drag(p1.x, p1.y, p2.x, p2.y);
      res.json({ ok: true, from: p1, to: p2 });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/remote/type', async (req, res) => {
    try {
      const text = req.body.text;
      if (typeof text !== 'string' || !text) return res.status(400).json({ error: 'Пустой текст.' });
      await input.type(text);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  const server = app.listen(port, () => {
    console.log(`Панель настройки: http://${getLanIp()}:${port}/?key=${ADMIN_TOKEN}`);
    console.log(`Пульт: http://${getLanIp()}:${port}/remote.html?key=${ADMIN_TOKEN}`);
  });
  server.on('error', (e) => {
    console.error('Не удалось запустить панель настройки:', e.message);
  });
  return server;
}

function remoteUrl(port) {
  return `http://${getLanIp()}:${port}/remote.html?key=${ADMIN_TOKEN}`;
}

function remoteUrlFor(baseUrl) {
  return `${baseUrl}/remote.html?key=${ADMIN_TOKEN}`;
}

module.exports = { startAdminServer, remoteUrl, remoteUrlFor, getLanIp, ADMIN_TOKEN };
