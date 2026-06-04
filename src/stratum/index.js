'use strict';

const net = require('net');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const logger = require('../logger');
const cache = require('../redis');
const db = require('../db');
const ShareValidator = require('./shareValidator');
const VarDiff = require('./vardiff');

class StratumServer {
  constructor(blockManager) {
    this.blockManager = blockManager;
    this.server = null;
    this.clients = new Map();
    this.extranonceCounter = 0;
    this.shareValidator = new ShareValidator();
    this.vardiff = new VarDiff(config.vardiff);
  }

  start() {
    this.server = net.createServer((socket) => this.onConnection(socket));

    this.server.listen(config.stratum.port, config.stratum.host, () => {
      logger.info(`Stratum server listening on ${config.stratum.host}:${config.stratum.port}`);
    });

    this.server.on('error', (err) => {
      logger.error('Stratum server error', { error: err.message });
    });

    // Update online miners count every 10 seconds
    setInterval(() => {
      cache.setMinersOnline(this.clients.size);
    }, 10000);
  }

  onConnection(socket) {
    const clientId = uuidv4();
    const extranonce = this.getNextExtranonce();

    const client = {
      id: clientId,
      socket,
      address: null,
      extranonce,
      difficulty: config.vardiff.minDiff,
      lastShareTime: null,
      sharesCount: 0,
      buffer: '',
      workerName: null,
      subscribed: false,
      authorized: false
    };

    this.clients.set(clientId, client);
    logger.info('New miner connected', { clientId, ip: socket.remoteAddress });

    socket.setEncoding('utf8');
    socket.setKeepAlive(true, 30000);

    socket.on('data', (data) => this.onData(client, data));
    socket.on('error', (err) => this.onClientError(client, err));
    socket.on('close', () => this.onClientClose(client));
  }

  onData(client, data) {
    client.buffer += data;

    const lines = client.buffer.split('\n');
    client.buffer = lines.pop(); // Keep incomplete line in buffer

    for (const line of lines) {
      if (line.trim()) {
        try {
          const message = JSON.parse(line);
          this.handleMessage(client, message);
        } catch (err) {
          logger.warn('Invalid JSON from miner', { clientId: client.id, data: line });
        }
      }
    }
  }

  handleMessage(client, message) {
    const { id, method, params } = message;

    switch (method) {
      case 'login':
        this.handleLogin(client, id, params);
        break;
      case 'submit':
        this.handleSubmit(client, id, params);
        break;
      case 'keepalived':
        this.sendReply(client, id, { status: 'KEEPALIVED' });
        break;
      case 'getjob':
        this.sendJob(client, id);
        break;
      default:
        logger.warn('Unknown method', { method, clientId: client.id });
        this.sendError(client, id, 'Unknown method');
    }
  }

  async handleLogin(client, id, params) {
    const login = params.login || params.agent;

    if (!login) {
      this.sendError(client, id, 'Missing login address');
      return;
    }

    // Extract wallet address (support address.worker format)
    const parts = login.split('.');
    const address = parts[0];
    const workerName = parts[1] || 'default';

    // Basic Monero address validation (95 chars for standard, 106 for integrated)
    if (address.length < 95 || (!address.startsWith('4') && !address.startsWith('8'))) {
      this.sendError(client, id, 'Invalid Monero address');
      return;
    }

    client.address = address;
    client.workerName = workerName;
    client.authorized = true;
    client.subscribed = true;

    // Ensure miner exists in DB
    await db.getOrCreateMiner(address);

    logger.info('Miner logged in', {
      clientId: client.id,
      address: address.substring(0, 16) + '...',
      worker: workerName
    });

    // Send login success with first job
    const job = await this.buildJob(client);
    this.sendReply(client, id, {
      id: client.id,
      job,
      extensions: ['algo'],
      status: 'OK'
    });
  }

  async handleSubmit(client, id, params) {
    if (!client.authorized) {
      this.sendError(client, id, 'Not authorized');
      return;
    }

    const { job_id, nonce, result } = params;

    if (!job_id || !nonce || !result) {
      this.sendError(client, id, 'Missing submit parameters');
      return;
    }

    // Get the job from cache
    const job = await cache.getJob(job_id);
    if (!job) {
      this.sendError(client, id, 'Job not found or expired');
      return;
    }

    // Validate the share
    const validation = this.shareValidator.validate({
      nonce,
      result,
      jobTarget: job.target,
      difficulty: client.difficulty,
      blockDifficulty: job.difficulty
    });

    if (!validation.valid) {
      logger.warn('Invalid share', {
        clientId: client.id,
        reason: validation.reason
      });
      this.sendError(client, id, validation.reason || 'Invalid share');
      return;
    }

    // Record the share
    const isBlock = validation.isBlock;
    await db.insertShare(client.address, client.difficulty, client.difficulty, job.height, isBlock);
    await db.updateMinerStats(client.address, client.difficulty);
    await cache.recordShare(client.address, client.difficulty);
    await cache.recordPoolShare(client.difficulty);

    client.sharesCount++;
    client.lastShareTime = Date.now();

    // Adjust difficulty
    const newDiff = this.vardiff.adjust(client);
    if (newDiff && newDiff !== client.difficulty) {
      client.difficulty = newDiff;
      logger.info('Difficulty adjusted', {
        clientId: client.id,
        newDiff
      });
    }

    // If block found, submit it
    if (isBlock) {
      logger.info('BLOCK FOUND!', {
        height: job.height,
        finder: client.address.substring(0, 16) + '...'
      });
      await this.blockManager.submitBlock(job, nonce, client.address);
    }

    this.sendReply(client, id, { status: 'OK' });
  }

  async buildJob(client) {
    const currentJob = await cache.getCurrentJob();
    if (!currentJob) {
      return null;
    }

    const jobId = uuidv4().replace(/-/g, '').substring(0, 16);

    const job = {
      blob: currentJob.blocktemplate_blob,
      job_id: jobId,
      target: this.difficultyToTarget(client.difficulty),
      height: currentJob.height,
      seed_hash: currentJob.seed_hash,
      algo: 'rx/0'
    };

    // Cache the job for share validation
    await cache.setJob(jobId, {
      ...job,
      difficulty: currentJob.difficulty,
      blocktemplate_blob: currentJob.blocktemplate_blob
    });

    return job;
  }

  async sendJob(client, id) {
    if (!client.authorized) return;

    const job = await this.buildJob(client);
    if (!job) return;

    if (id) {
      // Response to getjob request
      this.sendReply(client, id, job);
    } else {
      // Job notification (new block)
      this.sendNotification(client, 'job', job);
    }
  }

  async broadcastNewJob() {
    const promises = [];
    for (const [, client] of this.clients) {
      if (client.authorized) {
        promises.push(this.sendJob(client, null));
      }
    }
    await Promise.allSettled(promises);
    logger.info(`Broadcasted new job to ${promises.length} miners`);
  }

  sendReply(client, id, result) {
    const message = JSON.stringify({
      id,
      jsonrpc: '2.0',
      error: null,
      result
    }) + '\n';
    this.safeSend(client, message);
  }

  sendNotification(client, method, params) {
    const message = JSON.stringify({
      jsonrpc: '2.0',
      method,
      params
    }) + '\n';
    this.safeSend(client, message);
  }

  sendError(client, id, errorMessage) {
    const message = JSON.stringify({
      id,
      jsonrpc: '2.0',
      error: { code: -1, message: errorMessage },
      result: null
    }) + '\n';
    this.safeSend(client, message);
  }

  safeSend(client, data) {
    try {
      if (client.socket && !client.socket.destroyed) {
        client.socket.write(data);
      }
    } catch (err) {
      logger.error('Error sending to client', { clientId: client.id, error: err.message });
    }
  }

  onClientError(client, err) {
    logger.warn('Client socket error', { clientId: client.id, error: err.message });
    this.removeClient(client);
  }

  onClientClose(client) {
    logger.info('Miner disconnected', { clientId: client.id });
    this.removeClient(client);
  }

  removeClient(client) {
    this.clients.delete(client.id);
    try {
      if (client.socket && !client.socket.destroyed) {
        client.socket.destroy();
      }
    } catch (err) {
      // ignore
    }
  }

  getNextExtranonce() {
    this.extranonceCounter++;
    return this.extranonceCounter.toString(16).padStart(8, '0');
  }

  difficultyToTarget(difficulty) {
    // Convert difficulty to stratum target hex string
    // Target = 2^256 / difficulty, represented as 8 hex chars (little-endian 32-bit)
    const targetValue = Math.floor(0xFFFFFFFF / difficulty);
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(targetValue, 0);
    return buf.toString('hex');
  }

  getConnectedMiners() {
    return this.clients.size;
  }

  stop() {
    if (this.server) {
      this.server.close();
    }
    for (const [, client] of this.clients) {
      if (client.socket && !client.socket.destroyed) {
        client.socket.destroy();
      }
    }
    this.clients.clear();
  }
}

module.exports = StratumServer;
