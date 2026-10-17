// PM2 process file: keeps the bot running and restarts it after crashes and reboots.
// Start:   pm2 start deploy/ecosystem.config.cjs   (run from the project folder)
module.exports = {
  apps: [
    {
      name: 'whatsapp-bot',
      cwd: __dirname + '/../server', // uploads/ and the SQLite file are resolved from here
      script: 'dist/index.js',
      instances: 1, // keep 1: the per-customer message lock is in memory
      exec_mode: 'fork',
      env: { NODE_ENV: 'production', HOST: '127.0.0.1' },
      max_memory_restart: '400M',
      time: true,
    },
  ],
};
