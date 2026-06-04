'use strict';

const logger = require('../logger');

class ShareValidator {
  /**
   * Validate a submitted share from a miner.
   * In production, this would verify the RandomX hash against the blob+nonce.
   * Here we validate the result hash meets the share difficulty target
   * and check if it also meets the block difficulty (block found).
   */
  validate({ nonce, result, jobTarget: _jobTarget, difficulty, blockDifficulty }) {
    // Validate nonce format (8 hex chars)
    if (!/^[0-9a-fA-F]{8}$/.test(nonce)) {
      return { valid: false, reason: 'Invalid nonce format' };
    }

    // Validate result hash format (64 hex chars = 32 bytes)
    if (!/^[0-9a-fA-F]{64}$/.test(result)) {
      return { valid: false, reason: 'Invalid result hash format' };
    }

    // Convert result hash to difficulty
    const hashDifficulty = this.hashToDifficulty(result);

    // Check if share meets miner's assigned difficulty
    if (hashDifficulty < difficulty) {
      return { valid: false, reason: 'Share difficulty too low' };
    }

    // Check if share meets block difficulty (block found!)
    const isBlock = hashDifficulty >= blockDifficulty;

    if (isBlock) {
      logger.info('Share meets block difficulty!', {
        hashDiff: hashDifficulty,
        blockDiff: blockDifficulty
      });
    }

    return { valid: true, isBlock };
  }

  /**
   * Convert a 64-char hex hash to its equivalent difficulty.
   * Difficulty = 2^256 / hash_as_number
   * For practical purposes, we use the first 8 bytes (most significant)
   * in little-endian as Monero uses.
   */
  hashToDifficulty(hashHex) {
    // Monero uses little-endian byte order for difficulty calculation
    // We reverse the hash bytes and compute difficulty from the leading bytes
    const bytes = Buffer.from(hashHex, 'hex');

    // Read the last 4 bytes as little-endian uint32 (least significant part of hash)
    // For target comparison in Monero stratum:
    // difficulty = 0xFFFFFFFF / (first 4 bytes of hash as little-endian uint32)
    const hashVal = bytes.readUInt32LE(0);

    if (hashVal === 0) {
      return Number.MAX_SAFE_INTEGER; // Hash starts with zeros = very high difficulty
    }

    return Math.floor(0xFFFFFFFF / hashVal);
  }
}

module.exports = ShareValidator;
