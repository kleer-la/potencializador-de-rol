import Fastify, { type FastifyInstance } from 'fastify';

export type AppDependencies = {
  /** Resolves when the database answers; rejects otherwise. */
  databaseProbe: () => Promise<void>;
  logger?: boolean;
};

export function buildApp(dependencies: AppDependencies): FastifyInstance {
  const app = Fastify({ logger: dependencies.logger ?? false });

  app.register(
    async (api) => {
      api.get('/health', async (_request, reply) => {
        try {
          await dependencies.databaseProbe();
          return { status: 'ok' };
        } catch (error) {
          api.log.error(error, 'database probe failed');
          return reply.code(503).send({ status: 'unavailable' });
        }
      });
    },
    { prefix: '/api' },
  );

  return app;
}
