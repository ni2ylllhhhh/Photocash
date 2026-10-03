import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'telegram-bot-service',
        configureServer(server) {
          // Add API proxy for verifying Telegram channels with zero CORS
          server.middlewares.use('/api/verify-channel', async (req, res) => {
            try {
              const url = new URL(req.url || '', `http://${req.headers.host}`);
              const userId = url.searchParams.get('user_id') || '';
              const channel = url.searchParams.get('channel') || '';
              const botToken =
                url.searchParams.get('bot_token') ||
                '8738784866:AAFk8eHwv2xuswJTCBxGcvKAwZuUJHq4bK0';

              if (!userId || !channel) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Missing user_id or channel' }));
                return;
              }

              const cleanChannel = channel.replace(/^@/, '').replace(/https?:\/\/t\.me\//i, '');
              const tgRes = await fetch(
                `https://api.telegram.org/bot${botToken}/getChatMember?chat_id=@${encodeURIComponent(
                  cleanChannel
                )}&user_id=${encodeURIComponent(userId)}`
              );
              const data = await tgRes.json();
              const status = data?.result?.status;
              const isMember = ['member', 'administrator', 'creator', 'restricted'].includes(status);

              res.writeHead(200, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              });
              res.end(
                JSON.stringify({
                  ok: true,
                  joined: isMember,
                  status: status || (isMember ? 'member' : 'not_joined'),
                  description: data?.description || '',
                })
              );
            } catch (err: any) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: err?.message || 'Server error' }));
            }
          });

          // Launch Telegram Bot Polling Worker continuously alongside Vite dev server
          import('./bot-daemon.js').catch((err) => {
            console.error('Telegram bot worker startup error:', err);
          });
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
