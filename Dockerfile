FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund
COPY . .
RUN node build-media.js && chown -R node:node /app
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=7741
EXPOSE 7741
CMD ["node","server.js"]
