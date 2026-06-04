'use strict';

const axios = require('axios');
const config = require('../config');
const logger = require('../logger');

class WalletRPC {
  constructor() {
    this.url = `http://${config.wallet.host}:${config.wallet.port}`;
    this.auth = config.wallet.user ? {
      username: config.wallet.user,
      password: config.wallet.password
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
        timeout: 30000
      });

      if (response.data.error) {
        throw new Error(response.data.error.message);
      }

      return response.data.result;
    } catch (err) {
      logger.error(`Wallet RPC error: ${method}`, { error: err.message });
      throw err;
    }
  }

  async getBalance() {
    return this.call('get_balance');
  }

  async getAddress() {
    return this.call('get_address');
  }

  async transfer(destinations) {
    return this.call('transfer', {
      destinations,
      priority: 0,
      ring_size: 16,
      get_tx_key: true
    });
  }

  async transferSplit(destinations) {
    return this.call('transfer_split', {
      destinations,
      priority: 0,
      ring_size: 16,
      get_tx_keys: true
    });
  }

  async getTransfers(options = {}) {
    return this.call('get_transfers', {
      in: true,
      out: true,
      pending: true,
      ...options
    });
  }

  async getHeight() {
    return this.call('get_height');
  }
}

module.exports = new WalletRPC();
