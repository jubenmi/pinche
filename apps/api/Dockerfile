FROM node:24-alpine

WORKDIR /app

RUN apk add --no-cache font-noto-cjk

COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY apps/miniprogram/package.json apps/miniprogram/package.json
COPY packages/talk/package.json packages/talk/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm install --omit=dev --workspace apps/api

COPY apps/api apps/api
COPY packages/talk packages/talk
COPY packages/shared packages/shared
RUN chmod +x apps/api/docker-entrypoint.sh

WORKDIR /app/apps/api

EXPOSE 3018

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "src/server.js"]
