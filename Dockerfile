FROM node:22-slim

WORKDIR /app

RUN npm install -g pnpm@10 --quiet

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY tsconfig.base.json tsconfig.json ./
COPY lib/ ./lib/
COPY scripts/ ./scripts/
COPY artifacts/api-server/ ./artifacts/api-server/

RUN pnpm install --no-frozen-lockfile

RUN pnpm --filter @workspace/api-server run build

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
