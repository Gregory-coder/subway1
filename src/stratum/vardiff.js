'use strict';

const logger = require('../logger');

class VarDiff {
  constructor(options) {
    this.minDiff = options.minDiff || 1000;
    this.maxDiff = options.maxDiff || 1000000;
    this.targetTime = options.targetTime || 30; // seconds between shares
    this.retargetTime = options.retargetTime || 90; // seconds between adjustments
    this.variancePercent = options.variancePercent || 30;

    this.clientTimestamps = new Map();
  }

  /**
   * Adjust difficulty for a miner based on their share submission rate.
   * Returns new difficulty or null if no adjustment needed.
   */
  adjust(client) {
    const now = Date.now();
    const clientId = client.id;

    if (!this.clientTimestamps.has(clientId)) {
      this.clientTimestamps.set(clientId, {
        lastRetarget: now,
        shares: []
      });
      return null;
    }

    const state = this.clientTimestamps.get(clientId);
    state.shares.push(now);

    // Only retarget every retargetTime seconds
    const timeSinceRetarget = (now - state.lastRetarget) / 1000;
    if (timeSinceRetarget < this.retargetTime) {
      return null;
    }

    // Calculate average time between shares
    if (state.shares.length < 2) {
      state.lastRetarget = now;
      return null;
    }

    const intervals = [];
    for (let i = 1; i < state.shares.length; i++) {
      intervals.push((state.shares[i] - state.shares[i - 1]) / 1000);
    }

    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;

    // Reset state
    state.lastRetarget = now;
    state.shares = [now];

    // Calculate new difficulty
    const ratio = avgInterval / this.targetTime;
    let newDiff = Math.round(client.difficulty / ratio);

    // Apply variance tolerance - don't adjust if within variance
    const lowerBound = this.targetTime * (1 - this.variancePercent / 100);
    const upperBound = this.targetTime * (1 + this.variancePercent / 100);

    if (avgInterval >= lowerBound && avgInterval <= upperBound) {
      return null; // Within acceptable variance
    }

    // Clamp to min/max
    newDiff = Math.max(this.minDiff, Math.min(this.maxDiff, newDiff));

    // Don't adjust if change is less than 10%
    if (Math.abs(newDiff - client.difficulty) / client.difficulty < 0.1) {
      return null;
    }

    logger.debug('VarDiff adjustment', {
      clientId,
      oldDiff: client.difficulty,
      newDiff,
      avgInterval: avgInterval.toFixed(2),
      targetTime: this.targetTime
    });

    return newDiff;
  }

  removeClient(clientId) {
    this.clientTimestamps.delete(clientId);
  }
}

module.exports = VarDiff;
