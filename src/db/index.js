'use strict';

const { Pool } = require('pg');
const config = require('../config');
const logger = require('../logger');

const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.database,
  user: config.database.user,
  password: config.database.password,
  max: 20
});

pool.on('error', (err) => {
  logger.error('Unexpected PostgreSQL error', { error: err.message });
});

const db = {
  query: (text, params) => pool.query(text, params),

  // Miner operations
  async getOrCreateMiner(address) {
    const result = await pool.query(
      `INSERT INTO miners (address) VALUES ($1)
       ON CONFLICT (address) DO UPDATE SET address = EXCLUDED.address
       RETURNING *`,
      [address]
    );
    return result.rows[0];
  },

  async getMiner(address) {
    const result = await pool.query('SELECT * FROM miners WHERE address = $1', [address]);
    return result.rows[0] || null;
  },

  async updateMinerStats(address, hashes) {
    await pool.query(
      'UPDATE miners SET total_hashes = total_hashes + $2, last_share_at = NOW() WHERE address = $1',
      [address, hashes]
    );
  },

  async addMinerBalance(address, amount) {
    await pool.query(
      'UPDATE miners SET pending_balance = pending_balance + $2 WHERE address = $1',
      [address, amount]
    );
  },

  async deductMinerBalance(address, amount) {
    await pool.query(
      'UPDATE miners SET pending_balance = pending_balance - $2, paid_balance = paid_balance + $2 WHERE address = $1',
      [address, amount]
    );
  },

  async getMinersWithBalance() {
    const result = await pool.query('SELECT * FROM miners WHERE pending_balance > 0');
    return result.rows;
  },

  async getAllMiners() {
    const result = await pool.query('SELECT * FROM miners ORDER BY total_hashes DESC');
    return result.rows;
  },

  // Share operations
  async insertShare(minerAddress, difficulty, shareDiff, blockHeight, isBlock) {
    await pool.query(
      `INSERT INTO shares (miner_address, difficulty, share_diff, block_height, is_block)
       VALUES ($1, $2, $3, $4, $5)`,
      [minerAddress, difficulty, shareDiff, blockHeight, isBlock]
    );
  },

  async getSharesForPPLNS(windowSize) {
    const result = await pool.query(
      `SELECT miner_address, SUM(difficulty) as total_diff
       FROM (SELECT * FROM shares ORDER BY id DESC LIMIT $1) sub
       GROUP BY miner_address`,
      [windowSize]
    );
    return result.rows;
  },

  async getSharesForRound(blockHeight) {
    const result = await pool.query(
      `SELECT miner_address, SUM(difficulty) as total_diff
       FROM shares WHERE block_height <= $1
       AND id > COALESCE(
         (SELECT MAX(s.id) FROM shares s
          JOIN blocks b ON s.block_height <= b.height
          WHERE b.height < $1 AND b.status != 'orphaned' AND s.is_block = TRUE),
         0
       )
       GROUP BY miner_address`,
      [blockHeight]
    );
    return result.rows;
  },

  async getMinerShares(address, limit = 100) {
    const result = await pool.query(
      'SELECT * FROM shares WHERE miner_address = $1 ORDER BY id DESC LIMIT $2',
      [address, limit]
    );
    return result.rows;
  },

  // Block operations
  async insertBlock(height, hash, difficulty, reward, finderAddress) {
    const result = await pool.query(
      `INSERT INTO blocks (height, hash, difficulty, reward, finder_address)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [height, hash, difficulty, reward, finderAddress]
    );
    return result.rows[0];
  },

  async getPendingBlocks() {
    const result = await pool.query(
      'SELECT * FROM blocks WHERE status = \'pending\' ORDER BY height ASC'
    );
    return result.rows;
  },

  async updateBlockStatus(id, status, confirmations) {
    const unlocked = status === 'confirmed' ? ', unlocked_at = NOW()' : '';
    await pool.query(
      `UPDATE blocks SET status = $2, confirmations = $3${unlocked} WHERE id = $1`,
      [id, status, confirmations]
    );
  },

  async getRecentBlocks(limit = 20) {
    const result = await pool.query(
      'SELECT * FROM blocks ORDER BY height DESC LIMIT $1',
      [limit]
    );
    return result.rows;
  },

  // Payout operations
  async insertPayout(minerAddress, amount) {
    const result = await pool.query(
      'INSERT INTO payouts (miner_address, amount) VALUES ($1, $2) RETURNING *',
      [minerAddress, amount]
    );
    return result.rows[0];
  },

  async updatePayout(id, txHash, status, errorMessage) {
    await pool.query(
      `UPDATE payouts SET tx_hash = $2, status = $3, error_message = $4,
       completed_at = CASE WHEN $3 = 'completed' THEN NOW() ELSE completed_at END,
       retry_count = CASE WHEN $3 = 'failed' THEN retry_count + 1 ELSE retry_count END
       WHERE id = $1`,
      [id, txHash, status, errorMessage]
    );
  },

  async getFailedPayouts() {
    const result = await pool.query(
      'SELECT * FROM payouts WHERE status = \'failed\' AND retry_count < 5'
    );
    return result.rows;
  },

  async getRecentPayouts(limit = 20) {
    const result = await pool.query(
      'SELECT * FROM payouts ORDER BY created_at DESC LIMIT $1',
      [limit]
    );
    return result.rows;
  },

  async getMinerPayouts(address, limit = 50) {
    const result = await pool.query(
      'SELECT * FROM payouts WHERE miner_address = $1 ORDER BY created_at DESC LIMIT $2',
      [address, limit]
    );
    return result.rows;
  },

  async close() {
    await pool.end();
  }
};

module.exports = db;
