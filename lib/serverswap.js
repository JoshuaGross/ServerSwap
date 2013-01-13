#!/usr/bin/env node
var spawn = require('child_process').spawn
  , tcp = new (require('./tcp.js').server)();

// Grab command from CLI args
var serverCommand = process.argv[2];
var serverArgs = (process.argv.length > 3
                  ? process.argv.splice(3,process.argv.length-3)
                  : []);

// Spawn new server
var newServer = spawn(serverCommand, serverArgs);
var newServerOutputBuffer = '';
newServer.stdout.on('data', function (data) {
  newServerOutputBuffer += data.toString();
});
newServer.stderr.on('data', function (data) {
  newServerOutputBuffer += data.toString();
});
newServer.on('exit', function () {
  console.log('New server quit unexpectedly:');
  console.log(newServerOutputBuffer);
  process.exit(1);
});
newServer.unref();

// Start the TCP server
tcp.start();
