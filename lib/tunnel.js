const { spawn } = require('child_process');
const fs = require('fs');

const FALLBACK_PATH = 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe';
const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

let currentUrl = null;
let warned = false;

function resolveBinary() {
  return fs.existsSync(FALLBACK_PATH) ? FALLBACK_PATH : 'cloudflared';
}

// "Быстрый" туннель Cloudflare — без аккаунта и домена, но адрес
// trycloudflare.com меняется при каждом перезапуске; текущий читаем из
// вывода процесса и подставляем в ссылку на пульт.
function startQuickTunnel(port) {
  const bin = resolveBinary();
  const proc = spawn(bin, ['tunnel', '--url', `http://localhost:${port}`], { windowsHide: true });

  const onData = (data) => {
    const text = data.toString();
    const m = text.match(URL_RE);
    if (m) {
      currentUrl = m[0];
      console.log('Cloudflare Tunnel (доступ из интернета):', currentUrl);
    }
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);

  proc.on('error', (e) => {
    if (!warned) {
      console.warn('cloudflared не запустился (' + e.message + ') — пульт будет доступен только по локальной сети.');
      warned = true;
    }
  });
  proc.on('exit', (code) => {
    if (currentUrl) console.warn('cloudflared завершился (код ' + code + ') — ссылка из интернета перестала работать.');
    currentUrl = null;
  });

  return proc;
}

function getTunnelUrl() {
  return currentUrl;
}

module.exports = { startQuickTunnel, getTunnelUrl };
