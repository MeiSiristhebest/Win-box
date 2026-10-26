const { parentPort } = require('node:worker_threads');

parentPort.on('message', (message) => {
  if (message.t !== 'call') return;

  if (message.args[0] === 'crash') {
    parentPort.postMessage({ t: 'log', level: 'i', msg: 'worker-pool-call-started' });
    process.exit(7);
  }

  if (message.args[0] === 'hang') {
    parentPort.postMessage({ t: 'log', level: 'i', msg: 'worker-pool-call-started' });
    return;
  }

  parentPort.postMessage({ t: 'ok', id: message.id, value: 'ok' });
});
