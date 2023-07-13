'use strict';

exports.write = function (message) {
  process.stdout.write(message);
};

exports.writeError = function (message) {
  process.stderr.write(message);
};
