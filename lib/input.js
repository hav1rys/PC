const path = require('path');
const { exec } = require('child_process');

function run(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (err, stdout, stderr) => {
      if (err) return reject(stderr || err.message);
      resolve(stdout);
    });
  });
}

function click(x, y, opts = {}) {
  // Именованные -x/-y, а не позиционные аргументы: у тебя второй монитор с
  // отрицательным X (слева от основного), а "голое" отрицательное число как
  // позиционный аргумент командной строки PowerShell принимает за похожий на
  // параметр флаг и тихо обнуляет — именованный параметр это исключает.
  const script = path.join(__dirname, 'click.ps1');
  const button = opts.button === 'right' ? 'right' : 'left';
  const doubleFlag = opts.double ? '-double' : '';
  return run(
    `powershell -NoProfile -ExecutionPolicy Bypass -File "${script}" -x ${Number(x)} -y ${Number(y)} -button ${button} ${doubleFlag}`
  );
}

function drag(x1, y1, x2, y2) {
  const script = path.join(__dirname, 'drag.ps1');
  return run(
    `powershell -NoProfile -ExecutionPolicy Bypass -File "${script}" -x1 ${Number(x1)} -y1 ${Number(y1)} -x2 ${Number(x2)} -y2 ${Number(y2)}`
  );
}

// SendKeys — спецсимволы +^%~(){} экранируем в фигурные скобки, текст шлём
// через base64, чтобы пароли/спецсимволы не ломали кавычки командной строки.
function type(text) {
  const escaped = String(text).replace(/([+^%~(){}])/g, '{$1}');
  const b64 = Buffer.from(escaped, 'utf16le').toString('base64');
  const script = path.join(__dirname, 'type.ps1');
  return run(`powershell -NoProfile -ExecutionPolicy Bypass -File "${script}" ${b64}`);
}

module.exports = { click, drag, type };
