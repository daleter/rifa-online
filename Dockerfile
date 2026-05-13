FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /data

ENV NODE_ENV=production
ENV DB_PATH=/data/rifa.db
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]
