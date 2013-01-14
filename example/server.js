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
    },Math.random()*4000)
  }).listen(8080);

  console.log('Listening on port 8080');

  serverswap.serverUp(); // optional otherwise, but necessary for "deploy" mode

  serverswap.onTakedown(':8080', function () {
    //Stop taking new connections on port 80
    console.log('Took down port 8080');
    server.close();
     //Give existing requests 5 seconds to finish processing
    setTimeout(function () {
      process.exit(0);
    }, 5*1000);
  });
})
