'use strict';

const fs = require('fs');
const net = require('net');
const crypto = require('crypto');
const portfile = require('./portfile');
const service = require(process.env.CORE_D_SERVICE);

function fail(con, message, exitCode = 1) {
  try {
    con.end(`${message}\n# exit ${exitCode}`);
  } catch (ignore) {
    // Nothing we can do
  }
}

function remove(connections, con) {
  const p = connections.indexOf(con);
  if (p !== -1) {
    connections.splice(p, 1);
  }
}

function parseData(data) {
  if (data.substring(0, 1) === '{') {
    return JSON.parse(data);
  }

  const newlineIndex = data.indexOf('\n');
  let text;
  if (newlineIndex >= 0) {
    text = data.slice(newlineIndex + 1);
    data = data.slice(0, newlineIndex);
  }
  const parts = data.split(' ');
  return {
    cwd: parts[0],
    args: parts.slice(1),
    text
  };
}

const stat_files = [
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml'
];

exports.start = function () {

  const token = crypto.randomBytes(8).toString('hex');
  const open_connections = [];

  const server = net.createServer({
    allowHalfOpen: true
  }, (con) => {
    let latch = stat_files.length + 1;
    const hash = crypto.createHash('md5');
    let data = '';

    const handleResult = (err, result) => {
      if (err) {
        const exitCode = typeof err === 'object'
              && err.exitCode ? err.exitCode : 1;
        fail(con, String(err), exitCode);
        return;
      }
      con.write(result);
      con.end();
    };

    const decrementLatch = () => {
      if (--latch === 0) {
        const { cwd, args, text } = parseData(data);
        try {
          service.invoke(cwd, args, text, hash.digest('base64'), handleResult);
        } catch (e) {
          fail(con, String(e));
        }
      }
    };

    con.on('data', (chunk) => {
      data += chunk;
    });
    con.on('end', () => {
      remove(open_connections, con);
      if (!data) {
        con.end();
        return;
      }
      const p = data.indexOf(' ');
      if (p === -1 || data.substring(0, p) !== token) {
        con.end();
        return;
      }
      data = data.substring(p + 1);
      if (data === 'stop') {
        open_connections.forEach((c) => fail(c, 'Server is stopping...'));
        con.end();
        server.close();
        return;
      }
      if (data === 'status') {
        if (service.getStatus) {
          con.end(`Running. ${service.getStatus()}`);
        } else {
          con.end('Running');
        }
        return;
      }
      decrementLatch();
    });
    const onReadFile = (err, content) => {
      if (!err) {
        hash.update(content);
      }
      decrementLatch();
    };
    for (const stat_file of stat_files) {
      fs.readFile(stat_file, onReadFile);
    }
  });

  server.on('connection', (con) => {
    open_connections.push(con);
  });

  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    portfile.write(port, token);
  });

  return server;
};
