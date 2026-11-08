FROM node:24-alpine@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8 AS build
WORKDIR /app/baize-prototype/game
COPY baize-prototype/game/package.json baize-prototype/game/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY baize-prototype/game/ ./
COPY baize-prototype/data/ ../data/
COPY baize-prototype/assets/ ../assets/
RUN npm test && npm run build
ARG APP_VERSION=development
ARG VCS_REF=unknown
RUN node -e "require('node:fs').writeFileSync('dist/version.json', JSON.stringify({version:process.env.APP_VERSION,revision:process.env.VCS_REF})+'\n')"

FROM nginx:stable-alpine@sha256:583b7f2fce1cdb8da5ad5c39ebd3c33b98b87d493190e548bdee1fa8c619c311
ARG APP_VERSION=development
ARG VCS_REF=unknown
LABEL org.opencontainers.image.source="https://github.com/SmartStudio/baize-rich" \
      org.opencontainers.image.title="白泽秘境大富翁" \
      org.opencontainers.image.version="$APP_VERSION" \
      org.opencontainers.image.revision="$VCS_REF"
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/baize-prototype/game/dist/ /usr/share/nginx/html/
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
