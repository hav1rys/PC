const { exec } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const si = require('systeminformation');

const TASK_NAME = 'PCControlBot';
const RUN_BAT = path.join(__dirname, '..', 'run.bat');

function run(cmd) {
  // chcp 65001 — переключает консоль на UTF-8, иначе кириллица в сообщениях
  // Windows (например, из schtasks) приходит в OEM-кодировке и превращается в иероглифы.
  return new Promise((resolve, reject) => {
    exec(`chcp 65001>nul && ${cmd}`, (err, stdout, stderr) => {
      if (err) return reject(stderr || err.message);
      resolve(stdout);
    });
  });
}

// schtasks /create ... /rl highest падает с "Access is denied", если сам
// вызывающий процесс не элevated — поэтому именно РЕГИСТРАЦИЮ задания (один
// раз) запускаем через явный UAC-запрос. Дальше уже готовое задание
// запускается через schtasks /run без элevation и без диалогов вообще.
//
// Окно elevated-процесса закрывается мгновенно, поэтому его вывод не считать
// глазами — пишем его в лог-файл и читаем оттуда сами, чтобы вернуть точный
// текст ошибки в Telegram. Само окно UAC-подтверждения всё равно всплывёт —
// это неизбежная часть Windows, его нужно один раз подтвердить руками.
function runElevatedOnce(cmd) {
  return new Promise((resolve, reject) => {
    const stamp = Date.now();
    const tmpBat = path.join(os.tmpdir(), `pcbot_elevate_${stamp}.bat`);
    const tmpLog = path.join(os.tmpdir(), `pcbot_elevate_${stamp}.log`);
    // Start-Process не пробрасывает код возврата elevated-процесса наружу,
    // поэтому пишем его сами в лог отдельной строкой и проверяем её —
    // иначе упавшая внутри команда молча считалась бы успехом.
    fs.writeFileSync(
      tmpBat,
      `@echo off\r\nchcp 65001>nul\r\n${cmd} > "${tmpLog}" 2>&1\r\necho EXITCODE=%errorlevel% >> "${tmpLog}"\r\n`,
      'utf8'
    );
    const psCmd = `Start-Process -FilePath '${tmpBat}' -Verb RunAs -Wait -WindowStyle Hidden`;
    exec(`powershell -NoProfile -Command "${psCmd}"`, (err, stdout, stderr) => {
      let log = '';
      try {
        log = fs.readFileSync(tmpLog, 'utf8').trim();
      } catch {}
      try { fs.unlinkSync(tmpBat); } catch {}
      try { fs.unlinkSync(tmpLog); } catch {}

      if (err) return reject(log || stderr || err.message);

      const m = log.match(/EXITCODE=(-?\d+)/);
      const cleanLog = log.replace(/\r?\nEXITCODE=-?\d+\s*$/, '');
      if (m && Number(m[1]) !== 0) return reject(cleanLog || `Код возврата: ${m[1]}`);
      resolve(cleanLog || 'OK');
    });
  });
}

const restart = () => run('shutdown /r /t 5');
const shutdown = () => run('shutdown /s /t 5');
const cancelShutdown = () => run('shutdown /a');
const sleep = () => run('rundll32.exe powrprof.dll,SetSuspendState 0,1,0');
const lock = () => run('rundll32.exe user32.dll,LockWorkStation');

async function status() {
  const [cpu, mem, disks, osInfo] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.fsSize(),
    si.osInfo(),
  ]);

  const gb = (bytes) => (bytes / 1024 ** 3).toFixed(1);
  const diskLines = disks
    .map((d) => `  ${d.mount || d.fs}: ${gb(d.used)} / ${gb(d.size)} ГБ`)
    .join('\n');

  return [
    `ОС: ${osInfo.distro} (${osInfo.arch})`,
    `Аптайм: ${(os.uptime() / 3600).toFixed(1)} ч`,
    `CPU загрузка: ${cpu.currentLoad.toFixed(1)}%`,
    `RAM: ${gb(mem.used)} / ${gb(mem.total)} ГБ`,
    `Диски:\n${diskLines}`,
  ].join('\n');
}

async function topProcesses(limit = 10) {
  const data = await si.processes();
  return data.list
    .sort((a, b) => b.cpu - a.cpu)
    .slice(0, limit)
    .map((p) => `${p.pid}\t${p.cpu.toFixed(1)}%\t${p.mem.toFixed(1)}%\t${p.name}`)
    .join('\n');
}

function killProcess(target) {
  // /T — как "Завершить дерево процессов" в Диспетчере задач: убивает вместе
  // с дочерними, иначе процесс-наблюдатель лаунчера просто поднимает его заново.
  // Принимает и PID (число), и имя процесса (например "ecef_process.exe") —
  // из простого Диспетчера задач PID не всегда видно, а имя видно всегда.
  const t = String(target).trim();
  const selector = /^\d+$/.test(t) ? `/PID ${t}` : `/IM "${t}"`;
  return run(`taskkill ${selector} /T /F`);
}

// Ищет по подстроке в имени ИЛИ полном пути — топ-10 по CPU не показывает
// процессы с низкой нагрузкой (типичный лаунчер в фоне), а путь помогает
// понять, какой это .exe/.lnk на самом деле.
async function findProcesses(query) {
  const data = await si.processes();
  const q = query.toLowerCase();
  return data.list
    .filter((p) => p.name.toLowerCase().includes(q) || (p.path || '').toLowerCase().includes(q))
    .map((p) => `${p.pid}\t${p.name}\n  ${p.path || '(путь неизвестен)'}`)
    .join('\n');
}

async function screenInfo() {
  const cmd = `powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens | ForEach-Object { '{0} | Primary={1} | X={2} Y={3} | W={4} H={5}' -f $_.DeviceName, $_.Primary, $_.Bounds.X, $_.Bounds.Y, $_.Bounds.Width, $_.Bounds.Height }"`;
  const out = await run(cmd);
  return out.trim();
}

function parseScreens(info) {
  return info
    .split('\n')
    .map((line) => {
      const m = line.match(/Primary=(True|False)\s*\|\s*X=(-?\d+)\s+Y=(-?\d+)\s*\|\s*W=(\d+)\s+H=(\d+)/);
      if (!m) return null;
      return { primary: m[1] === 'True', x: Number(m[2]), y: Number(m[3]), w: Number(m[4]), h: Number(m[5]) };
    })
    .filter(Boolean);
}

// В естественном порядке обнаружения системой (тот же порядок, в котором
// screenshot-desktop обычно нумерует мониторы).
async function allScreens() {
  return parseScreens(await screenInfo());
}

// Отсортированы слева направо по реальной X-координате Windows (у тебя основной
// справа, второй слева — порядок обнаружения системой тут не подходит).
async function allScreensSortedByX() {
  const screens = await allScreens();
  return [...screens].sort((a, b) => a.x - b.x);
}

async function isAutostartEnabled() {
  try {
    await run(`schtasks /query /tn "${TASK_NAME}"`);
    return true;
  } catch {
    return false;
  }
}

function enableAutostart() {
  return runElevatedOnce(`schtasks /create /tn "${TASK_NAME}" /tr "${RUN_BAT}" /sc onlogon /rl highest /f`);
}

function disableAutostart() {
  return run(`schtasks /delete /tn "${TASK_NAME}" /f`);
}

function elevatedTaskName(appName) {
  return 'PCBot_' + appName.replace(/[^a-zA-Zа-яА-Я0-9_]/g, '_');
}

async function launchElevated(appName, targetPath) {
  const taskName = elevatedTaskName(appName);
  const exists = await run(`schtasks /query /tn "${taskName}"`).then(() => true).catch(() => false);
  if (!exists) {
    // Триггер в прошлом ("once", дата в 2020) — задание никогда не сработает само,
    // запускаем его вручную через schtasks /run. Саму РЕГИСТРАЦИЮ (одноразово,
    // при первом использовании) — через runElevatedOnce, см. комментарий там.
    await runElevatedOnce(
      `schtasks /create /tn "${taskName}" /tr "${targetPath}" /sc once /sd 01/01/2020 /st 00:00 /rl highest /f`
    );
  }
  return run(`schtasks /run /tn "${taskName}"`);
}

module.exports = {
  restart,
  shutdown,
  cancelShutdown,
  sleep,
  lock,
  status,
  topProcesses,
  findProcesses,
  killProcess,
  screenInfo,
  isAutostartEnabled,
  enableAutostart,
  disableAutostart,
  allScreens,
  allScreensSortedByX,
  launchElevated,
};
