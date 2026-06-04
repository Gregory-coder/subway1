'use strict';

const express = require('express');
const cors = require('cors');
const config = require('../config');
const logger = require('../logger');
const db = require('../db');
const cache = require('../redis');

class ApiServer {
  constructor(stratumServer) {
    this.app = express();
    this.stratumServer = stratumServer;
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.static('public'));
  }

  setupRoutes() {
    // Pool stats
    this.app.get('/api/stats', async (req, res) => {
      try {
        const [poolHashrate, minersOnline, recentBlocks, recentPayouts] = await Promise.all([
          cache.getPoolHashrate(),
          cache.getMinersOnline(),
          db.getRecentBlocks(10),
          db.getRecentPayouts(10)
        ]);

        const currentHeight = await cache.getCurrentHeight();

        res.json({
          pool: {
            hashrate: poolHashrate,
            miners_online: minersOnline,
            current_height: currentHeight,
            fee: config.pool.fee * 100 + '%',
            pplns_window: config.pool.pplnsWindow,
            min_payout: 0
          },
          blocks: recentBlocks.map(b => ({
            height: b.height,
            hash: b.hash,
            reward: b.reward,
            status: b.status,
            confirmations: b.confirmations,
            finder: b.finder_address,
            found_at: b.created_at
          })),
          payouts: recentPayouts.map(p => ({
            miner: p.miner_address,
            amount: p.amount,
            tx_hash: p.tx_hash,
            status: p.status,
            created_at: p.created_at
          }))
        });
      } catch (err) {
        logger.error('API /stats error', { error: err.message });
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Miner stats
    this.app.get('/api/miner/:address', async (req, res) => {
      try {
        const { address } = req.params;
        const miner = await db.getMiner(address);

        if (!miner) {
          return res.status(404).json({ error: 'Miner not found' });
        }

        const [hashrate, shares, payouts] = await Promise.all([
          cache.getMinerHashrate(address),
          db.getMinerShares(address, 50),
          db.getMinerPayouts(address, 20)
        ]);

        res.json({
          address: miner.address,
          hashrate,
          total_hashes: miner.total_hashes,
          pending_balance: miner.pending_balance,
          paid_balance: miner.paid_balance,
          last_share_at: miner.last_share_at,
          created_at: miner.created_at,
          shares: shares.map(s => ({
            difficulty: s.difficulty,
            height: s.block_height,
            is_block: s.is_block,
            created_at: s.created_at
          })),
          payouts: payouts.map(p => ({
            amount: p.amount,
            tx_hash: p.tx_hash,
            status: p.status,
            created_at: p.created_at
          }))
        });
      } catch (err) {
        logger.error('API /miner error', { error: err.message });
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // All miners
    this.app.get('/api/miners', async (req, res) => {
      try {
        const miners = await db.getAllMiners();
        const result = [];

        for (const miner of miners) {
          const hashrate = await cache.getMinerHashrate(miner.address);
          result.push({
            address: miner.address,
            hashrate,
            total_hashes: miner.total_hashes,
            pending_balance: miner.pending_balance,
            paid_balance: miner.paid_balance,
            last_share_at: miner.last_share_at
          });
        }

        res.json({ miners: result });
      } catch (err) {
        logger.error('API /miners error', { error: err.message });
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Blocks
    this.app.get('/api/blocks', async (req, res) => {
      try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const blocks = await db.getRecentBlocks(limit);
        res.json({ blocks });
      } catch (err) {
        logger.error('API /blocks error', { error: err.message });
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Payouts
    this.app.get('/api/payouts', async (req, res) => {
      try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const payouts = await db.getRecentPayouts(limit);
        res.json({ payouts });
      } catch (err) {
        logger.error('API /payouts error', { error: err.message });
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Health check
    this.app.get('/api/health', (req, res) => {
      res.json({ status: 'ok', uptime: process.uptime() });
    });
  }

  start() {
    this.app.listen(config.api.port, config.api.host, () => {
      logger.info(`API server listening on ${config.api.host}:${config.api.port}`);
    });
  }
}

module.exports = ApiServer;
