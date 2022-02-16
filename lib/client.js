'use strict';

const out = require('./out');
const connect = require('./connect');

function write(chunk) {
  out.write(chunk);
}

function fail(err) {
  out.write(`${err}\n`);
}

function sendCommand(command, callback) {
  connect((err, socket, token) => {
    if (err) {
      fail(err);
      if (typeof callback === 'function' && !process.exitCode) {
        callback();
      }
      return;
    }
    socket.on('data', write);
    socket.end(`${token} ${command}`, () => {
      if (typeof callback === 'function') {
        callback();
      }
    });
  });
}

exports.start = function () {
  // eslint-disable-next-line node/global-require
  require('./launcher').launch();
};

exports.stop = function (callback) {
  sendCommand('stop', callback);
};

exports.restart = function () {
  exports.stop(() => {
    process.nextTick(exports.start);
  });
};

exports.status = function () {
  sendCommand('status');
};

function invoke(socket, token, args, text) {
  // If color is not supported, pass the `--no-color` switch. We enforce color
  // support in the daemon with `FORCE_COLOR=1` (see `launcher.js`).
  // eslint-disable-next-line node/global-require
  if (!require('supports-color').stdout) {
    args = ['--no-color'].concat(args);
  }

  let buf = '';
  socket.on('data', (chunk) => {
    buf += chunk;
    const p = buf.lastIndexOf('\n');
    if (p !== -1) {
      out.write(buf.substring(0, p + 1));
      buf = buf.substring(p + 1);
    }
  });
  socket.on('end', () => {
    if (buf) {
      if (buf.startsWith('# exit ')) {
        process.exitCode = Number(buf.substring(7));
      } else {
        out.write(buf);
      }
    }
  });
  const cwd = process.cwd();
  socket.end(`${token} ${JSON.stringify({ cwd, args, text })}`);
}

function onLaunch(args, text) {
  return (err, socket, token) => {
    if (err) {
      fail(err);
      process.exitCode = 1;
      return;
    }
    invoke(socket, token, args, text);
  };
}

exports.invoke = function (args, text) {
  if (!args.length && !text) {
    fail('No files specified');
    return;
  }
  connect((err, socket, token) => {
    if (err) {
      if (process.exitCode === 1) {
        fail(err);
        return;
      }
      // eslint-disable-next-line node/global-require
      require('./launcher').launch(onLaunch(args, text));
    } else {
      invoke(socket, token, args, text);
    }
  });
};
