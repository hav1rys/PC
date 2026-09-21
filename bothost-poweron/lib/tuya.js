const { TuyaContext } = require('@tuya/tuya-connector-nodejs');

function client() {
  return new TuyaContext({
    baseUrl: process.env.TUYA_BASE_URL,
    accessKey: process.env.TUYA_ACCESS_KEY,
    secretKey: process.env.TUYA_SECRET_KEY,
  });
}

async function setSwitch(on) {
  const deviceId = process.env.TUYA_DEVICE_ID;
  const res = await client().request({
    method: 'POST',
    path: `/v1.0/iot-03/devices/${deviceId}/commands`,
    body: { commands: [{ code: 'switch_1', value: on }] },
  });
  if (!res.success) throw new Error(res.msg || 'Tuya API error');
  return res;
}

async function getStatus() {
  const deviceId = process.env.TUYA_DEVICE_ID;
  const res = await client().request({
    method: 'GET',
    path: `/v1.0/iot-03/devices/${deviceId}/status`,
  });
  if (!res.success) throw new Error(res.msg || 'Tuya API error');
  const sw = res.result.find((s) => s.code === 'switch_1');
  return sw ? sw.value : null;
}

module.exports = { setSwitch, getStatus };
