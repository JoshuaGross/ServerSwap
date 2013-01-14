#!/usr/bin/env node
var spawn = require('child_process').spawn
  , tcp = new (require('./tcp.js').server)();

// Grab command from CLI args
var serverCommand = process.argv[2];
var serverArgs = (process.argv.length > 3
                  ? process.argv.splice(3,process.argv.length-3)
                  : []);

// Start the TCP server
tcp.start();

// Spawn new server
var newServer = spawn(serverCommand, serverArgs, { detached: true, stdio: ['ignore', 1, 2] });
newServer.unref();
