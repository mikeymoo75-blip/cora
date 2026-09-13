# Cora Desktop (`cora`)

24/7 server paper desk for stocks, crypto, and Pump.fun-style coins.
Bots keep running after you close the browser. Fills, fees, and P/L persist
on disk. No live brokerage or wallet keys yet.

Live: [https://cora.datosfarm.com](https://cora.datosfarm.com)

Gym stays at [https://www.datosfarm.com](https://www.datosfarm.com).

## First install on the home server

Does **not** replace `/opt/mp-basketball`. Lives next to it at `/opt/cora`.

```bash
sudo mkdir -p /opt/cora
sudo chown "$USER":"$USER" /opt/cora
git clone https://github.com/mikeymoo75-blip/cora.git /opt/cora
cd /opt/cora
docker compose up -d --build
```

Cloudflare Tunnel published app: `cora.datosfarm.com` → `http://cora-proxy:80`.

## Later updates

```bash
cd /opt/cora && git pull && sudo docker compose up -d --build
```

Book and bot state live in the `cora-data` Docker volume.
