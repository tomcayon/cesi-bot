FROM node:22-alpine

# Le calcul des semaines de l'EDT utilise l'heure locale
RUN apk add --no-cache tzdata
ENV TZ=Europe/Paris \
    NODE_ENV=production

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

USER node
CMD ["node", "index.js"]
