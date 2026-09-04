FROM node:24-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src

VOLUME ["/app/data"]
ENV PORT=3000
EXPOSE 3000

CMD ["node", "src/server.js"]
