import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  appType: 'mpa',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        admin: path.resolve(__dirname, 'admin.html')
      }
    }
  },
  plugins: [
    {
      // Lets /admin resolve to admin.html on the dev server, matching prod.
      name: 'admin-rewrite',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === '/admin' || req.url.startsWith('/admin/')) {
            req.url = '/admin.html';
          }
          next();
        });
      }
    }
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4321',
      '/uploads': 'http://localhost:4321'
    }
  }
});
