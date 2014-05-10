var Q = require("q");
var exec = require('child_process').exec;
var spawn = require('child_process').spawn;
var tmp = require("tmp");

var pack = function(s) {
    var n = (4 + s.length).toString(16);
    return Array(4 - n.length + 1).join('0') + n + s;
}

var extractAuth = function(req) {
    var ret = {
        repoId: req.repoId
    };

    if (req.header('Authorization')) {
        var auth = new Buffer(req.header('Authorization').replace('Basic ', ''), 'base64').toString('ascii').split(':');
        ret.username = auth[0];
        ret.password = auth[1];
    }

    return ret;
};

var execQ = function(command, options) {
    var d = Q.defer();
    var child = exec(command, options, function (error, stdout, stderr) {
        if (error) return d.reject(error);
        d.resolve({
            stdout: stdout,
            stderr: stderr
        })
    });

    return d.promise;
};

var spawnQ = function(command, args, options) {
    var d = Q.defer();

    var cmd = spawn(command, args, options);
    cmd.on('exit', function () {
        d.resolve();
    });

    setTimeout(function() {
        d.notify(cmd)
    });

    return d.promise;
};

module.exports = {
    execQ: execQ,
    spawnQ: spawnQ,
    extractAuth: extractAuth,
    pack: pack,
    tmpDir: Q.nfbind(tmp.dir)
};
