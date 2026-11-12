# Build context: repository root.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --workspace @potencializador/api

COPY apps/api/src apps/api/src

USER node
EXPOSE 3000
# Node runs the TypeScript sources directly (type stripping); there is no build step.
CMD ["node", "apps/api/src/main.ts"]
