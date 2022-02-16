'use strict';

const net = require('net');
const portfile = require('./portfile');

module.exports = function (callback) {
  portfile.read((config) => {
    if (!config) {
      // eslint-disable-next-line node/no-callback-literal
      callback('Not running');
      return;
    }
    const socket = net.connect(config.port, '127.0.0.1', () => {
      callback(null, socket, config.token);
    });
    socket.once('error', (err) => {
      if (err.code === 'ECONNREFUSED') {
        portfile.unlink();
        if (global.core_d_launching) {
          process.exitCode = 1;
        }
      } else {
        process.exitCode = 1;
      }
      // eslint-disable-next-line node/no-callback-literal
      callback('Could not connect');
    });
  });
};
