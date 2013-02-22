var spawn = require('child_process').spawn
  , expect = require('expect.js')
  , sinon = require('sinon')
  , ms = require('ms');

var grepForProcess = function (search, cb) {
  require('child_process').exec('ps aux | grep -v grep | grep -v vim | grep -v emacs | grep '+search, function (error, stdout, stderr) {
    var output = (stdout+stderr).replace(/[\s\n]+$/,'').split(/[\r\n]+/);
    if (output[output.length-1] === '') {
      output = output.splice(0, output.length - 2);
    }
    return cb(error, output);
  });
}

describe('serverswap with test/server.js', function () {
  var serverswapDeployPIDs = [];
  var serverPIDs = [];

  it('should start up a server serverswap-deploy and it should bind to port 8080', function (done) {
    this.timeout(7500);

    var newServer = spawn('serverswap-deploy', ['./example/simple-webserver.js']);
    var newServerExited = false;

    newServer.stderr.on('data', function (data) {
      console.log('stderr:', data.toString().replace(/[\s\n]+$/,''));
    });
    newServer.stdout.on('data', function (data) {
      console.log('stdout:', data.toString().replace(/[\s\n]+$/,''));
    });
    newServer.on('exit', function (code, signal) {
      expect(code).to.be(null); // should not reach here; why is the new server exiting?
      newServerExited = true;
    });

    setTimeout(function () {
      grepForProcess('simple-webserver', function (error, output) {
        // there should be two lines displaying that simple-webserver.js is being run by node, and serverswap-deploy
        expect(output.length).to.be(2);

        var line1 = output[0].split(/\s+/);
        var line2 = output[1].split(/\s+/);

        if (line1[11] === 'node') serverPIDs.push(line1[1]);
        if (line1[11].indexOf('serverswap-deploy') !== -1) serverswapDeployPIDs.push(line1[1]);
        if (line2[11] === 'node') serverPIDs.push(line2[1]);
        if (line2[11].indexOf('serverswap-deploy') !== -1) serverswapDeployPIDs.push(line2[1]);

        expect(newServerExited).to.be(false);

        newServer.removeAllListeners('exit');

        done();
      });
    }, 6000);
  });

  it('should start up a second server and close down the old one', function (done) {
    this.timeout(7500);

    var newServer = spawn('serverswap-deploy', ['./example/simple-webserver.js']);
    var newServerExited = false;

    newServer.stderr.on('data', function (data) {
      console.log('stderr:', data.toString().replace(/[\s\n]+$/,''));
    });
    newServer.stdout.on('data', function (data) {
      console.log('stdout:', data.toString().replace(/[\s\n]+$/,''));
    });
    newServer.on('exit', function (code, signal) {
      expect(code).to.be(null); // should not reach here; why is the new server exiting?
      newServerExited = true;
    });

    setTimeout(function () {
      // We make sure that both the old server and its "deployer" have exited, otherwise something went wrong
      // and they're still hanging around.
      grepForProcess(serverPIDs[0], function (error, output) {
        expect(output.length).to.be(0); // simple-server dead; good

        grepForProcess(serverswapDeployPIDs[0], function (error, output) {
          expect(output.length).to.be(0); // deployer dead; good

          grepForProcess('simple-webserver', function (error, output) {
            // there should be two lines displaying that simple-webserver.js is being run by node, and serverswap-deploy
            expect(output.length).to.be(2);

            var line1 = output[0].split(/\s+/);
            var line2 = output[1].split(/\s+/);

            if (line1[11] === 'node') serverPIDs.push(line1[1]);
            if (line1[11].indexOf('serverswap-deploy') !== -1) serverswapDeployPIDs.push(line1[1]);
            if (line2[11] === 'node') serverPIDs.push(line2[1]);
            if (line2[11].indexOf('serverswap-deploy') !== -1) serverswapDeployPIDs.push(line2[1]);

            expect(newServerExited).to.be(false);

            newServer.removeAllListeners('exit');

            done();
          });
        });
      });

    }, 6000);
  });

  it('should start up a second server and close down the old one... again!', function (done) {
    this.timeout(7500);

    var newServer = spawn('serverswap-deploy', ['./example/simple-webserver.js']);
    var newServerExited = false;

    newServer.stderr.on('data', function (data) {
      console.log('stderr:', data.toString().replace(/[\s\n]+$/,''));
    });
    newServer.stdout.on('data', function (data) {
      console.log('stdout:', data.toString().replace(/[\s\n]+$/,''));
    });
    newServer.on('exit', function (code, signal) {
      expect(code).to.be(null); // should not reach here; why is the new server exiting?
      newServerExited = true;
    });

    setTimeout(function () {
      // We make sure that both the old server and its "deployer" have exited, otherwise something went wrong
      // and they're still hanging around.
      grepForProcess(serverPIDs[0], function (error, output) {
        expect(output.length).to.be(0); // simple-server dead; good

        grepForProcess(serverswapDeployPIDs[0], function (error, output) {
          expect(output.length).to.be(0); // deployer dead; good

          grepForProcess('simple-webserver', function (error, output) {
            // there should be two lines displaying that simple-webserver.js is being run by node, and serverswap-deploy
            expect(output.length).to.be(2);

            var line1 = output[0].split(/\s+/);
            var line2 = output[1].split(/\s+/);

            if (line1[11] === 'node') serverPIDs.push(line1[1]);
            if (line1[11].indexOf('serverswap-deploy') !== -1) serverswapDeployPIDs.push(line1[1]);
            if (line2[11] === 'node') serverPIDs.push(line2[1]);
            if (line2[11].indexOf('serverswap-deploy') !== -1) serverswapDeployPIDs.push(line2[1]);

            expect(newServerExited).to.be(false);

            newServer.removeAllListeners('exit');

            done();
          });
        });
      });

    }, 6000);
  });
})
