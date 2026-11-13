import Fastify, { type FastifyInstance } from 'fastify';
import { registerCatalog } from './catalog/catalog.routes.ts';
import { registerIdentity, type IdentityOptions } from './identity/identity.routes.ts';
import { registerMaps } from './maps/maps.routes.ts';
import { registerOrganizations } from './organizations/organizations.routes.ts';

export type AppDependencies = {
  /** Resolves when the database answers; rejects otherwise. */
  databaseProbe: () => Promise<void>;
  /** Sign-in and everything that needs a signed-in person. Omitted only in narrow tests. */
  identity?: IdentityOptions;
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

      // Everything that needs the signed-in person lives in its own scope, so the session
      // lookup never runs for /health.
      const identity = dependencies.identity;
      if (identity !== undefined) {
        await api.register(async (secured) => {
          await registerIdentity(secured, identity);
          await registerOrganizations(secured, { database: identity.database });
          await registerCatalog(secured, { database: identity.database });
          await registerMaps(secured, { database: identity.database });
        });
      }
    },
    { prefix: '/api' },
  );

  return app;
}
