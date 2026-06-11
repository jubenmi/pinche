FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY apps/miniprogram/package.json apps/miniprogram/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm install --omit=dev --workspace apps/api

COPY apps/api apps/api
COPY packages/shared packages/shared

WORKDIR /app/apps/api

EXPOSE 3018

CMD ["node", "src/server.js"]
