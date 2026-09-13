FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV DOCKER=1
ENV HOSTNAME=0.0.0.0
ENV PORT=8080
ENV TZ=America/New_York
EXPOSE 8080

CMD ["node", "scripts/with-app-env.mjs", "vite", "preview", "--host", "0.0.0.0", "--port", "8080"]
