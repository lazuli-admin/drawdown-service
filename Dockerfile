FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx vite build
EXPOSE 8787
CMD ["node", "src/server.ts"]