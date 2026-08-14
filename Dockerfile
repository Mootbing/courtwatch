FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates chromium fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run build

ENV CHROMIUM_PATH=/usr/bin/chromium
ENV PORT=8788
EXPOSE 8788

CMD ["npm", "run", "monitor:serve"]
