module.exports = {
  apps: [
    {
      name: 'KelasKA',
      cwd: '/home/ubuntu/KelasKA',
      script: 'node_modules/next/dist/bin/next',
      args: 'dev -p 3000 -H 0.0.0.0',
      interpreter: 'node',
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: 'development',
      },
    },
  ],
};