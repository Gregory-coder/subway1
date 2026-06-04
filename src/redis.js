'use strict';

const Redis = require('ioredis');
const config = require('./config');
const logger = require('./logger');

const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  retryStrategy: (times) => Math.min(times * 100, 3000)
});

redis.on('error', (err) => {
  logger.error('Redis connection error', { error: err.message });
});

redis.on('connect', () => {
  logger.info('Connected to Redis');
});

const cache = {
  // Current job template
  async setCurrentJob(job) {
    await redis.set('pool:current_job', JSON.stringify(job));
  },

  async getCurrentJob() {
    const data = await redis.get('pool:current_job');
    return data ? JSON.parse(data) : null;
  },

  // Job by ID for share validation
  async setJob(jobId, job) {
    await redis.set(`pool:job:${jobId}`, JSON.stringify(job), 'EX', 300);
  },

  async getJob(jobId) {
    const data = await redis.get(`pool:job:${jobId}`);
    return data ? JSON.parse(data) : null;
  },

  // Miner hashrate tracking (sliding window)
  async recordShare(minerAddress, difficulty) {
    const now = Date.now();
    const key = `pool:hashrate:${minerAddress}`;
    await redis.zadd(key, now, `${now}:${difficulty}`);
    // Remove entries older than 10 minutes
    await redis.zremrangebyscore(key, 0, now - 600000);
  },

  async getMinerHashrate(minerAddress) {
    const now = Date.now();
    const key = `pool:hashrate:${minerAddress}`;
    const entries = await redis.zrangebyscore(key, now - 600000, now);
    if (entries.length === 0) return 0;
    let totalDiff = 0;
    for (const entry of entries) {
      const diff = parseInt(entry.split(':')[1], 10);
      totalDiff += diff;
    }
    return totalDiff / 600; // hashes per second over 10 min window
  },

  // Pool hashrate (all miners combined)
  async recordPoolShare(difficulty) {
    const now = Date.now();
    await redis.zadd('pool:hashrate:total', now, `${now}:${difficulty}`);
    await redis.zremrangebyscore('pool:hashrate:total', 0, now - 600000);
  },

  async getPoolHashrate() {
    const now = Date.now();
    const entries = await redis.zrangebyscore('pool:hashrate:total', now - 600000, now);
    if (entries.length === 0) return 0;
    let totalDiff = 0;
    for (const entry of entries) {
      const diff = parseInt(entry.split(':')[1], 10);
      totalDiff += diff;
    }
    return totalDiff / 600;
  },

  // Connected miners count
  async setMinersOnline(count) {
    await redis.set('pool:miners_online', count);
  },

  async getMinersOnline() {
    const val = await redis.get('pool:miners_online');
    return parseInt(val || '0', 10);
  },

  // Block height tracking
  async setCurrentHeight(height) {
    await redis.set('pool:current_height', height);
  },

  async getCurrentHeight() {
    const val = await redis.get('pool:current_height');
    return parseInt(val || '0', 10);
  },

  async close() {
    await redis.quit();
  }
};

module.exports = cache;
