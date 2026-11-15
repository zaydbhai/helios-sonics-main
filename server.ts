import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import http, { type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { nasaRouter } from './server/routes/nasaRoutes.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface StartServerOptions {
  port?: number;
  host?: string;
  distPath?: string;
  forceStatic?: boolean;
}

export interface StartedServer {
  app: express.Express;
  server: Server;
  port: number;
  url: string;
}

export async function startServer(
  options: StartServerOptions = {}
): Promise<StartedServer> {
  const app = express();
  const httpServer = http.createServer(app);
  const requestedPort =
    options.port !== undefined ? options.port : Number(process.env.PORT || 3000);
  const host = options.host ?? '0.0.0.0';
  const isProd = Boolean(options.forceStatic) || process.env.NODE_ENV === 'production';

  app.use(express.json({ limit: '5mb' }));

  // Separate backend API mount for NASA datasets & live API integrations
  app.use('/api', nasaRouter);

  if (!isProd) {
    const disableHmr =
      process.env.DISABLE_HMR === 'true' || Boolean(process.env.CONTROL_PLANE_PORT);
    if (disableHmr) {
      app.get('/@vite/client', (_req, res) => {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.send(`
const sheetsMap = new Map();
export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    document.head.appendChild(style);
    sheetsMap.set(id, style);
  } else {
    style.textContent = content;
  }
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style) {
    document.head.removeChild(style);
    sheetsMap.delete(id);
  }
}
export function injectQuery(url) { return url; }
export function createHotContext() {
  return {
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    decline() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}
export class ErrorOverlay {}
`);
      });
    }
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: disableHmr ? false : { server: httpServer },
        ...(disableHmr ? { ws: false } : {}),
        watch: disableHmr ? null : {},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = options.distPath ?? path.resolve(__dirname, 'dist');
    if (fs.existsSync(distPath)) {
      app.use(
        express.static(distPath, {
          maxAge: '1h',
        })
      );
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  const server = await new Promise<Server>((resolve, reject) => {
    httpServer.once('listening', () => resolve(httpServer));
    httpServer.once('error', reject);
    httpServer.listen(requestedPort, host);
  });

  const addr = server.address();
  const actualPort =
    typeof addr === 'object' && addr !== null ? addr.port : requestedPort;
  const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host;
  const url = `http://${displayHost}:${actualPort}`;

  console.log(`Helios Sonics server listening on http://${host}:${actualPort}`);

  return { app, server, port: actualPort, url };
}

const isDirectEntry =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectEntry) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
