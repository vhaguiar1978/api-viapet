FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p uploads

ENV NODE_ENV=production
ENV PORT=4003

EXPOSE 4003

CMD ["node", "index.js"]
