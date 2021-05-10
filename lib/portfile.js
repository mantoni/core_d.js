/*eslint no-sync: 0*/
'use strict';

const fs = require('fs');

const home_env = process.platform === 'win32' ? 'USERPROFILE' : 'HOME';
const data_dir = process.env.XDG_RUNTIME_DIR || process.env[home_env];
const data_file = `${data_dir}/${process.env.CORE_D_DOTFILE}`;

exports.write = function (port, token) {
  fs.writeFileSync(data_file, `${port} ${token}`);
};

exports.read = function (callback) {
  fs.readFile(data_file, 'utf8', (err, data) => {
    if (err) {
      callback(null);
      return;
    }
    const parts = data.split(' ');
    callback({
      port: Number(parts[0]),
      token: parts[1]
    });
  });
};

exports.unlink = function () {
  if (fs.existsSync(data_file)) {
    fs.unlinkSync(data_file);
  }
};
