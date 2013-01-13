// TCP library for server
var net = require('net')
  , async = require('async')
  , config = require('config.json')
  , serverPort = config.serverPort
  , clientReconnectDelay = config.clientReconnectDelay; //ms

var parseIncomingSocketData = function (data, callback) {
  var messages = data.toString().split("\n");
  var parsedData = []
  for (var i in messages) {
    if (!messages[i]) continue;
    var parsed = {};
    try { 
      parsed = JSON.parse(messages[i]);
      parsedData.push(parsed);
    } catch (e) {
      console.log(e, data.toString());
    }
  }

  for (var i in parsedData) {
    try {
      callback(parsedData[i]);
    } catch (e) {
      console.log(e, parsedData[i], callback);
    }
  }
};

var server = function () {
  // Keep a list of active /old/ servers. Once this list is empty (they're all dead) we can exit.
  var oldServers = [];
  var newServers = [];
  var waitingFor = {};

  // Send a request to all old sockets asking them to release this resource
  var releaseResource = function (resource, requester) {
    waitingFor[resource] || (waitingFor[resource] = []);
    waitingFor[resource].push(requester);

    if (oldServers.length === 0) return resourceReady(resource);

    for (var i in oldServers) {
      oldServers[i].write(JSON.stringify({ freeResource: resource })+"\n");
    }
  };
  // Send a message to all new servers waiting for a resource to be released
  var resourceReady = function (resource) {
    if (waitingFor[resource].length === 0) return;
    var requester = waitingFor[resource].pop();

    requester.write(JSON.stringify({ resourceReady: resource })+"\n");
    process.nextTick(function () {
      resourceReady(resource);
    });
  };

  // Start the incoming server, which receives 'readyFor' messages from the new server(s)
  this.start = function () {
    var tcpServer = net.createServer(function (socket) {
      socket.on('data', function (data) {
        parseIncomingSocketData(data, onData)
      });
      var onData = function (data) {
        if (data.oldServer) {
          oldServers.push(socket);

          socket.on('close', function () {
            for (var i in oldServers) {
              if (oldServers[i] === socket) oldServers.splice(i, 1);
            }
          });

        } else if (data.newServer) {
          newServers.push(socket);

          // If a new server disconnects with us before the process exits, something bad happened
          socket.on('close', function (msg) {
            console.log('New server died unexpectedly', msg)
            process.exit(1);
          });
        } else if (data.waitingFor) {
          releaseResource(data.waitingFor, socket);
        } else if (data.resourceFreed) {
          resourceReady(data.resourceFreed);
        }
      }
    });
    tcpServer.listen(serverPort);

    // Promote new servers when all the old servers are gone
    setInterval(function () {
      if (oldServers.length === 0) {
        for (var i in newServers) {
          newServers[i].write(JSON.stringify({ promote: true })+"\n");
        }
        console.log('All old servers died; promoted', newServers.length, 'new server(s).')
        process.exit(0);
      }
    }, clientReconnectDelay*2);
  };
};

module.exports.server = server;

