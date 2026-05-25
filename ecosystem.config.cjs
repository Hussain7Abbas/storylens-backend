/** @type {import('pm2').StartOptions} */
module.exports = {
  apps: [
    {
      name: 'storylens-api',
      cwd: __dirname,
      script: 'src/main.ts',
      interpreter: 'bun',
      env_file: '.env',
      env: {
        NODE_ENV: 'production',
        PORT: 3030,
      },
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      kill_timeout: 5000,
      time: true,
    },
  ],
};
