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
# Numeric on purpose. The node image sets USER to the NAME "node", which the
# kubelet cannot check: a manifest with securityContext.runAsNonRoot: true and
# no runAsUser refuses to start the container ("image has non-numeric user
# (node), cannot verify user is non-root"). 1000 is the same uid/gid the
# "node" account already had, so this changes the identity's spelling and
# nothing else.
#
# This is good practice, not what the cluster relies on. The bulbs manifest
# in kube-setup sets runAsUser/runAsGroup: 1000 explicitly, and that is the
# load-bearing part - measured there, a USER-node image starts fine with it.
# Keeping the image numeric means it still runs non-root, verifiably, under a
# manifest that forgets to.
USER 1000:1000
EXPOSE 8080
CMD ["node", "dist/server.js"]
