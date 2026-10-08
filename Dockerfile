FROM node:24.20.0-bookworm

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@12.3.4 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY prisma ./prisma
COPY prisma7.config.ts ./
RUN pnpm prisma:generate

COPY . .

EXPOSE 3001

CMD ["pnpm", "start:dev"]
