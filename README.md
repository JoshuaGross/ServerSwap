serverswap
==========

ServerSwap is a small command-line utility, written in Node.js, that has one job: perform zero-downtime server restarts.

Get it
------
`npm install -g serverswap`

Command-line Usage
------------------
Start your server like this:

If your server is server.js in the current directory: `serverswap node server.js` 

You can also pass command-line arguments to your server: `serverswap node server.js a b c`

Your server does not need to be running on Node.js, but I have only provided a client library for Node.js currently.

Server Usage
------------
The core intuition behind ServerSwap is that servers can communicate with ServerSwap to let it know when everything they need has been initialized, and
all they need to do is bind to a port.

When the ServerSwap instance receives the readyFor message, it will attempt to find an existing server, bring it down, and then send a message back to your new server that it can safely start up.

Old servers are killed unceremoniously by default, but you can also set your server to respond to a `takeDown` message:

```
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
    res.end("Hello World!\n");
  }).listen(8080);

  console.log('Listening on port 8080');

  serverswap.onTakedown(':8080', function () {
    // Stop taking new connections on port 80
    console.log('Took down port 8080');
    server.close();
    // Give existing requests 5 seconds to finish processing
    setTimeout(function () {
      process.exit(0);
    }, 5*1000);
  });
})
```

You can send as many `readyFor` and `onTakedown` messages as you want for a staggered server deploy. `serverswap` will keep running until the older server process exits.

Deploy mode
-----------
You can also run ServerSwap in deploy mode by running `serverswap-deploy`. It will keep running either until the processes it spawns dies, either by
failure or replacement. 

Motivation
----------
While working on SpanDeX.io I would often need to deploy code to our production servers, which resulted in (at worst) 30 seconds to (at best) 6 seconds of downtime in which users would be disconnected from documents and the server would appear dead to the outside world.

I'm sure I wasn't the first person to think of this, but I had a simple intuition: just don't take down the old server process until the new server process is ready to listen on an HTTP port. Between deploys and server restarts, this result in close to 0 milliseconds of downtime.

Credit
------
Developed and maintained by Joshua Gross <josh@spandex.io> for SpanDeX.io.

License
-------
MIT.
