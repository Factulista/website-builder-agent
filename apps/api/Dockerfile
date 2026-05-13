FROM node:20-alpine

WORKDIR /app

COPY package.json pnpm-lock.yaml* ./
COPY apps/api ./apps/api
COPY packages ./packages

RUN npm install -g pnpm && pnpm install --frozen-lockfile

WORKDIR /app/apps/api

RUN pnpm build

EXPOSE 3001

CMD ["pnpm", "start"]
