FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js game.js db.js log.js stats.js deck.json ./
COPY public ./public
RUN mkdir -p data/log && chown -R node data
USER node
EXPOSE 8080
ENV PORT=8080
CMD ["node", "server.js"]
