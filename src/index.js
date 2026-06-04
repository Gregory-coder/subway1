'use strict';

require('dotenv').config();

const logger = require('./logger');
const config = require('./config');
const db = require('./db');
const cache = require('./redis');
const BlockManager = require('./blockManager');
const StratumServer = require('./stratum');
const PayoutManager = require('./payoutManager');
const ApiServer = require('./api');

async function main() {
  logger.info('Starting XMR Mining Pool...');
  logger.info(`Pool address: ${config.pool.address.substring(0, 16)}...`);
  logger.info(`Pool fee: ${config.pool.fee * 100}%`);
  logger.info(`PPLNS window: ${config.pool.pplnsWindow} shares`);

  // Run migrations
  try {
    const { Pool } = require('pg');
    const pgPool = new Pool({
      host: config.database.host,
      port: config.database.port,
      database: config.database.database,
      user: config.database.user,
      password: config.database.password
    });

    const schema = `
      CREATE TABLE IF NOT EXISTS miners (
        id SERIAL PRIMARY KEY,
        address VARCHAR(128) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        total_hashes BIGINT DEFAULT 0,
        pending_balance BIGINT DEFAULT 0,
        paid_balance BIGINT DEFAULT 0,
        last_share_at TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS shares (
        id BIGSERIAL PRIMARY KEY,
        miner_address VARCHAR(128) NOT NULL,
        difficulty BIGINT NOT NULL,
        share_diff BIGINT NOT NULL,
        block_height BIGINT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        is_block BOOLEAN DEFAULT FALSE
      );
      CREATE INDEX IF NOT EXISTS idx_shares_miner ON shares(miner_address);
      CREATE INDEX IF NOT EXISTS idx_shares_height ON shares(block_height);
      CREATE INDEX IF NOT EXISTS idx_shares_created ON shares(created_at);
      CREATE TABLE IF NOT EXISTS blocks (
        id SERIAL PRIMARY KEY,
        height BIGINT NOT NULL,
        hash VARCHAR(128) NOT NULL,
        difficulty BIGINT NOT NULL,
        reward BIGINT NOT NULL,
        finder_address VARCHAR(128) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        confirmations INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        unlocked_at TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_blocks_status ON blocks(status);
      CREATE TABLE IF NOT EXISTS payouts (
        id SERIAL PRIMARY KEY,
        miner_address VARCHAR(128) NOT NULL,
        amount BIGINT NOT NULL,
        tx_hash VARCHAR(128),
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW(),
        completed_at TIMESTAMP,
        retry_count INT DEFAULT 0,
        error_message TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_payouts_miner ON payouts(miner_address);
      CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts(status);
    `;

    await pgPool.query(schema);
    await pgPool.end();
    logger.info('Database schema ready');
  } catch (err) {
    logger.error('Database migration failed - will retry on next start', { error: err.message });
  }

  // Initialize block manager
  const blockManager = new BlockManager();

  // Initialize stratum server
  const stratumServer = new StratumServer(blockManager);

  // Wire up block manager to broadcast new jobs
  blockManager.onNewBlock = () => stratumServer.broadcastNewJob();

  // Initialize payout manager
  const payoutManager = new PayoutManager();

  // Initialize API server
  const apiServer = new ApiServer(stratumServer);

  // Start all components
  blockManager.start();
  stratumServer.start();
  payoutManager.start();
  apiServer.start();

  logger.info('XMR Mining Pool fully started');

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    stratumServer.stop();
    blockManager.stop();
    payoutManager.stop();
    await cache.close();
    await db.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error('Fatal error', { error: err.message, stack: err.stack });
  process.exit(1);
});
