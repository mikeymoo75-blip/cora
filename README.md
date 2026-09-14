# Cora Desktop (`cora`)

24/7 server paper desk for stocks, crypto, and Polymarket events.
Paper bank is **$1,000**, sized like real money. Bots keep running after
you close the browser. You can also buy and sell yourself at any time —
you do not wait for a bot. Fills, fees, and P/L persist on disk. No live
brokerage or wallet keys yet.

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

## Polymarket 5m / 15m

The $200 isolated book trades **Up or Down** windows on BTC, ETH, SOL, XRP,
DOGE, BNB, and HYPE (not Pump.fun). Fair value is live spot versus
Price-to-Beat, with 1-minute realized vol and a small momentum tilt. The bot
buys the cheap side when the book is ≥6¢ off fair. If spot reverses it **buys
the other leg** instead of dumping, then holds the pair to settle.

Home shows a live Price-to-Beat race: spot grows across the window, the live
price rolls like a tick, and the board flashes when it crosses the open.
Paper only.

