# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app

# Copy workspace manifests (npm workspaces needs all package.jsons)
COPY package.json package-lock.json ./
COPY packages/api/package.json packages/api/package.json
COPY packages/web/package.json packages/web/package.json

# Install all dependencies
RUN npm ci

# Copy TypeScript configs
COPY tsconfig.json ./
COPY packages/api/tsconfig.json packages/api/tsconfig.json

# Copy API source
COPY packages/api/src packages/api/src

# Compile
RUN npm run build -w packages/api

# Stage 2: Production runtime
FROM node:20-alpine
WORKDIR /app

# Re-install only production dependencies for a lean image
COPY package.json package-lock.json ./
COPY packages/api/package.json packages/api/package.json
COPY packages/web/package.json packages/web/package.json
RUN npm ci --omit=dev

# Copy compiled output and migrations
COPY --from=builder /app/packages/api/dist ./dist
COPY packages/api/migrations ./migrations

EXPOSE 3001

# Run migrations then start server
CMD ["sh", "-c", "node dist/migrate.js && node dist/index.js"]
