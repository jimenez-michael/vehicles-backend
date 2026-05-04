const { PrismaClient } = require('@prisma/client');

// On Azure App Service the default pool (num_cpus*2+1) can be as low as 3,
// which causes "Timed out fetching a new connection" under modest concurrency.
// Append explicit pool params so the limit and wait-timeout are predictable
// regardless of how many CPUs the host reports.
// SQL Server connection strings use semicolon-delimited params, not ?key=value.
const baseUrl = (process.env.DATABASE_URL ?? '').replace(/;$/, '');
const datasourceUrl = `${baseUrl};connection_limit=20;pool_timeout=30`;

const prisma = new PrismaClient({ datasourceUrl });

process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

module.exports = prisma;