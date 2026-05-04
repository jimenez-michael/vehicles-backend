const { PrismaClient } = require('@prisma/client');

const connectionLimit = parseInt(process.env.DATABASE_POOL_SIZE ?? '20', 10);
const baseUrl = (process.env.DATABASE_URL ?? '').replace(/;$/, '');
const datasourceUrl = `${baseUrl};connection_limit=${connectionLimit};pool_timeout=30`;

const prisma = new PrismaClient({ datasourceUrl });

// Graceful shutdown — covers normal exit, Ctrl-C, and nodemon restarts.
// nodemon sends SIGUSR2; production containers send SIGTERM.
// Without these, the pool connections stay open on SQL Server across restarts,
// eventually exhausting the server-side connection limit.
async function disconnect() {
  await prisma.$disconnect();
}

process.once('beforeExit', disconnect);
process.once('SIGINT', () => disconnect().then(() => process.exit(0)));
process.once('SIGTERM', () => disconnect().then(() => process.exit(0)));
process.once('SIGUSR2', () => disconnect().then(() => process.kill(process.pid, 'SIGUSR2')));

module.exports = prisma;