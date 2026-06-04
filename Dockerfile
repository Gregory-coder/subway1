FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production

COPY . .

EXPOSE 3333 8080

CMD ["node", "src/index.js"]
