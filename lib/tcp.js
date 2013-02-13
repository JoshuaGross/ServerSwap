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

var server = function (deployMode) {
  // Keep a list of active /old/ servers. Once this list is empty (they're all dead) we can exit.
  var oldServers = [];
  var newServers = [];
  var watchPIDs = []; // PIDs to watch in deploy mode
  var waitingFor = {};
  var respondToCloseEvents = true;

  // Send a request to all old sockets asking them to release this resource
  var releaseResource = function (resource, requester) {
    waitingFor[resource] || (waitingFor[resource] = []);
    waitingFor[resource].freedBy || (waitingFor[resource].freedBy = []);
    if (waitingFor[resource].indexOf(requester) === -1) waitingFor[resource].push(requester);

    if (oldServers.length === 0) return resourceReady(resource);
    console.log('ServerSwap Server ['+process.pid+']: Attempting to free resource', resource, 'for', requester.pid)

    for (var i in oldServers) {
      console.log('ServerSwap Server ['+process.pid+']: Attempting to free resource', resource, oldServers[i].pid)
      oldServers[i].write(JSON.stringify({ freeResource: resource })+"\n");
    }
  };
  // Send a message to all new servers waiting for a resource to be released
  var resourceReady = function (resource) {
    if (!waitingFor[resource]) return;
    if (waitingFor[resource].length === 0) return;

    // We will only send a resourceReady message to the first of these requesters. If any are
    // added while we're responding, they /should/ get a tooLate message.
    if (waitingFor[resource].responded) return;
    waitingFor[resource].responded = true;

    var requester = waitingFor[resource].pop();

    console.log('ServerSwap Server ['+process.pid+']: Giving',resource,'to',requester.pid)
    requester.write(JSON.stringify({ resourceReady: resource })+"\n");

    // In case there was already a server waiting for this same resource, tell the newcomer that it's too late.
    var endResourceRace = function () {
      if (waitingFor[resource].length == 0) {
        waitingFor[resource] = undefined;
        return;
      }
      var tooLateRequester = waitingFor[resource].shift();

      // Duplicate?
      if (requester == tooLateRequester) {
        return endResourceRace();
      }

      console.log('ServerSwap Server ['+process.pid+']: Killing late requester for',resource,tooLateRequester.pid)
      tooLateRequester.write(JSON.stringify({ tooLate: resource })+"\n");
      process.nextTick(function () {
        tooLateRequester.end();
        endResourceRace();
      });
    };
    endResourceRace();

    // waitingFor[resource].length == 0
  };

  var promotionInterval = false;
  var closeAllSockets = function () {
    respondToCloseEvents = false;
    for (var i in oldServers) {
      oldServers[i].removeAllListeners('close');
      oldServers[i].removeAllListeners('data');
      oldServers[i].removeAllListeners('error');
      oldServers[i].end();
    }
    for (var i in newServers) {
      newServers[i].removeAllListeners('close');
      newServers[i].removeAllListeners('data');
      newServers[i].removeAllListeners('error');
      newServers[i].end();
    }
    oldServers = [];
    newServers = [];

    clearInterval(promotionInterval);
    setTimeout(function () {
      respondToCloseEvents = true;
    }, clientReconnectDelay*2);
  };

  // Start the incoming server, which receives 'readyFor' messages from the new server(s)
  this.start = function () {
    var onNewConnection = function (socket) {
      // Respond to socket being closed
      // The socket, at this point, could be either in "newServers" or "oldServers"
      var socketCloseResponse = function (msg) {
        var newServerIndex = newServers.indexOf(socket);
        var oldServerIndex = oldServers.indexOf(socket);
        if (newServerIndex !== -1) newServers.splice(newServerIndex, 1);
        if (oldServerIndex !== -1) oldServers.splice(oldServerIndex, 1);
        console.log('ServerSwap Server ['+process.pid+']:',(newServerIndex !== -1 ? 'New' : 'Old'),'client died unexpectedly:', msg, ' New servers left: ',newServers.length, ' Old servers left: ',oldServers.length)

        if (respondToCloseEvents === false) return;

        var checkForDeployFailure = function () {
          require('child_process').exec('ps aux | grep -v grep | grep "'+watchPIDs.join('\\|')+'"', function (error, stdout, stderr) {
            if (!(stdout || stderr) || watchPIDs.length === 0) {
              console.log('ServerSwap Server ['+process.pid+']: Deploy mode: all clients died. All watched PIDs gone: ', watchPIDs.join(', ')+'.', ' Quitting.')
              process.exit(0);
            } else {
              setTimeout(checkForDeployFailure, clientReconnectDelay*2);
            }
          });
        };

        if (deployMode) {
          setTimeout(checkForDeployFailure, clientReconnectDelay*2);
        }
      };

      socket.on('data', function (data) {
        parseIncomingSocketData(data, onData)
      });
      var onData = function (data) {
        if (data.noop) {
          return;
        } else if (data.goAway) {
          if (data.goAway != process.pid) {
            console.log('ServerSwap Server ['+process.pid+']: being replaced by',data.goAway)
            tcpServer.close();
            if (!deployMode) {
              process.exit();
            }
          }
        } else if (data.oldServer) {
          socket.pid = data.oldServer;
          oldServers.push(socket);
          console.log('ServerSwap Server ['+process.pid+']: Older running server detected at PID:', data.oldServer)

          socket.on('close', socketCloseResponse);
          socket.on('error', function (e) {
            console.log('ServerSwap Server ['+process.pid+']: Error writing to old socket.',e)
          });
        } else if (data.newServer) {
          socket.pid = data.newServer;
          newServers.push(socket);
          console.log('ServerSwap Server ['+process.pid+']: New client found at PID: ', data.newServer)

          // If a new server disconnects with us before the process exits, something bad happened
          socket.on('close', socketCloseResponse);
          socket.on('error', function (e) {
            console.log('ServerSwap Server ['+process.pid+']: Error writing to new socket.', e)
          });
        } else if (data.serverUp && deployMode) {
          console.log('ServerSwap Server ['+process.pid+']: Deploy Succeeded.')
          promoteAllNewServers();
        } else if (data.fail && deployMode) {
          if (newServers.indexOf(socket) !== -1) {
            newServers.splice(newServers.indexOf(socket), 1);
          }
          if (newServers.length === 0) {
            console.log('ServerSwap Server ['+process.pid+']: Deploy Failed.')

            closeAllSockets();
            process.nextTick(function () {
              process.exit(0);
            });
          }
        } else {
          setTimeout(function () {
            if (data.waitingFor) {
              releaseResource(data.waitingFor, socket);
            } else if (data.resourceFreed) {
              if (!waitingFor[data.resourceFreed]) return;
              if (waitingFor[data.resourceFreed].freedBy.indexOf(socket.pid) === -1) {
                waitingFor[data.resourceFreed].freedBy.push(socket.pid);
              }
              if (waitingFor[data.resourceFreed].freedBy.length >= oldServers.length || data.had) {
                resourceReady(data.resourceFreed);
                startServerPromotion();
              }
            }
          }, clientReconnectDelay*2)
        }
      }
    };
    var tcpServer = net.createServer(onNewConnection);

    // Kill any other ServerSwap daemons that might be around
    var connectAttempts = 0;
    var tryConnectingAsDaemon = function () {
      connectAttempts++;

      var otherDaemon = net.Socket();
      otherDaemon.connect(serverPort, function () {
        otherDaemon.write(JSON.stringify({ goAway: process.pid })+"\n");
        otherDaemon.end();
        process.nextTick(tryConnectingAsDaemon);
      });
      otherDaemon.on('error', function () {
        tcpServer.listen(serverPort);
        console.log('ServerSwap Server ['+process.pid+']: Connected to',':'+serverPort,'after',connectAttempts,'attempts.')
      });
    };
    tcpServer.on('error', function () {
      tryConnectingAsDaemon();
    });
    process.nextTick(tryConnectingAsDaemon);

    // Promote new servers when all the old servers are gone
    var startServerPromotion = function () {
      promotionInterval = setInterval(function () {
        if (oldServers.length === 0 && newServers.length > 0) {
          console.log('ServerSwap Server ['+process.pid+']: All old clients died; promoting', newServers.length, 'new clients(s).')
          promoteAllNewServers();

          // Respond to all waitingFor listeners
          waitingFor = {};
          for (var resource in waitingFor) {
            resourceReady(resource);
          }
        }
      }, clientReconnectDelay*2);
    };
    var promoteAllNewServers = function () {
      for (var i in newServers) {
        var server = newServers[i];
        watchPIDs.push(server.pid);
        try { 
          server.write(JSON.stringify({ promote: true })+"\n");
        } catch (e) {
          // Not sure if we should crash here or not.
          console.log('ServerSwap Server ['+process.pid+']: Could not promote new server, connection was severed.')
        }
      }
      closeAllSockets();
    };
  };
};
module.exports.server = server;

var client = function () {
  var promoted = false, promotedByDefault = false, reconnectFailed = false, disconnectedAt;
  var serverSocket = null, reconnecting = false;
  var waitingFor = {};
  var waitingToFree = {};
  var self = this;

  var resourceReady = function (resource) {
    if (!waitingFor[resource] || waitingFor[resource].length == 0) {
      delete waitingFor[resource];
      return;
    }
    var callback = waitingFor[resource].pop();
    try {
      console.log('ServerSwap Client ['+process.pid+']: Consuming resource',resource);
      callback();
    } catch (e) {
      console.log('ServerSwap Client ['+process.pid+']: Consuming resource',resource,'failed:',e);
      return self.fail();
    }

    process.nextTick(function () {
      resourceReady(resource);
    });
  }

  var socketWrite = function (data) {
    if (serverSocket && serverSocket.write && serverSocket.readable && serverSocket.writable) {
      serverSocket.write(data);
    } else {
      process.nextTick(function () {
        socketWrite(data);
      });
    }
  };

  var promote = function (byDefault, reason) {
    if (!promoted) {
      console.log('ServerSwap Client ['+process.pid+']: Promoting',reason);
    }
    promoted = true;
    promotedByDefault = byDefault || false;
  }

  this.start = function () {
    var reconnectToServerSocket = function () {
      if (serverSocket && serverSocket.readable && serverSocket.writable) return;
      if (reconnecting) return;

      reconnecting = true;
      serverSocket = net.Socket();
      serverSocket.connect(serverPort, function () {
        promotedByDefault && (promoted = false, promotedByDefault = false);
        reconnectFailed = false;
        disconnectedAt = false;
        reconnecting = false;
        serverSocket.write(JSON.stringify(promoted ? { oldServer: process.pid } : { newServer: process.pid })+"\n");

        // Are we waiting for anything already?
        for (var i in waitingFor) {
          if (waitingFor[i].length > 0) {
            console.log('ServerSwap Client ['+process.pid+']: Re-requesting',i);
            serverSocket.write(JSON.stringify({ waitingFor:i })+"\n");
          }
        }
      });
      serverSocket.on('data', function (data) {
        parseIncomingSocketData(data, onData);
      });
      serverSocket.on('error', function () {
        serverSocket = null;
        if (!disconnectedAt) disconnectedAt = new Date();
        reconnectFailed = true;
        reconnecting = false;
      });
      serverSocket.on('close', function () {
        serverSocket = null;
        if (!disconnectedAt) disconnectedAt = new Date();
        reconnectFailed = true;
        reconnecting = false;
      });
    };
    reconnectToServerSocket();

    var onData = function (data) {
      if (data.promote) {
        promote(false, 'by server');
      } else if (data.tooLate) {
        console.log('ServerSwap Client ['+process.pid+']: Too late, someone grabbed',data.tooLate,'while we were waiting. Race condition?');
        return process.exit(1);
      } else if (data.resourceReady) {
        return resourceReady(data.resourceReady);
      } else if (data.freeResource) {
        console.log('ServerSwap Client ['+process.pid+']: Freeing resource', data.freeResource);

        var onFreed = function (had) {
          console.log('ServerSwap Client ['+process.pid+']: Freed resource', data.freeResource);
          socketWrite(JSON.stringify({ resourceFreed: data.freeResource, hadResource: had })+"\n");
          waitingToFree[data.freeResource] = undefined;
        };

        if (!waitingToFree[data.freeResource]) return onFreed(false);

        try {
          async.map(waitingToFree[data.freeResource], function (freeResource, iter) {
            if (freeResource.length === 1) {
              return freeResource(function () {
                process.nextTick(function () {
                  iter(null, true);
                });
              });
            } else { 
              freeResource();
              return process.nextTick(function () {
                iter(null, true);
              });
            }
          }, function () {
            onFreed(true);
          });
        } catch (e) {
          console.log('ServerSwap Client ['+process.pid+']: Error freeing resource', e);
          return onFreed(true);
        }
      }
    }

    // Reconnect to server if necessary
    setInterval(function () {
      if (serverSocket === null) {
        reconnectToServerSocket();
      }
      if ((reconnectFailed || serverSocket === null) && (new Date() - disconnectedAt) > clientReconnectDelay*3) {
        promote(true, 'by default');
      }
    }, clientReconnectDelay);
  };
  this.readyFor = function (resource, callback) {
    waitingFor[resource] || (waitingFor[resource] = []);
    if (waitingFor[resource].indexOf(callback) === -1) waitingFor[resource].push(callback);

    // If the server socket is reconnecting, or hasn't connected yet, wait.
    if ((serverSocket === null || serverSocket._connecting || !serverSocket.readable) && !promoted) {
      return process.nextTick(function () {
        self.readyFor(resource, callback);
      });
    // If we've been promoted, we assume all resources are available to us
    } else if (promoted) {
      console.log('ServerSwap Client ['+process.pid+']: Reconnecting to socket failed, or we were promoted. Assume resource',resource,'is ready.');
      return process.nextTick(function () {
        resourceReady(resource);
      });
    } else {
      serverSocket.write(JSON.stringify({ waitingFor:resource })+"\n");
    }
  };
  this.onTakedown = function (resource, callback) {
    waitingToFree[resource] || (waitingToFree[resource] = []);
    waitingToFree[resource].push(callback);
  };
  this.serverUp = function () {
    socketWrite(JSON.stringify({ serverUp: process.pid })+"\n");
    promote(false, 'server up');
  };
  this.fail = function () {
    socketWrite(JSON.stringify({ fail: process.pid })+"\n");
  };
};
module.exports.client = client;
