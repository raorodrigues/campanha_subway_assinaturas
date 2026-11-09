module.exports = {
  apps: [{
    name: 'contador-assinaturas',
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
      PORT: '3001',
      NUXT_SIGNATURE_API_BASE: process.env.NUXT_SIGNATURE_API_BASE || 'http://localhost:3000',
    },
  }],
}
