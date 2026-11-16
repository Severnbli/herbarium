# syntax=docker/dockerfile:1

# ---- build: install all dependencies, build the app, then drop dev dependencies ----
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- runtime: only the built app and production dependencies, running as non-root ----
FROM node:24-alpine AS runtime

# The package managers are not needed at runtime; removing them shrinks the attack surface.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
	/usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* \
	/usr/local/bin/yarn /usr/local/bin/yarnpkg \
	&& mkdir /data && chown node:node /data

ENV NODE_ENV=production \
	HOST=0.0.0.0 \
	PORT=3000 \
	DATA_DIR=/data

WORKDIR /app
# Application files stay owned by root, so the app cannot modify its own code.
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build

USER node
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD wget -q -O /dev/null http://127.0.0.1:3000/healthz || exit 1

CMD ["node", "build"]
