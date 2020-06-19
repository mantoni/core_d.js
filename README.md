# core\_d

[![Build Status]](https://travis-ci.org/mantoni/core_d.js)
[![SemVer]](http://semver.org)
[![License]](https://github.com/mantoni/core\_d.js/blob/master/LICENSE)

Offload your heavy lifting to a daemon. Extracted from [eslint_d][].

## Install

This will install the `core_d` as a dependency:

```bash
❯ npm install core_d
```

## Usage

You need to create a main file that controls the daemon and a `service.js` file
which will run in the background.

The main file should look something like this:

```js
const cmd = process.argv[2];

process.env.CORE_D_TITLE = 'your_d';
process.env.CORE_D_DOTFILE = '.your_d';
process.env.CORE_D_SERVICE = require.resolve('./your-service');

const core_d = require('core_d');

if (cmd === 'start'
  || cmd === 'stop'
  || cmd === 'restart'
  || cmd === 'status') {
  core_d[cmd]();
  return;
}

core_d.invoke(process.argv.slice(2));
```

The `service.js` file must expose an `invoke` function like this:

```js
/*
 * The core_d service entry point.
 */
exports.invoke = function (cwd, args, text, mtime) {
  return 'Your response';
};
```

## How does this work?

The first time you call `core_d.invoke(...)`, a little server is started in the
background and bound to a random port. The port number is stored along with a
security token in the configured dotfile. Your services `invoke` method is
called with the same arguments. Later calls to `invoke` will be executed on the
same instance. So if you have a large app that takes a long time to load, but
otherwise responds quickly, and you're using it frequently, like linting a
file, then `core_d` can give your tool a performance boost.

## API

The `core_d` client exposes these functions:

- `start()`: Starts the background server and create the dotfile. It's not
  necessary to call this since `invoke` will start the server if it's not
  already running.
- `stop()`: Stops the background server and removed the dotfile.
- `restart()`: Stops and starts the background server again.
- `status()`: Prints a status message saying whether the server is running or
  not. If the server is running and your service implements `getStatus()`, the
  return value will be printed as well.
- `invoke(cwd, args[, text])`: Invokes the `invoke` methods in the service.

Environment variables:

- `CORE_D_TITLE`: The process title to use. Optional.
- `CORE_D_DOTFILE`: The name of dotfile to use, e.g. `.core_d`.
- `CORE_D_SERVICE`: The resolved path to the service implementation. Use
  `require.resolve('./relative-path')` to receive the resolved path.

Your service must implement a function with the signature `invoke(cwd, args,
text, mtime)`. The passed arguments are:

- `cwd`: The current working directory.
- `args`: The first argument passed to `core_d.invoke`.
- `text`: The second argument passed to `core_d.invoke`.
- `mtime`: The newest `mtime` returns from `fs.stat` on any of these files:
    - `package.json`
    - `package-lock.json`
    - `npm-shrinkwrap.json`
    - `yarn.lock`
    - `pnpm-lock.yaml`
  Use this to flush any caches if `mtime` is newer than the last value received.

The service can optionally implement a `getStatus()` function to return
additional status information when calling `core_d.status()`.

## Moar speed

If you're really into performance and want the lowest possible latency, talk to
the `core_d` server with netcat. This will also eliminate the node.js startup
time on the client side.

```bash
❯ PORT=`cat ~/.core_d | cut -d" " -f1`
❯ TOKEN=`cat ~/.core_d | cut -d" " -f2`
❯ echo "$TOKEN $PWD file.js" | nc localhost $PORT
```

Or if you want to work with stdin:

```bash
❯ echo "$TOKEN $PWD --stdin" | cat - file.js | nc localhost $PORT
```

## Compatibility

- `1.0.0`: node 6, 8 and 10

## License

MIT

[Build Status]: https://img.shields.io/travis/mantoni/core_d.js/master.svg
[SemVer]: https://img.shields.io/:semver-%E2%9C%93-brightgreen.svg
[License]: https://img.shields.io/npm/l/core_d.svg
[eslint_d]: https://github.com/mantoni/eslint_d.js
