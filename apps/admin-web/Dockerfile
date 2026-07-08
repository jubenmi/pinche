FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY apps/miniprogram/package.json apps/miniprogram/package.json
COPY apps/admin-web/package.json apps/admin-web/package.json
COPY packages/talk/package.json packages/talk/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm install --workspace apps/admin-web

COPY apps/admin-web apps/admin-web

ARG VITE_TENCENT_MAP_KEY
ENV VITE_TENCENT_MAP_KEY=${VITE_TENCENT_MAP_KEY}

RUN npm --workspace apps/admin-web run build

FROM nginx:1.27-alpine

COPY apps/admin-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/admin-web/dist /usr/share/nginx/html

EXPOSE 8080
