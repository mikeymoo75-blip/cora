# Apex Desk (`cora`)

Paper trading terminal for stocks, crypto, and Pump.fun-style coins.
Simulated fills only — no live brokerage, exchange, or wallet keys.

Public URL on the home server: [https://www.datosfarm.com/cora](https://www.datosfarm.com/cora)

## First install on the home server

Does **not** replace `/opt/mp-basketball`. Lives next to it at `/opt/cora`.

```bash
sudo mkdir -p /opt/cora
sudo chown "$USER":"$USER" /opt/cora
git clone git@github.com:mikeymoo75-blip/cora.git /opt/cora
cd /opt/cora
docker compose up -d --build
```

Then point `/cora` at `127.0.0.1:43148` using `deploy/nginx-cora.conf` or `deploy/caddy.cora.caddy`.
If you use Cloudflare Tunnel like the gym app, add a public hostname path `/cora` → `localhost:43148`.

## Later updates (same pattern as the gym app)

```bash
cd /opt/cora && git pull && sudo docker compose up -d --build
```

Or: `cd /opt/cora && ./scripts/deploy.sh`
