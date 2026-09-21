const fs = require('fs');
const path = require('path');
const screenshot = require('screenshot-desktop');
const sharp = require('sharp');
const sys = require('./system');

const MONITORS_FILE = path.join(__dirname, '..', 'monitors.json');

// Ручная поправка на случай, когда автоматика (по разрешению) не может
// однозначно понять, какой скриншот — какой физический монитор (одинаковое
// разрешение у обоих). "swap": true — поменять порядок сопоставления местами.
function loadMonitorConfig() {
  if (!fs.existsSync(MONITORS_FILE)) return { swap: false };
  try {
    return JSON.parse(fs.readFileSync(MONITORS_FILE, 'utf8'));
  } catch {
    return { swap: false };
  }
}

function setMonitorSwap(swap) {
  fs.writeFileSync(MONITORS_FILE, JSON.stringify({ swap: !!swap }, null, 2), 'utf8');
}

async function captureAllScreens() {
  const displays = await screenshot.listDisplays();
  const shots = [];

  for (const display of displays) {
    const img = await screenshot({ screen: display.id, format: 'jpg' });
    shots.push({ id: display.id, name: display.name, buffer: img });
  }

  return shots;
}

async function captureCombined() {
  const { buffer } = await captureCombinedWithManifest();
  return buffer;
}

// Сопоставляет скриншоты (screenshot-desktop) с их реальными границами
// (Windows.Forms.Screen) по РАЗРЕШЕНИЮ, а не по порядку обнаружения — две
// разные библиотеки могут перечислять мониторы в разном порядке, и просто
// "i-й скриншот = i-й монитор в списке" на практике оказалось неверным
// (клик по левому монитору улетал в правый). Если разрешения у мониторов
// совпадают (не с чем сверить однозначно) — откатываемся на порядок обнаружения.
function matchShotsToBounds(metas, bounds) {
  if (bounds.length !== metas.length) return metas.map(() => null);

  const used = new Set();
  const result = metas.map((m) => {
    const candidates = bounds
      .map((b, j) => ({ b, j }))
      .filter(({ b, j }) => !used.has(j) && b.w === m.width && b.h === m.height);
    if (candidates.length === 1) {
      used.add(candidates[0].j);
      return candidates[0].b;
    }
    return null;
  });

  if (result.every(Boolean)) return result;

  // Разрешения одинаковые — по ним не разобрать. Используем порядок
  // обнаружения, с ручной поправкой из monitors.json (см. "🔀 Поменять мониторы").
  const { swap } = loadMonitorConfig();
  const orderedBounds = swap ? [...bounds].reverse() : bounds;
  return metas.map((m, i) => orderedBounds[i] || { x: 0, y: 0, w: m.width, h: m.height });
}

// Склеивает скриншоты всех мониторов в одну картинку по РЕАЛЬНОМУ расположению
// окон в Windows (Bounds.X и Bounds.Y) — у тебя основной монитор справа, второй
// слева и ещё чуть смещён по вертикали, порядок обнаружения системой (просто
// порядок из screenshot-desktop) этого не отражает. Возвращает манифест — для
// каждого сегмента, где он на составной картинке и какие у него реальные
// границы — чтобы клик по картинке (веб-пульт) правильно попадал на нужный
// монитор с учётом обоих смещений.
async function captureCombinedWithManifest() {
  const shots = await captureAllScreens();
  const metas = await Promise.all(shots.map((s) => sharp(s.buffer).metadata()));
  const bounds = await sys.allScreens().catch(() => []);
  const matchedBounds = matchShotsToBounds(metas, bounds);
  const paired = shots.map((s, i) => ({ shot: s, meta: metas[i], bounds: matchedBounds[i] }));
  paired.sort((a, b) => {
    const ax = a.bounds ? a.bounds.x : 0;
    const bx = b.bounds ? b.bounds.x : 0;
    return ax - bx;
  });

  const withBounds = paired.map((p) => ({
    ...p,
    bounds: p.bounds || { x: 0, y: 0, w: p.meta.width, h: p.meta.height },
  }));

  const minY = Math.min(...withBounds.map((p) => p.bounds.y));
  const totalWidth = withBounds.reduce((sum, p) => sum + p.meta.width, 0);

  let left = 0;
  const manifest = [];
  let maxBottom = 0;
  const composite = withBounds.map((p) => {
    const scaleY = p.bounds.h / p.meta.height;
    const top = Math.round((p.bounds.y - minY) / (scaleY || 1));
    const layer = { input: p.shot.buffer, left, top };
    manifest.push({ compositeX: left, compositeY: top, width: p.meta.width, height: p.meta.height, bounds: p.bounds });
    maxBottom = Math.max(maxBottom, top + p.meta.height);
    left += p.meta.width;
    return layer;
  });

  const buffer =
    withBounds.length === 1
      ? withBounds[0].shot.buffer
      : await sharp({
          create: { width: totalWidth, height: maxBottom, channels: 3, background: { r: 0, g: 0, b: 0 } },
        })
          .composite(composite)
          .jpeg({ quality: 85 })
          .toBuffer();

  return { buffer, manifest, width: totalWidth, height: maxBottom };
}

// Переводит клик по пикселю СОСТАВНОЙ картинки в реальные координаты Windows
// (учитывая, что второй монитор может быть левее/правее и выше/ниже основного).
function mapCompositeClick(manifest, px, py) {
  const seg = manifest.find((m) => px >= m.compositeX && px < m.compositeX + m.width) || manifest[manifest.length - 1];
  const localX = px - seg.compositeX;
  const localY = py - seg.compositeY;
  const b = seg.bounds;
  const scaleX = b.w / seg.width;
  const scaleY = b.h / seg.height;
  return { x: Math.round(b.x + localX * scaleX), y: Math.round(b.y + localY * scaleY) };
}

module.exports = {
  captureAllScreens,
  captureCombined,
  captureCombinedWithManifest,
  mapCompositeClick,
  loadMonitorConfig,
  setMonitorSwap,
};
