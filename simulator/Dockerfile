FROM node:22-alpine

# Le simulateur planifie la journee en heure locale (soigneurs, photoperiode) : fuseau du site.
RUN apk add --no-cache tzdata
ENV TZ=Europe/Paris NODE_ENV=production

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src

USER node
CMD ["node", "src/index.js"]
