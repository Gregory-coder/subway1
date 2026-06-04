'use strict';

const config = require('./config');
const logger = require('./logger');
const walletRpc = require('./rpc/wallet');
const db = require('./db');

class PayoutManager {
  constructor() {
    this.payoutInterval = null;
    this.retryInterval = null;
    this.processing = false;
  }

  start() {
    // Process payouts periodically
    this.payoutInterval = setInterval(
      () => this.processPayouts(),
      config.pool.payoutInterval
    );

    // Retry failed payouts every 5 minutes
    this.retryInterval = setInterval(
      () => this.retryFailedPayouts(),
      300000
    );

    logger.info('Payout manager started', {
      interval: config.pool.payoutInterval + 'ms'
    });
  }

  async processPayouts() {
    if (this.processing) return;
    this.processing = true;

    try {
      // Get all miners with positive balance (no minimum threshold)
      const miners = await db.getMinersWithBalance();

      if (miners.length === 0) {
        this.processing = false;
        return;
      }

      logger.info(`Processing payouts for ${miners.length} miners`);

      for (const miner of miners) {
        await this.payMiner(miner);
      }
    } catch (err) {
      logger.error('Error processing payouts', { error: err.message });
    } finally {
      this.processing = false;
    }
  }

  async payMiner(miner) {
    const amount = parseInt(miner.pending_balance, 10);
    if (amount <= 0) return;

    // Create payout record
    const payout = await db.insertPayout(miner.address, amount);

    try {
      // Send via wallet RPC
      const result = await walletRpc.transfer([{
        address: miner.address,
        amount: amount
      }]);

      if (result && result.tx_hash) {
        // Success
        await db.updatePayout(payout.id, result.tx_hash, 'completed', null);
        await db.deductMinerBalance(miner.address, amount);

        logger.info('Payout sent', {
          miner: miner.address.substring(0, 16) + '...',
          amount: amount / 1e12 + ' XMR',
          txHash: result.tx_hash
        });
      } else {
        throw new Error('No tx_hash in wallet response');
      }
    } catch (err) {
      logger.error('Payout failed', {
        miner: miner.address.substring(0, 16) + '...',
        amount: amount / 1e12 + ' XMR',
        error: err.message
      });

      await db.updatePayout(payout.id, null, 'failed', err.message);
    }
  }

  async retryFailedPayouts() {
    try {
      const failedPayouts = await db.getFailedPayouts();

      if (failedPayouts.length === 0) return;

      logger.info(`Retrying ${failedPayouts.length} failed payouts`);

      for (const payout of failedPayouts) {
        try {
          const result = await walletRpc.transfer([{
            address: payout.miner_address,
            amount: parseInt(payout.amount, 10)
          }]);

          if (result && result.tx_hash) {
            await db.updatePayout(payout.id, result.tx_hash, 'completed', null);
            await db.deductMinerBalance(payout.miner_address, parseInt(payout.amount, 10));

            logger.info('Retry payout succeeded', {
              miner: payout.miner_address.substring(0, 16) + '...',
              txHash: result.tx_hash
            });
          }
        } catch (err) {
          await db.updatePayout(payout.id, null, 'failed', err.message);
          logger.error('Retry payout failed', {
            payoutId: payout.id,
            error: err.message
          });
        }
      }
    } catch (err) {
      logger.error('Error retrying payouts', { error: err.message });
    }
  }

  stop() {
    if (this.payoutInterval) clearInterval(this.payoutInterval);
    if (this.retryInterval) clearInterval(this.retryInterval);
  }
}

module.exports = PayoutManager;
