import { loadConfig } from './config.ts';
import { GameDataError } from './data/game-data.ts';
import { log } from './log.ts';
import { GameServer } from './server.ts';

const EMERGENCY_TIMEOUT_MS = 15_000;

const config = loadConfig();
const server = new GameServer(config);
server.exitHandler = (code) => process.exit(code);

let crashing = false;

process.on('unhandledRejection', (reason) => {
  log.error(
    { cat: 'server', err: reason instanceof Error ? reason.stack : String(reason) },
    'unhandled promise rejection',
  );
});

process.on('uncaughtException', (err) => {
  log.fatal({ cat: 'server', err: err.stack ?? String(err) }, 'uncaught exception');
  if (crashing) process.exit(1);
  crashing = true;
  setTimeout(() => process.exit(1), EMERGENCY_TIMEOUT_MS).unref();
  void server.shutdown(1, 'uncaught exception');
});

function onSignal(signal: NodeJS.Signals): void {
  if (server.shuttingDown) {
    log.warn({ cat: 'server', signal }, 'second shutdown signal, exiting immediately');
    process.exit(1);
  }
  void server.shutdown(0, signal);
}

process.on('SIGINT', onSignal);
process.on('SIGTERM', onSignal);

try {
  await server.start();
} catch (err) {
  if (err instanceof GameDataError) log.fatal({ cat: 'server' }, err.message);
  else log.fatal({ cat: 'server', err: err instanceof Error ? err.stack : String(err) }, 'failed to start');
  await server.shutdown(1, 'startup failed');
}
log.info(
  { maxConnections: config.server.maxConnections, database: config.database.driver },
  'teaoh is running',
);
