// TCP library for client and server
// This contains most of the app logic for ServerSwap, CLI ("server") and servers ("client")
var net = require('net')
  , async = require('async')
  , serverPort = 11312
  , clientReconnectDelay = 100; //ms

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

var client = function () {
  var promoted = false, reconnectFailed = false;
  var serverSocket = null;
  var waitingFor = {};
  var waitingToFree = {};

  var resourceReady = function (resource) {
    console.log(resource, waitingFor[resource]);
    if (!waitingFor[resource]) return;
    for (var i in waitingFor[resource]) {
      waitingFor[resource][i]();
    }
  }

  this.start = function () {
    var reconnectToServerSocket = function () {
      serverSocket = net.Socket();
      serverSocket.connect(serverPort, function () {
        console.log('server socket reconnected');
        reconnectFailed = false;
        serverSocket.write(JSON.stringify(promoted ? { oldServer: true } : { newServer: true })+"\n");
      });
      serverSocket.on('data', function (data) {
        parseIncomingSocketData(data, onData);
      });
      serverSocket.on('error', function () {
        serverSocket = null;
        reconnectFailed = true;
      });
      serverSocket.on('close', function () {
        serverSocket = null;
        reconnectFailed = true;
      });
    };
    reconnectToServerSocket();

    var onData = function (data) {
      if (data.promote) {
        promoted = true;
      } else if (data.resourceReady) {
        return resourceReady(data.resourceReady);
      } else if (data.freeResource) {
        console.log(data.freeResource, waitingToFree[data.freeResource]);
        if (!waitingToFree[data.freeResource]) return;

        async.map(waitingToFree[data.freeResource], function (freeResource, iter) {
          if (freeResource.length === 1) {
            return freeResource(iter);
          } else { 
            freeResource();
            return iter(null, true);
          }
        }, function () {
          serverSocket.write(JSON.stringify({ resourceFreed: data.freeResource })+"\n");
        })
      }
    }

    // Reconnect to server if necessary
    setInterval(function () {
      if (serverSocket === null) {
        reconnectToServerSocket();
        promoted = true;
      }
      if (reconnectFailed) {
        promoted = true;
      }
    }, clientReconnectDelay);
  };
  this.readyFor = function (resource, callback) {
    waitingFor[resource] || (waitingFor[resource] = []);
    if (waitingFor[resource].indexOf(callback) === -1) waitingFor[resource].push(callback);

    // If the server socket is reconnecting, or hasn't connected yet, wait.
    if ((serverSocket === null || serverSocket._connecting || !serverSocket.readable) && !reconnectFailed) {
      var self = this;
      return process.nextTick(function () {
        self.readyFor(resource, callback);
      });
    // If the server socket wasn't present and/or we've been promoted, we assume all resources are available to us
    } else if (reconnectFailed || promoted) {
      return process.nextTick(function () {
        resourceReady(resource);
      });
    }
    serverSocket.write(JSON.stringify({ waitingFor: resource })+"\n");
  };
  this.onTakedown = function (resource, callback) {
    waitingToFree[resource] || (waitingToFree[resource] = []);
    waitingToFree[resource].push(callback);
  };
};
module.exports.client = client;
