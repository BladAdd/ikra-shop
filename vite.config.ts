import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function catalogApiPlugin() {
  return {
    name: 'catalog-api',
    configureServer(server: any) {
      server.middlewares.use('/api/catalog', (req: any, res: any, next: any) => {
        const catalogPath = path.resolve(__dirname, 'data/catalog.json');
        if (req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          return res.end(fs.readFileSync(catalogPath, 'utf-8'));
        }
        if (req.method === 'POST' || req.method === 'PUT') {
          let body = '';
          req.on('data', (chunk: any) => {
            body += chunk;
          });
          req.on('end', () => {
            try {
              const parsed = JSON.parse(body);
              fs.writeFileSync(catalogPath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ ok: true, message: 'Сохранено' }));
            } catch (err: any) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ error: err.message }));
            }
          });
          return;
        }
        next();
      });

      server.middlewares.use('/api/upload', (req: any, res: any, next: any) => {
        if (req.method === 'POST') {
          let body = '';
          req.on('data', (chunk: any) => {
            body += chunk;
          });
          req.on('end', () => {
            try {
              const { path: imgPath, content } = JSON.parse(body);
              const cleanPath = String(imgPath).replace(/^\/+/, '');
              const fullPath = path.resolve(__dirname, cleanPath);
              fs.mkdirSync(path.dirname(fullPath), { recursive: true });
              fs.writeFileSync(fullPath, Buffer.from(content, 'base64'));
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ ok: true, path: cleanPath }));
            } catch (err: any) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ error: err.message }));
            }
          });
          return;
        }
        next();
      });
    },
  };
}

function copyStaticAssetsPlugin() {
  return {
    name: 'copy-static-assets',
    closeBundle() {
      const copyDir = (src: string, dest: string) => {
        if (!fs.existsSync(src)) return;
        fs.mkdirSync(dest, { recursive: true });
        for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
          const s = path.join(src, entry.name);
          const d = path.join(dest, entry.name);
          if (entry.isDirectory()) {
            copyDir(s, d);
          } else {
            fs.copyFileSync(s, d);
          }
        }
      };
      copyDir(path.resolve(__dirname, 'data'), path.resolve(__dirname, 'dist/data'));
      copyDir(path.resolve(__dirname, 'assets'), path.resolve(__dirname, 'dist/assets'));
    },
  };
}

export default defineConfig(() => {
  return {
    // Сайт на GitHub Pages живёт в подкаталоге (user.github.io/repo), поэтому
    // при сборке для Pages пути берутся относительные, а не от корня домена.
    // Обычная сборка остаётся с абсолютными путями — она идёт на сервер.
    base: process.env.DEPLOY_TARGET === "pages" ? "./" : "/",
    plugins: [react(), tailwindcss(), catalogApiPlugin(), copyStaticAssetsPlugin()],
    resolve: {
      alias: {
        '@': __dirname,
      },
    },
    build: {
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          admin: path.resolve(__dirname, 'admin.html'),
          paymentSuccess: path.resolve(__dirname, 'payment-success.html'),
          paymentFail: path.resolve(__dirname, 'payment-fail.html'),
          credits: path.resolve(__dirname, 'credits.html'),
        },
      },
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
