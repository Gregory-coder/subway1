'use strict';

const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Override with environment variables if present
if (process.env.POOL_WALLET_ADDRESS) config.pool.address = process.env.POOL_WALLET_ADDRESS;
if (process.env.STRATUM_PORT) config.stratum.port = parseInt(process.env.STRATUM_PORT, 10);
if (process.env.API_PORT) config.api.port = parseInt(process.env.API_PORT, 10);
if (process.env.DAEMON_RPC_HOST) config.daemon.host = process.env.DAEMON_RPC_HOST;
if (process.env.DAEMON_RPC_PORT) config.daemon.port = parseInt(process.env.DAEMON_RPC_PORT, 10);
if (process.env.DAEMON_RPC_USER) config.daemon.user = process.env.DAEMON_RPC_USER;
if (process.env.DAEMON_RPC_PASSWORD) config.daemon.password = process.env.DAEMON_RPC_PASSWORD;
if (process.env.WALLET_RPC_HOST) config.wallet.host = process.env.WALLET_RPC_HOST;
if (process.env.WALLET_RPC_PORT) config.wallet.port = parseInt(process.env.WALLET_RPC_PORT, 10);
if (process.env.WALLET_RPC_USER) config.wallet.user = process.env.WALLET_RPC_USER;
if (process.env.WALLET_RPC_PASSWORD) config.wallet.password = process.env.WALLET_RPC_PASSWORD;
if (process.env.REDIS_HOST) config.redis.host = process.env.REDIS_HOST;
if (process.env.REDIS_PORT) config.redis.port = parseInt(process.env.REDIS_PORT, 10);
if (process.env.POSTGRES_HOST) config.database.host = process.env.POSTGRES_HOST;
if (process.env.POSTGRES_PORT) config.database.port = parseInt(process.env.POSTGRES_PORT, 10);
if (process.env.POSTGRES_DB) config.database.database = process.env.POSTGRES_DB;
if (process.env.POSTGRES_USER) config.database.user = process.env.POSTGRES_USER;
if (process.env.POSTGRES_PASSWORD) config.database.password = process.env.POSTGRES_PASSWORD;

module.exports = config;
