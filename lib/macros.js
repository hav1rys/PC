const fs = require('fs');
const path = require('path');
const input = require('./input');
const sys = require('./system');

const MACROS_FILE = path.join(__dirname, '..', 'macros.json');

function loadMacros() {
  if (!fs.existsSync(MACROS_FILE)) return {};
  return JSON.parse(fs.readFileSync(MACROS_FILE, 'utf8'));
}

async function primaryBounds() {
  const info = await sys.screenInfo();
  const lines = info.split('\n');
  const line = lines.find((l) => /Primary=True/i.test(l)) || lines[0];
  const m = line.match(/X=(-?\d+)\s+Y=(-?\d+)\s*\|\s*W=(\d+)\s+H=(\d+)/);
  if (!m) throw new Error('Не удалось определить разрешение основного экрана: ' + info);
  return { x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) };
}

async function clickPercent(px, py) {
  const bounds = await primaryBounds();
  const x = Math.round(bounds.x + px * bounds.w);
  const y = Math.round(bounds.y + py * bounds.h);
  return input.click(x, y);
}

async function runMacro(name, afterStep) {
  const macros = loadMacros();
  const steps = macros[name];
  if (!steps) throw new Error(`Макрос "${name}" не найден`);

  for (const step of steps) {
    if (step.launch) {
      // lazy require — apps.js не знает про macros.js, цикла нет
      const apps = require('./apps');
      await apps.openApp(step.launch);
    } else if (step.click) {
      const [x, y] = step.click;
      await input.click(x, y);
    } else if (step.clickPercent) {
      await clickPercent(step.clickPercent[0], step.clickPercent[1]);
    } else if (step.shot && afterStep) {
      await afterStep(step);
    }
    if (step.wait) await new Promise((r) => setTimeout(r, step.wait));
  }
}

module.exports = { loadMacros, runMacro, clickPercent };
