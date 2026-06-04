# XMR Mining Pool

A fully functional Monero (XMR) mining pool server with Stratum v1 protocol, PPLNS reward system, automated payouts, and web dashboard.

## Features

- **Stratum v1 Protocol** — TCP server on port 3333, compatible with XMRig and any standard miner
- **RandomX Algorithm** — Full Monero RandomX support
- **PPLNS Rewards** — Pay Per Last N Shares for fair reward distribution
- **0.1% Pool Fee** — Ultra-low fee
- **No Minimum Payout** — All balances are paid out, however small
- **Variable Difficulty (VarDiff)** — Automatically adjusts difficulty per miner hashrate
- **Automated Payouts** — Uses Monero wallet RPC to send transactions automatically
- **Web Dashboard** — Real-time pool stats, miner lookup, blocks, and payouts
- **REST API** — `/api/stats`, `/api/miner/:address`, `/api/blocks`, `/api/payouts`
- **Docker Compose** — One-command deployment with all services

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Miners    │────▶│  Stratum     │────▶│   Redis     │
│  (XMRig)   │◀────│  Server:3333 │     │  (cache)    │
└─────────────┘     └──────┬───────┘     └─────────────┘
                           │
                    ┌──────▼───────┐
                    │  Pool Core   │
                    │  - Block Mgr │
                    │  - Payout Mgr│
                    │  - PPLNS     │
                    └──┬───────┬───┘
                       │       │
              ┌────────▼──┐ ┌──▼──────────┐
              │ PostgreSQL │ │   monerod   │
              │ (shares,   │ │  (daemon)   │
              │  payouts)  │ │             │
              └────────────┘ └──────┬──────┘
                                    │
                           ┌────────▼────────┐
                           │ monero-wallet-  │
                           │ rpc (payouts)   │
                           └─────────────────┘
```

## Quick Start

### Prerequisites

- Docker & Docker Compose
- A Monero wallet address for the pool

### 1. Clone and Configure

```bash
git clone https://github.com/YOUR_USER/xmr-mining-pool.git
cd xmr-mining-pool
cp .env.example .env
```

Edit `.env` with your settings:

```env
POOL_WALLET_ADDRESS=4...your_monero_address...
POSTGRES_PASSWORD=your_secure_password
WALLET_RPC_USER=rpc_user
WALLET_RPC_PASSWORD=your_rpc_password
```

### 2. Start All Services

```bash
docker compose up -d
```

This starts:
- **monerod** — Monero daemon (syncs blockchain)
- **monero-wallet-rpc** — Wallet RPC for payouts
- **redis** — Share tracking and job caching
- **postgres** — Persistent storage for miners, shares, blocks, payouts
- **pool** — The mining pool server (Stratum + API + Dashboard)

### 3. Wait for Blockchain Sync

The Monero daemon needs to sync the full blockchain before the pool can operate. Monitor progress:

```bash
docker logs -f monerod
```

### 4. Create/Open Pool Wallet

Connect to the wallet RPC and create or open a wallet:

```bash
curl -u rpc_user:your_rpc_password -X POST http://localhost:18082/json_rpc \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc": "2.0",
    "id": "0",
    "method": "create_wallet",
    "params": {
      "filename": "pool_wallet",
      "password": "wallet_password",
      "language": "English"
    }
  }'
```

Or to open an existing wallet:

```bash
curl -u rpc_user:your_rpc_password -X POST http://localhost:18082/json_rpc \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc": "2.0",
    "id": "0",
    "method": "open_wallet",
    "params": {
      "filename": "pool_wallet",
      "password": "wallet_password"
    }
  }'
```

### 5. Connect Miners

Point your miner at the pool:

```bash
# XMRig
./xmrig -o YOUR_SERVER_IP:3333 -u YOUR_WALLET_ADDRESS -p x -a rx/0

# Or in xmrig config.json:
{
  "pools": [{
    "url": "YOUR_SERVER_IP:3333",
    "user": "YOUR_WALLET_ADDRESS",
    "pass": "x",
    "algo": "rx/0"
  }]
}
```

### 6. View Dashboard

Open `http://YOUR_SERVER_IP:8080` in your browser.

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/stats` | Pool stats, recent blocks, recent payouts |
| `GET /api/miner/:address` | Per-miner stats, shares, payouts |
| `GET /api/miners` | All miners list with hashrates |
| `GET /api/blocks` | Recent blocks found |
| `GET /api/payouts` | Recent payouts |
| `GET /api/health` | Health check |

## Configuration

Edit `config.json` for detailed settings:

| Setting | Description | Default |
|---------|-------------|---------|
| `pool.fee` | Pool fee (0.001 = 0.1%) | `0.001` |
| `pool.pplnsWindow` | PPLNS window size (shares) | `8640` |
| `pool.blockConfirmations` | Confirmations before payout | `10` |
| `pool.payoutInterval` | Payout check interval (ms) | `60000` |
| `vardiff.minDiff` | Minimum difficulty | `1000` |
| `vardiff.maxDiff` | Maximum difficulty | `1000000` |
| `vardiff.targetTime` | Target seconds between shares | `30` |
| `vardiff.retargetTime` | Retarget interval (seconds) | `90` |
| `stratum.port` | Stratum TCP port | `3333` |
| `api.port` | Web/API HTTP port | `8080` |

## Development

### Run Without Docker

```bash
# Start Redis and PostgreSQL locally
# Then:
npm install
cp .env.example .env
# Edit .env with local connection details
npm run migrate
npm start
```

### Run Migrations Only

```bash
npm run migrate
```

### Lint

```bash
npm run lint
```

## Reward System (PPLNS)

The pool uses **Pay Per Last N Shares** (PPLNS):

1. When a block is found, the pool looks at the last N shares (default: 8640)
2. Each miner's share of the reward is proportional to their contributed difficulty
3. The 0.1% pool fee is deducted before distribution
4. Rewards are credited to pending balances immediately upon block confirmation
5. All pending balances are paid out automatically (no minimum threshold)

## Payout System

- Payouts are processed every 60 seconds (configurable)
- **No minimum payout** — any positive balance is paid
- Failed payouts are retried up to 5 times
- All payouts are logged to the database with TX hashes
- Uses Monero wallet RPC `transfer` method

## Security Notes

- Change all default passwords in `.env`
- The Monero daemon RPC is restricted by default
- Wallet RPC requires authentication
- Consider adding a reverse proxy (nginx) with rate limiting for the API
- Firewall: only expose ports 3333 (stratum) and 8080 (web) publicly

## Monitoring

View logs:

```bash
# All services
docker compose logs -f

# Pool only
docker compose logs -f pool

# Daemon
docker compose logs -f monerod
```

## License

MIT
