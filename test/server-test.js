/*eslint-env mocha*/
'use strict';

const fs = require('fs');
const net = require('net');
const crypto = require('crypto');
const EventEmitter = require('events');
const { assert, refute, sinon } = require('@sinonjs/referee-sinon');
const server = require('../lib/server');
const portfile = require('../lib/portfile');
const service = require('./fixture/service');

function createConnection() {
  const connection = new EventEmitter();
  connection.write = sinon.fake();
  connection.end = sinon.fake();
  return connection;
}

describe('server', () => {
  const token = 'c2d003e2b9de9e70';
  let net_server;
  let connection;

  beforeEach(() => {
    net_server = new EventEmitter();
    net_server.listen = sinon.fake();
    net_server.close = sinon.fake();
    net_server.address = sinon.fake.returns({ port: 8765 });
    connection = createConnection();
    sinon.replace(net, 'createServer', sinon.fake.returns(net_server));
    sinon.replace(portfile, 'write', sinon.fake());
    sinon.replace(crypto, 'randomBytes',
      sinon.fake.returns(Buffer.from(token, 'hex')));
  });

  function start() {
    server.start();
    net_server.listen.callback();
  }

  function connect(connection) {
    net_server.emit('connection', connection);
    net.createServer.callback(connection);
  }

  function request(connection, text) {
    connect(connection);
    if (text) {
      connection.emit('data', text);
    }
    connection.emit('end');
  }

  it('starts server and listens on random port', () => {
    const instance = server.start();

    assert.equals(instance, net_server);
    assert.calledOnceWith(net.createServer, {
      allowHalfOpen: true
    }, sinon.match.func);
    assert.calledOnceWith(net_server.listen, 0, '127.0.0.1', sinon.match.func);
  });

  it('writes portfile when listen yields', () => {
    server.start();

    net_server.listen.callback();

    assert.calledOnceWith(crypto.randomBytes, 8);
    assert.calledOnceWith(portfile.write, 8765, token);
  });

  it('closes connection without writing anything for empty request', () => {
    sinon.replace(fs, 'stat', sinon.fake());
    start();

    request(connection);

    refute.called(connection.write);
    assert.calledOnce(connection.end);
  });

  describe('stop', () => {

    beforeEach(() => {
      sinon.replace(fs, 'stat', sinon.fake());
    });

    it('closes connection and server for "stop" command', () => {
      start();

      request(connection, `${token} stop`);

      refute.called(connection.write);
      assert.calledOnce(connection.end);
      assert.calledOnce(net_server.close);
    });

    it('closes any other pending connection on "stop" command', () => {
      start();
      const one = createConnection();
      const two = createConnection();
      connect(one);
      connect(two);

      request(connection, `${token} stop`);

      assert.calledOnceWith(one.end, 'Server is stopping...\n# exit 1');
      assert.calledOnceWith(two.end, 'Server is stopping...\n# exit 1');
      assert.calledOnce(connection.end);
      assert.calledWithExactly(connection.end);
    });

    it('ignores failures when attempting to close client connection', () => {
      start();
      const one = createConnection();
      one.end = sinon.fake.throws(new Error());
      const two = createConnection();
      two.end = sinon.fake.throws(new Error());

      connect(one);
      connect(two);

      request(connection, `${token} stop`);

      assert.calledOnce(one.end);
      assert.calledOnce(two.end);
      assert.calledOnce(connection.end);
      assert.calledOnce(net_server.close);
    });

    it('does not process "stop" if token is invalid', () => {
      start();

      request(connection, '123456789abcdef status');

      assert.calledOnce(connection.end);
      assert.calledWithExactly(connection.end);
      refute.called(connection.write);
      refute.called(net_server.close);
    });

    it('stops server without waiting for stat calls', () => {
      start();

      request(connection, `${token} stop`);

      assert.calledOnce(net_server.close);
      assert.calledOnce(connection.end);
    });

  });

  describe('status', () => {

    beforeEach(() => {
      sinon.replace(fs, 'stat', sinon.fake());
    });

    it('prints service status and closes connection', () => {
      sinon.replace(service, 'getStatus', sinon.fake.returns('Oh, hi!\n'));
      start();

      request(connection, `${token} status`);

      assert.calledOnceWith(connection.end, 'Running. Oh, hi!\n');
    });

    it('does not process "status" if token is invalid', () => {
      sinon.replace(service, 'getStatus', sinon.fake());
      start();

      request(connection, '123456789abcdef status');

      assert.calledOnce(connection.end);
      assert.calledWithExactly(connection.end);
      refute.called(connection.write);
      refute.called(service.getStatus);
    });

    it('gets "status" without waiting for stat calls', () => {
      sinon.replace(service, 'getStatus', sinon.fake.returns('Yes yo!'));
      start();

      request(connection, `${token} status`);

      assert.calledOnce(service.getStatus);
      assert.calledOnceWith(connection.end, 'Running. Yes yo!');
    });

  });

  describe('invoke', () => {
    const json = {
      cwd: '/some/path',
      args: ['--some', '--args'],
      text: '"Some text"'
    };

    it('invokes service with JSON arguments', () => {
      sinon.replace(fs, 'stat', sinon.fake.yields(new Error()));
      sinon.replace(service, 'invoke', sinon.fake.yields(null, 'Oh, hi!\n'));
      start();

      request(connection, `${token} ${JSON.stringify(json)}`);

      assert.calledOnceWith(service.invoke, json.cwd, json.args, json.text);
      assert.calledOnceWith(connection.write, 'Oh, hi!\n');
      assert.calledOnce(connection.end);
    });

    it('invokes service with plain text arguments', () => {
      sinon.replace(fs, 'stat', sinon.fake.yields(new Error()));
      sinon.replace(service, 'invoke', sinon.fake.yields(null, 'Oh, hi!\n'));
      start();

      request(connection,
        `${token} ${json.cwd} ${json.args.join(' ')}\n${json.text}`);

      assert.calledOnceWith(service.invoke, json.cwd, json.args, json.text);
      assert.calledOnceWith(connection.write, 'Oh, hi!\n');
      assert.calledOnce(connection.end);
    });

    it('handles exception from service', () => {
      sinon.replace(fs, 'stat', sinon.fake.yields(new Error()));
      sinon.replace(service, 'invoke',
        sinon.fake.throws(new Error('Whatever')));
      start();

      request(connection, `${token} ${JSON.stringify(json)}`);

      assert.calledOnceWith(connection.end, 'Error: Whatever\n# exit 1');
    });

    it('handles error response from service', () => {
      sinon.replace(fs, 'stat', sinon.fake.yields(new Error()));
      sinon.replace(service, 'invoke',
        sinon.fake.yields(new Error('Whatever')));
      start();

      request(connection, `${token} ${JSON.stringify(json)}`);

      assert.calledOnceWith(connection.end, 'Error: Whatever\n# exit 1');
    });

    it('does not throw if connection died after exception from service', () => {
      sinon.replace(fs, 'stat', sinon.fake.yields(new Error()));
      sinon.replace(service, 'invoke',
        sinon.fake.throws(new Error('Whatever')));
      connection.end = sinon.fake.throws(new Error('Oh dear!'));
      start();

      refute.exception(() => {
        request(connection, `${token} ${JSON.stringify(json)}`);
      });
      assert.calledOnce(connection.end); // Verify actually called
    });

    it('stats common package manager files on connect', () => {
      sinon.replace(fs, 'stat', sinon.fake());
      sinon.replace(service, 'invoke', sinon.fake());
      start();

      request(connection, `${token} ${JSON.stringify(json)}`);

      assert.calledWith(fs.stat, 'package.json');
      assert.calledWith(fs.stat, 'package-lock.json');
      assert.calledWith(fs.stat, 'npm-shrinkwrap.json');
      assert.calledWith(fs.stat, 'yarn.lock');
      assert.calledWith(fs.stat, 'pnpm-lock.yaml');
    });

    it('does not invoke until stat calls yield', () => {
      sinon.replace(fs, 'stat', sinon.fake());
      sinon.replace(service, 'invoke', sinon.fake());
      start();

      request(connection, `${token} ${JSON.stringify(json)}`);

      refute.called(service.invoke);

      fs.stat.getCall(0).callback(new Error());
      fs.stat.getCall(1).callback(new Error());
      fs.stat.getCall(2).callback(new Error());
      fs.stat.getCall(3).callback(new Error());
      fs.stat.getCall(4).callback(new Error());

      assert.calledOnce(service.invoke);
    });

    it('passes largest mtime value to service', () => {
      sinon.replace(fs, 'stat', sinon.fake());
      sinon.replace(service, 'invoke', sinon.fake());
      start();

      request(connection, `${token} ${JSON.stringify(json)}`);

      fs.stat.getCall(0).callback(null, { mtimeMs: 7 });
      fs.stat.getCall(1).callback(null, { mtimeMs: 42 });
      fs.stat.getCall(2).callback(null, { mtimeMs: 2 });
      fs.stat.getCall(3).callback(null, { mtimeMs: 3 });
      fs.stat.getCall(4).callback(null, { mtimeMs: 12 });

      assert.calledOnceWith(service.invoke, json.cwd, json.args, json.text, 42);
    });
  });

});
