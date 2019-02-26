'use strict';

if (process.env.CORE_D_TITLE) {
  process.title = process.env.CORE_D_TITLE;
}

const server = require('./server');
const portfile = require('./portfile');

const instance = server.start();

process.on('exit', () => {
  portfile.unlink();
});
process.on('SIGTERM', () => {
  instance.stop();
});
process.on('SIGINT', () => {
  instance.stop();
});
