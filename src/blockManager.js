'use strict';

const config = require('./config');
const logger = require('./logger');
const daemon = require('./rpc/daemon');
const cache = require('./redis');
const db = require('./db');

class BlockManager {
  constructor() {
    this.currentTemplate = null;
    this.pollInterval = null;
    this.confirmInterval = null;
    this.onNewBlock = null; // callback for stratum broadcast
  }

  start() {
    // Poll for new block templates
    this.pollInterval = setInterval(
      () => this.pollBlockTemplate(),
      config.blockPollingInterval
    );

    // Check block confirmations every 30 seconds
    this.confirmInterval = setInterval(
      () => this.checkConfirmations(),
      30000
    );

    // Initial poll
    this.pollBlockTemplate();
    logger.info('Block manager started');
  }

  async pollBlockTemplate() {
    try {
      const template = await daemon.getBlockTemplate(config.pool.address);

      if (!this.currentTemplate || template.height !== this.currentTemplate.height) {
        logger.info('New block template', {
          height: template.height,
          difficulty: template.difficulty
        });

        this.currentTemplate = template;
        await cache.setCurrentJob(template);
        await cache.setCurrentHeight(template.height);

        // Notify stratum to broadcast new job
        if (this.onNewBlock) {
          await this.onNewBlock();
        }
      }
    } catch (err) {
      logger.error('Failed to poll block template', { error: err.message });
    }
  }

  async submitBlock(job, nonce, finderAddress) {
    try {
      // Insert nonce into block template blob
      const blockBlob = this.insertNonce(job.blocktemplate_blob, nonce);

      // Submit to daemon
      await daemon.submitBlock(blockBlob);

      // Get block info
      const blockHeader = await daemon.getBlockHeaderByHeight(job.height);
      const blockHash = blockHeader.block_header.hash;
      const reward = blockHeader.block_header.reward;

      // Record in database
      await db.insertBlock(
        job.height,
        blockHash,
        job.difficulty,
        reward,
        finderAddress
      );

      logger.info('Block submitted successfully', {
        height: job.height,
        hash: blockHash,
        reward: reward / 1e12 + ' XMR',
        finder: finderAddress.substring(0, 16) + '...'
      });
    } catch (err) {
      logger.error('Failed to submit block', {
        height: job.height,
        error: err.message
      });
    }
  }

  insertNonce(blobHex, nonce) {
    // Nonce is at byte offset 39 in the block blob (positions 78-85 in hex)
    const nonceOffset = 78;
    return blobHex.substring(0, nonceOffset) +
      nonce +
      blobHex.substring(nonceOffset + 8);
  }

  async checkConfirmations() {
    try {
      const pendingBlocks = await db.getPendingBlocks();
      if (pendingBlocks.length === 0) return;

      const currentHeight = await cache.getCurrentHeight();
      if (!currentHeight) return;

      for (const block of pendingBlocks) {
        const confirmations = currentHeight - block.height;

        if (confirmations < 0) {
          // Block might have been orphaned (reorg)
          await db.updateBlockStatus(block.id, 'orphaned', 0);
          logger.warn('Block orphaned', { height: block.height });
          continue;
        }

        // Verify block still exists on chain
        try {
          const header = await daemon.getBlockHeaderByHeight(block.height);
          if (header.block_header.hash !== block.hash) {
            await db.updateBlockStatus(block.id, 'orphaned', 0);
            logger.warn('Block orphaned (hash mismatch)', { height: block.height });
            continue;
          }
        } catch (err) {
          logger.error('Error checking block', { height: block.height, error: err.message });
          continue;
        }

        // Update confirmations
        if (confirmations >= config.pool.blockConfirmations) {
          await db.updateBlockStatus(block.id, 'confirmed', confirmations);
          logger.info('Block confirmed', {
            height: block.height,
            confirmations
          });

          // Distribute rewards
          await this.distributeReward(block);
        } else {
          await db.updateBlockStatus(block.id, 'pending', confirmations);
        }
      }
    } catch (err) {
      logger.error('Error checking confirmations', { error: err.message });
    }
  }

  async distributeReward(block) {
    try {
      const shares = await db.getSharesForPPLNS(config.pool.pplnsWindow);

      if (shares.length === 0) {
        logger.warn('No shares found for reward distribution', { height: block.height });
        return;
      }

      // Calculate total difficulty in PPLNS window
      const totalDiff = shares.reduce((sum, s) => sum + parseInt(s.total_diff, 10), 0);

      // Pool fee
      const fee = Math.floor(block.reward * config.pool.fee);
      const distributableReward = block.reward - fee;

      // Distribute proportionally
      for (const share of shares) {
        const minerDiff = parseInt(share.total_diff, 10);
        const minerReward = Math.floor((minerDiff / totalDiff) * distributableReward);

        if (minerReward > 0) {
          await db.addMinerBalance(share.miner_address, minerReward);
          logger.debug('Reward distributed', {
            miner: share.miner_address.substring(0, 16) + '...',
            amount: minerReward / 1e12 + ' XMR'
          });
        }
      }

      logger.info('Rewards distributed for block', {
        height: block.height,
        reward: block.reward / 1e12 + ' XMR',
        fee: fee / 1e12 + ' XMR',
        miners: shares.length
      });
    } catch (err) {
      logger.error('Error distributing reward', {
        height: block.height,
        error: err.message
      });
    }
  }

  stop() {
    if (this.pollInterval) clearInterval(this.pollInterval);
    if (this.confirmInterval) clearInterval(this.confirmInterval);
  }
}

module.exports = BlockManager;
