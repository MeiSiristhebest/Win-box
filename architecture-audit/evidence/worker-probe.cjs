const { parentPort } = require('node:worker_threads');
parentPort.on('message', message => {
  if (message.t === 'call') {
    parentPort.postMessage({ t: 'log', level: 'i', msg: 'audit-call-started' });
    if (message.args[0] === 'crash') process.exit(7);
  }
});
