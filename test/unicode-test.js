'use strict';

const net = require('net');
const crypto = require('crypto');
const { assert, refute, sinon } = require('@sinonjs/referee-sinon');
const server = require('../lib/server');
const portfile = require('../lib/portfile');
const service = require('./fixture/service');

describe('unicode handling', () => {
  let srv;
  let port;
  let token;

  beforeEach((done) => {
    token = crypto.randomBytes(8).toString('hex');
    sinon.restore();
    sinon.replace(crypto, 'randomBytes', () => Buffer.from(token, 'hex'));
    sinon.replace(service, 'invoke', (_, __, text, cb) => cb(null, text));
    sinon.replace(portfile, 'write', () => {});
    srv = server.start();
    srv.listen(0, '127.0.0.1', () => {
      port = srv.address().port;
      // Give server a moment to be ready for connections
      setTimeout(done, 50);
    });
  });

  afterEach((done) => {
    if (srv) {
      // First try to gracefully close
      srv.close((_err) => {
        srv = null;
        // Give extra time for cleanup to prevent hanging processes
        setTimeout(done, 100);
      });

      // Force close after timeout if needed
      const forceTimeout = setTimeout(() => {
        if (srv) {
          srv.unref(); // Allow process to exit even if server is still running
          srv = null;
        }
      }, 1000);

      srv.on('close', () => {
        clearTimeout(forceTimeout);
      });
    } else {
      done();
    }
  });

  /*eslint require-await: 0*/
  async function makeRequest(text) {
    const json = {
      cwd: '/test',
      args: ['--test'],
      text
    };

    async function tryConnect(attempts = 10, delay = 200) {
      const serverPort = port; // Capture port value to avoid ESLint no-loop-func warning
      for (let i = 0; i < attempts; i++) {
        try {
          const client = await new Promise((resolve, reject) => {
            const conn = net.connect({ port: serverPort, host: '127.0.0.1' });
            conn.setEncoding('utf8');

            const timeout = setTimeout(() => {
              conn.removeAllListeners();
              conn.destroy();
              reject(new Error('Connection timeout'));
            }, 1000);

            conn.on('connect', () => {
              clearTimeout(timeout);
              resolve(conn);
            });

            conn.on('error', (err) => {
              clearTimeout(timeout);
              conn.removeAllListeners();
              reject(err);
            });
          });
          return client;
        } catch (err) {
          if (i === attempts - 1) { throw err; }
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
      return null; // Satisfies consistent-return
    }

    const client = await tryConnect();
    let response = '';

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        client.removeAllListeners(); // Remove all listeners to prevent memory leaks
        client.destroy();
        reject(new Error('Request timeout'));
      }, 4000);

      client.on('data', (chunk) => {
        response += chunk;
      });

      client.on('error', (err) => {
        clearTimeout(timeout);
        client.removeAllListeners();
        reject(err);
      });

      client.on('end', () => {
        clearTimeout(timeout);
        client.removeAllListeners();
        resolve(response);
      });

      client.end(`${token} ${JSON.stringify(json)}`);
    });
  }

  // This test demonstrates a bug when sending large amount of UTF-8 text
  // (around 100 KB) through the server. The text gets corrupted due to
  // incorrect handling of partial UTF-8 characters, and the corruption
  // manifests itself as UTF-8 replacement characters (U+FFFD).
  it('should not corrupt large UTF-8 data', async function() {
    this.timeout(5000);

    const alphabet = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя';
    const times = Math.ceil(100000 / alphabet.length);
    const text = alphabet.repeat(times);
    const response = await makeRequest(text);

    // Before the fix this assertion would fail:
    refute(response.includes('\ufffd'), 'Server corrupted UTF-8 data');
    assert.equals(response, text, 'Server returned wrong data');
  });
});

