# Deployment Guide

Raspberry Pi behind a Cloudflare tunnel.

## First deploy

### 1. On the Pi — prepare files

```bash
git clone <repo> bird-log
cd bird-log

# Copy the example and fill in real Clerk production keys
cp .env.production.example .env
nano .env
```

### 2. Migrate the database

The SQLite DB lives in `./data/`. Run the schema push once before starting the container:

```bash
# Ensure bun is installed on the Pi, then:
DATABASE_PATH=./data/bird-log.db bun run db:push
```

If the `./data/` directory doesn't exist yet, create it first:

```bash
mkdir -p data uploads
```

### 3. Build and start

```bash
docker compose up -d --build
```

The app is now running on `localhost:3000`.

---

## Cloudflare tunnel

Point the tunnel at `localhost:3000`. TLS termination is handled by Cloudflare — no HTTPS config needed in the container.

```bash
# Install cloudflared on the Pi
curl -L https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
# (follow cloudflare docs for your Pi OS to finish the install)

# Create and route the tunnel
cloudflared tunnel create bird-log
cloudflared tunnel route dns bird-log yourdomain.com

# Run as a service
cloudflared service install
```

In the Cloudflare Zero Trust dashboard, set the tunnel ingress to `http://localhost:3000`.

---

## Subsequent deploys

```bash
git pull
docker compose up -d --build
```

Data persists in `./data/` and `./uploads/` across rebuilds because they are bind-mounted volumes, not part of the image.

If the schema changed, run `bun run db:push` again before restarting the container.

---

## Secrets

- Never commit `.env` (it's gitignored).
- `.env.production.example` is the canonical list of required variables.
- Clerk production keys live in the Clerk dashboard under the Production environment.
