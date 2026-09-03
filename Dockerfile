# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS dependencies

WORKDIR /app

# Ferramentas usadas caso o modulo nativo "usb" precise ser compilado.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        g++ \
        libudev-dev \
        libusb-1.0-0-dev \
        make \
        python3 \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:20-bookworm-slim AS runtime

WORKDIR /app

# Bibliotecas necessarias em tempo de execucao para acessar impressoras USB.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libudev1 \
        libusb-1.0-0 \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PRINT_AGENT_DATA_DIR=/data \
    PRINT_AGENT_PORT=9100

COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json server.js ./

RUN mkdir -p /data

EXPOSE 9100
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:9100/status').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"]

CMD ["node", "server.js"]
