// server.js
// Start with: serverswap server.js
var http = require('http')
  , serverswap = require('../');

// connect to databases
// ...
// load some more stuff
// ...

serverswap.readyFor(':8080', function () {
  var server = http.createServer(function (req, res) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    setTimeout(function () {
      res.end("Hello World!\n");
    },Math.random()*0)
  });

  var onListen = function () {
    console.log('Example server [',process.pid,'] Listening on port 8080');

    serverswap.serverUp(); // optional otherwise, but necessary for "deploy" mode

    serverswap.onTakedown(':8080', function (done) {
      //Stop taking new connections on port 80
      console.log('Example server [',process.pid,'] Taking down port 8080');
      server.close(function () {
        console.log('Example server [',process.pid,'] Took down port 8080');

        done();

         //Give existing requests 5 seconds to finish processing
        setTimeout(function () {
          process.exit(0);
        }, 5*1000);
      });
    });
  };

  var attemptListen = function () {
    server.listen(8080);
  };

  server.on('listening', onListen);

  server.on('error', function (e) {
    if (e.code === 'EADDRINUSE') {
      process.nextTick(attemptListen);
    }
  })

  attemptListen();
})
