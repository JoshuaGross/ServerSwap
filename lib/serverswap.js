#!/usr/bin/env node
var spawn = require('child_process').spawn
  , deployMode = /serverswap-deploy$/.test(process.argv[1])
  , tcp = new (require('./tcp.js').server)(deployMode);

// Start the TCP server
tcp.start();

// Grab command from CLI args
var serverCommand = process.argv[2];
var serverArgs = (process.argv.length > 3
                  ? process.argv.splice(3,process.argv.length-3)
                  : []);

if (/\.js$/.test(serverCommand)) {
  serverArgs.unshift(serverCommand);
  serverCommand = 'node';
}

// Spawn new server
var newServer = spawn(serverCommand, serverArgs, { detached: true, stdio: ['ignore', process.stdout, process.stderr] });
newServer.unref();
