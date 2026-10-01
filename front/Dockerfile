FROM node:22-alpine AS vendor
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY tools ./tools
COPY public ./public
RUN node tools/vendor.js

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=vendor /app/public /usr/share/nginx/html
