"use strict";

const out = require("./out");
const connect = require("./connect");

function wait(callback) {
  connect((err, socket, token) => {
    if (err) {
      if (process.exitCode) {
        callback(err);
        return;
      }
      setTimeout(() => {
        wait(callback);
      }, 100);
      return;
    }
    if (typeof callback === "function") {
      callback(null, socket, token);
    } else {
      socket.end();
    }
  });
}

function launch(callback) {
  if (global.core_d_launching) {
    throw new Error("Already launching");
  }
  global.core_d_launching = true;
  const env = Object.create(process.env);
  // Force enable color support in `supports-color`. The client adds
  // `--no-color` to disable color if not supported.
  env.FORCE_COLOR = 1;
  // eslint-disable-next-line node/global-require
  const { spawn } = require("child_process");
  const daemon = require.resolve("./daemon");

  // Debug is enabled
  if (process.env.CORE_D_DEBUG) {
    let scriptOutput = "";
    const child = spawn("node", [daemon], {
      detached: true,
      env
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (data) => {
      //Here is where the output goes
      console.log(`stdout: ${data}`);
      data = data.toString();
      scriptOutput += data;
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (data) => {
      //Here is where the error output goes
      console.log(`stderr: ${data}`);
      data = data.toString();
      scriptOutput += data;
    });

    child.on("close", (code) => {
      //Here you can get the exit code of the script
      console.log(`closing code: ${code}`);
      console.log("Full output of script: ", scriptOutput);
    });
    child.unref();
  } else {
    const child = spawn("node", [daemon], {
      detached: true,
      env,
      stdio: ["ignore", "ignore", "ignore"]
    });
    child.unref();
  }
  setTimeout(() => {
    wait(callback);
  }, 100);
}

exports.launch = function (callback) {
  connect((err, socket) => {
    if (err) {
      if (process.exitCode) {
        out.writeError(`${err}\n`);
        return;
      }
      launch(callback);
    } else {
      socket.end();
      out.writeError("Already running\n");
    }
  });
};
