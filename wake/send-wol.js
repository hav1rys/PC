// Запускать НЕ на целевом ПК, а на устройстве, которое всегда включено
// (роутер с Node/OpenWrt, Raspberry Pi, второй ПК, VPS в той же сети).
// Установка: npm install wol
// Запуск: node send-wol.js AA:BB:CC:DD:EE:FF
const wol = require('wol');

const mac = process.argv[2];
if (!mac) {
  console.error('Использование: node send-wol.js AA:BB:CC:DD:EE:FF');
  process.exit(1);
}

wol.wake(mac, (err) => {
  if (err) {
    console.error('Ошибка отправки magic-пакета:', err);
    process.exit(1);
  }
  console.log(`Magic-пакет отправлен на ${mac}`);
});
