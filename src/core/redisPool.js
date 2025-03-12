import { createPool } from 'generic-pool';

import { createClient } from 'redis';

import { config } from './config.js'; // Adjust the path as needed


// Factory for creating and destroying Redis clients

const factory = {

  create: async () => {

    const client = createClient({

      socket: {

        host: config.redis.socket.host,

        port: config.redis.socket.port,

        connectTimeout: 10000,

      },

      password: config.redis.password,

      username: config.redis.username,

    });

    client.on('error', (err) => {

      console.error('Redis client error:', err);

    });

    await client.connect();

    return client;

  },

  destroy: async (client) => {

    try {

      await client.quit();

    } catch (error) {

      console.error('Error quitting Redis client:', error);

    }

  }

};


const opts = {

  max: 10, // maximum number of clients in the pool

  min: 2,  // minimum number of clients in the pool

  idleTimeoutMillis: 30000, // how long a client can remain idle before being released

};


export const redisPool = createPool(factory, opts);