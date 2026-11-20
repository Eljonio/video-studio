import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import apiRoutes from './routes/api.js';
import { resumeAll } from './services/runner.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = Fastify({ logger: { level: process.env.LOG_LEVEL || 'info' }, bodyLimit: 8 * 1024 * 1024 });

await app.register(multipart, { limits: { fileSize: 512 * 1024 * 1024 } });
await app.register(fastifyStatic, { root: path.join(here, '..', 'public'), prefix: '/' });
await app.register(fastifyStatic, { root: config.dataDir, prefix: '/data/', decorateReply: false });
await app.register(apiRoutes);

process.on('unhandledRejection', (err) => app.log.error({ err }, 'unhandled rejection'));
process.on('uncaughtException', (err) => app.log.error({ err }, 'uncaught exception'));

app.listen({ port: config.port, host: '127.0.0.1' }).then(async () => {
  app.log.info(`video-studio on http://127.0.0.1:${config.port}  data=${config.dataDir}`);
  await resumeAll(app.log).catch((err) => app.log.error({ err }, 'resume failed'));
});
