const { resolve } = require('node:path')

module.exports = {
  apps: [{
    name: 'assinatura',
    cwd: __dirname,
    script: '.output/server/index.mjs',
    interpreter: process.execPath,
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    restart_delay: 2000,
    kill_timeout: 5000,
    time: true,
    env: {
      NODE_ENV: 'production',
      // Localhost only: both screens run on this PC. Set HOST=0.0.0.0 to expose on the LAN.
      HOST: process.env.HOST || '127.0.0.1',
      PORT: '3000',
      SIGNATURE_DB_PATH: process.env.SIGNATURE_DB_PATH || resolve(__dirname, '.data/signatures.sqlite'),
      // Added to the shown total (signatures collected elsewhere); never stored.
      NUXT_SIGNATURE_COUNT_OFFSET: process.env.NUXT_SIGNATURE_COUNT_OFFSET || '0',
      NUXT_PUBLIC_SIGNATURE_COUNTDOWN_SECONDS: process.env.NUXT_PUBLIC_SIGNATURE_COUNTDOWN_SECONDS || '10',
      NUXT_PUBLIC_SIGNATURE_IDLE_TIMEOUT_SECONDS: process.env.NUXT_PUBLIC_SIGNATURE_IDLE_TIMEOUT_SECONDS || '5',
    },
  }],
}
