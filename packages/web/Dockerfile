# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app

# Copy workspace manifests
COPY package.json package-lock.json ./
COPY packages/api/package.json packages/api/package.json
COPY packages/web/package.json packages/web/package.json

# Install all dependencies
RUN npm ci

# Copy web source
COPY packages/web/index.html packages/web/index.html
COPY packages/web/tsconfig.json packages/web/tsconfig.json
COPY packages/web/vite.config.ts packages/web/vite.config.ts
COPY packages/web/src packages/web/src

# Build — VITE_API_BASE_URL defaults to /api (proxied by nginx)
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build -w packages/web

# Stage 2: Serve with nginx
FROM nginx:alpine
COPY --from=builder /app/packages/web/dist /usr/share/nginx/html
COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
