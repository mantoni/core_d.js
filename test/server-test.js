/*eslint-env mocha*/
'use strict';

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

  function connect(con) {
    net_server.emit('connection', con);
    net.createServer.callback(con);
  }

  function request(con, text) {
    connect(con);
    if (text) {
      con.emit('data', text);
    }
    con.emit('end');
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
    start();

    request(connection);

    refute.called(connection.write);
    assert.calledOnce(connection.end);
  });

  describe('stop', () => {

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

    it('stops server without waiting for readFile calls', () => {
      start();

      request(connection, `${token} stop`);

      assert.calledOnce(net_server.close);
      assert.calledOnce(connection.end);
    });

  });

  describe('status', () => {

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

    it('gets "status" without waiting for readFile calls', () => {
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
      sinon.replace(service, 'invoke', sinon.fake.yields(null, 'Oh, hi!\n'));
      start();

      request(connection, `${token} ${JSON.stringify(json)}`);

      assert.calledOnceWith(service.invoke, json.cwd, json.args, json.text);
      assert.calledOnceWith(connection.write, 'Oh, hi!\n');
      assert.calledOnce(connection.end);
    });

    it('invokes service with plain text arguments', () => {
      sinon.replace(service, 'invoke', sinon.fake.yields(null, 'Oh, hi!\n'));
      start();

      request(connection,
        `${token} ${json.cwd} ${json.args.join(' ')}\n${json.text}`);

      assert.calledOnceWith(service.invoke, json.cwd, json.args, json.text);
      assert.calledOnceWith(connection.write, 'Oh, hi!\n');
      assert.calledOnce(connection.end);
    });

    it('handles exception from service', () => {
      sinon.replace(service, 'invoke',
        sinon.fake.throws(new Error('Whatever')));
      start();

      request(connection, `${token} ${JSON.stringify(json)}`);

      assert.calledOnceWith(connection.end, 'Error: Whatever\n# exit 1');
    });

    it('handles error response from service', () => {
      sinon.replace(service, 'invoke',
        sinon.fake.yields(new Error('Whatever')));
      start();

      request(connection, `${token} ${JSON.stringify(json)}`);

      assert.calledOnceWith(connection.end, 'Error: Whatever\n# exit 1');
    });

    it('handles error response from service with specified exit code', () => {
      const serviceError = new Error('Whatever');
      serviceError.exitCode = 2;
      sinon.replace(service, 'invoke',
        sinon.fake.yields(serviceError));
      start();

      request(connection, `${token} ${JSON.stringify(json)}`);

      assert.calledOnceWith(connection.end, 'Error: Whatever\n# exit 2');
    });

    it('does not throw if connection died after exception from service', () => {
      sinon.replace(service, 'invoke',
        sinon.fake.throws(new Error('Whatever')));
      connection.end = sinon.fake.throws(new Error('Oh dear!'));
      start();

      refute.exception(() => {
        request(connection, `${token} ${JSON.stringify(json)}`);
      });
      assert.calledOnce(connection.end); // Verify actually called
    });
  });

});
