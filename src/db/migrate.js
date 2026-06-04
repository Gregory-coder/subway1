'use strict';

require('dotenv').config();
const { Pool } = require('pg');
const config = require('../config');
const logger = require('../logger');

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

async function migrate() {
  const pool = new Pool({
    host: config.database.host,
    port: config.database.port,
    database: config.database.database,
    user: config.database.user,
    password: config.database.password
  });

  try {
    await pool.query(schema);
    logger.info('Database migration completed successfully');
  } catch (err) {
    logger.error('Migration failed', { error: err.message });
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
