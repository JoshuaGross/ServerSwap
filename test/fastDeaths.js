var spawn = require('child_process').spawn
  , expect = require('expect.js')
  , sinon = require('sinon')
  , async = require('async')
  , ms = require('ms');

function grepForProcess  (search, cb) {
  require('child_process').exec('ps aux | grep -v grep | grep -v vim | grep -v emacs | grep '+search, function (error, stdout, stderr) {
    var output = (stdout+stderr).replace(/[\s\n]+$/,'').split(/[\r\n]+/);
    if (output[output.length-1] === '') {
      output = output.splice(0, output.length - 2);
    }
    return cb(error, output);
  });
}

// calls the callback with (PID of deployer, PID of server)
function spawnServerDeploy (cb) {
  var newServer = spawn('serverswap-deploy', ['./example/simple-webserver.js']);
  var newServerExited = false;
  var replaced = false;

  newServer.stderr.on('data', function (data) {
    var line = data.toString().replace(/[\s\n]+$/,'');
    console.log('stderr:', line);
    if (/EMFILE/.test(line)) {
      cb && cb(newServer.pid, undefined);
      cb = null;
    }
  });
  newServer.stdout.on('data', function (data) {
    var line = data.toString().replace(/[\s\n]+$/,'');
    console.log('stdout:', line);
    var match = line.match(/Older running server detected at PID: ([0-9]+)/);
    if (match) {
      cb && cb(newServer.pid, match[1]);
      cb = null;
    }

    if (line.indexOf('being replaced by') !== -1) {
      replaced = true;
    }
  });
  newServer.on('exit', function (code, signal) {
    newServerExited = true;
    cb && cb(newServer.pid);
    cb = null;
  });

  // we only do this because sometimes a certain server will /not/ be the one to release
  // a resource to its own child
  var checkSuccessfulDeploy = function () {
    if (replaced) {
      try {
        grepForProcess('simple-webserver', function (error, output) {
          if (output.length === 2) {
            cb && cb(newServer.pid);
            cb = null;
          }
        });
      } catch (e) {
        console.log('Test caught error attempting to grep for process: ', e);
      }
    }
    if (cb) {
      setTimeout(checkSuccessfulDeploy, 2500);
    }
  };
  setTimeout(checkSuccessfulDeploy, 2500);
}

// 
var checkPort8080_runInterval;
var failures = 0;
function checkPort8080 () {
  if (!checkPort8080_runInterval) {
    checkPort8080_runInterval = setInterval(checkPort8080_run, 20);
  }
}
function stopCheckPort8080 () {
  clearInterval(checkPort8080_runInterval);
  checkPort8080_runInterval = null;
}
function checkPort8080_run () {
  var http = require('http');
  return http.get('http://localhost:8080', function (res) {
    failures = 0;
  }).on('error', function (e) {
    failures++;
    expect(failures).to.be.lessThan(12); // <240ms of downtime
  });
}

describe('serverswap error recovery when spawning many things relatively quickly', function () {
  var serverswapDeployPIDs = [];
  var serverPIDs = [];

  for (var i = 1; i < 100; i += i) {
    (function (i) {
      it('should spawn and fatally kill '+i+' servers repeatedly; there should be 1 live process and 1 live deploy at the end', function (done) {
        this.timeout(0);

        async.timesSeries(i, function (j, next) {
          spawnServerDeploy(function (deployerPID, serverPID) {
            console.log(j, deployerPID, serverPID)
            if (j === (i-1)) {
              next();
            } else {
              require('child_process').exec('kill -9 '+serverPID, function (error, stdout, stderr) {
                next();
              });
            }
          });
        }, function () {
          grepForProcess('simple-webserver', function (error, output) {
            console.log(output);
            expect(output.length).to.be(2);
            done();
          });
        })

      });
    })(i);
  }
});

describe('serverswap stability', function () {
  var serverswapDeployPIDs = [];
  var serverPIDs = [];

  (function (i) {
    it('should spawn '+i+' servers repeatedly. localhost:8080 should never go down.', function (done) {
      this.timeout(0);

      async.timesSeries(i, function (j, next) {
        spawnServerDeploy(function (deployerPID, serverPID) {
          checkPort8080();
          var timer = Math.random()*6*500;
          console.log('wait',timer,'ms...')
          setTimeout(next, timer);
        });
      }, function () {
        setTimeout(function () {
          grepForProcess('simple-webserver', function (error, output) {
            console.log(output);
            expect(output.length).to.be(2);
            stopCheckPort8080();
            done();
          });
        }, 7000);
      })

    });
  })(100);
});

// this should test race conditions where many servers "grab" a resource at once.
// the next way to make this a little more robust would be to verify that port :8080 is always occupied
describe('serverswap error recovery when spawning many things at once', function () {
  var serverswapDeployPIDs = [];
  var serverPIDs = [];

  for (var i = 1; i < 100; i += i) {
    (function (i) {
      it('should spawn '+i+' servers simultaneously; there should be 1 live process and 1 live deploy at the end', function (testDone) {

        var done = function () {
          stopCheckPort8080();
          testDone();
        };

        this.timeout(0);

        async.times(i, function (i, next) {
          spawnServerDeploy(function (deployerPID, serverPID) {
            checkPort8080();
            console.log(i, deployerPID, serverPID)
            next();
          });
        }, function () {
          var check = function () {
            grepForProcess('simple-webserver', function (error, output) {
              console.log(output);
              expect(output.length).to.be(2);
              done();
            });
          };

          if (i > 8) {
            setTimeout(check, 1000);
          } else {
            check();
          }
        })

      });
    })(i);
  }
});
