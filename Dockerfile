FROM node:26-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:26-alpine
WORKDIR /app
# Stamped by the deploy so the running container can report which build it is.
# Defaults to "dev" for local builds, which is what you want to see locally.
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY public ./public
# Numeric on purpose. The node image sets USER to the NAME "node", and a
# non-numeric user cannot be checked by the kubelet: with
# securityContext.runAsNonRoot: true it refuses to start the container at all
# ("image has non-numeric user (node), cannot verify user is non-root") rather
# than hardening it. 1000 is the same uid/gid the "node" account already had,
# so this changes the identity's spelling and nothing else - it is what makes
# the manifest able to assert non-root.
USER 1000:1000
EXPOSE 8080
CMD ["node", "dist/server.js"]
