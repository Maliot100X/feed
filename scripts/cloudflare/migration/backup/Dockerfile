FROM node:24-bookworm-slim AS node
FROM postgres:18-bookworm
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /migration
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts
COPY runner.mjs ./
ENTRYPOINT ["node", "runner.mjs"]
