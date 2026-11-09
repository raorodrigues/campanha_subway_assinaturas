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
      HOST: '0.0.0.0',
      PORT: '3000',
      SIGNATURE_DB_PATH: process.env.SIGNATURE_DB_PATH || resolve(__dirname, '.data/signatures.sqlite'),
      NUXT_PUBLIC_SIGNATURE_COUNTDOWN_SECONDS: process.env.NUXT_PUBLIC_SIGNATURE_COUNTDOWN_SECONDS || '10',
      NUXT_PUBLIC_SIGNATURE_IDLE_TIMEOUT_SECONDS: process.env.NUXT_PUBLIC_SIGNATURE_IDLE_TIMEOUT_SECONDS || '5',
    },
  }],
}
