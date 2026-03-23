const { ApolloServer } = require('@apollo/server');
const { expressMiddleware } = require('@apollo/server/express4');
const cors = require('cors');
const dotenv = require('dotenv');
const express = require('express');
const {
  ApolloServerPluginLandingPageLocalDefault,
  ApolloServerPluginLandingPageProductionDefault,
} = require('@apollo/server/plugin/landingPage/default');
const dayjs = require('dayjs');
const localizedFormat = require('dayjs/plugin/localizedFormat');
const executableSchema = require('./src/graphql/index');
const prisma = require('./src/config/prisma');
const { createAuthMiddleware } = require('./src/config/auth');

dotenv.config();
dayjs.extend(localizedFormat);

console.log('🔥 Booting Vehicles Backend...');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('PORT:', process.env.PORT);
console.log('DATABASE_URL:', process.env.DATABASE_URL ? '✅ set' : '❌ MISSING');

if (!process.env.AZURE_TENANT_ID || !process.env.AZURE_CLIENT_ID) {
  console.error('❌ MISSING Azure AD configuration. Please set AZURE_TENANT_ID and AZURE_CLIENT_ID');
  process.exit(1);
}

process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled Rejection:', reason);
});

const app = express();
const port = process.env.PORT || 3001;

const checkJwt = createAuthMiddleware();

async function connectDatabase() {
  try {
    await prisma.$connect();
    console.log('✅ Connected to SQL Server');
  } catch (error) {
    console.error('❌ SQL Server connection failed:', error);
    process.exit(1);
  }
}

const bootstrapServer = async () => {
  try {
    await connectDatabase();

    const server = new ApolloServer({
      schema: executableSchema,
      introspection: process.env.NODE_ENV !== 'production',
      plugins: [
        process.env.NODE_ENV === 'production'
          ? ApolloServerPluginLandingPageProductionDefault()
          : ApolloServerPluginLandingPageLocalDefault(),
      ],
    });

    await server.start();

    app.use(cors());
    app.use(express.json());

    // Apply JWT middleware to all routes
    app.use(checkJwt);

    // Error handling for JWT failures
    app.use((err, req, res, next) => {
      if (err.name === 'UnauthorizedError') {
        return res.status(401).send({ error: 'Invalid or expired token' });
      }
      return next();
    });

    app.get('/', (req, res) => {
      res.status(200).send('Vehicles Backend API Running');
    });

    // GraphQL with Prisma and user context
    app.use(
      '/graphql',
      expressMiddleware(server, {
        context: async ({ req }) => {
          return {
            prisma,
            user: req?.auth || null,
          };
        },
      }),
    );

    app.listen(port, '0.0.0.0', () => {
      console.log(`🚀 Express ready at http://0.0.0.0:${port}`);
      console.log(`🚀 GraphQL ready at http://0.0.0.0:${port}/graphql`);
      console.log(`🔒 Azure AD authentication enabled for tenant: ${process.env.AZURE_TENANT_ID}`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

bootstrapServer();
