'use strict';

const axios = require('axios');
const config = require('../config');
const logger = require('../logger');

class DaemonRPC {
  constructor() {
    this.url = `http://${config.daemon.host}:${config.daemon.port}`;
    this.auth = config.daemon.user ? {
      username: config.daemon.user,
      password: config.daemon.password
    } : undefined;
  }

  async call(method, params = {}) {
    try {
      const response = await axios.post(`${this.url}/json_rpc`, {
        jsonrpc: '2.0',
        id: '0',
        method,
        params
      }, {
        auth: this.auth,
        timeout: 10000
      });

      if (response.data.error) {
        throw new Error(response.data.error.message);
      }

      return response.data.result;
    } catch (err) {
      logger.error(`Daemon RPC error: ${method}`, { error: err.message });
      throw err;
    }
  }

  async callBin(endpoint, params = {}) {
    try {
      const response = await axios.post(`${this.url}/${endpoint}`, params, {
        auth: this.auth,
        timeout: 10000
      });
      return response.data;
    } catch (err) {
      logger.error(`Daemon binary RPC error: ${endpoint}`, { error: err.message });
      throw err;
    }
  }

  async getBlockTemplate(walletAddress, reserveSize = 8) {
    return this.call('get_block_template', {
      wallet_address: walletAddress,
      reserve_size: reserveSize
    });
  }

  async submitBlock(blockBlob) {
    return this.call('submit_block', [blockBlob]);
  }

  async getBlockCount() {
    return this.call('get_block_count');
  }

  async getBlockHeaderByHeight(height) {
    return this.call('get_block_header_by_height', { height });
  }

  async getLastBlockHeader() {
    return this.call('get_last_block_header');
  }

  async getInfo() {
    return this.call('get_info');
  }

  async getBlockHeaderByHash(hash) {
    return this.call('get_block_header_by_hash', { hash });
  }
}

module.exports = new DaemonRPC();
