var tmp = require("tmp");
var Q = require("q");
var _ = require("lodash");

var util = require("util");
var EventEmitter = require('events').EventEmitter;

var exec = require('child_process').exec;
var spawn = require('child_process').spawn;
var url = require('url');
var path = require('path');
var fs = require('fs');


var pack = function(s) {
    var n = (4 + s.length).toString(16);
    return Array(4 - n.length + 1).join('0') + n + s;
}

var gitRouter = {
    "GET" : /\/info\/refs\?service\=git-(receive|upload)-pack/,
    "POST" : /\/git-(receive|upload)-pack/
}

var GitPush = function(options) {
    this.options = _.defaults(options || {}, {

    });
};
util.inherits(GitPush, EventEmitter);

GitPush.prototype.repository = function(repoId) {
    console.log("Warning! You need to override 'repository(repoId)' for git-stateless-push.")
    throw "Invalid repository";
};

GitPush.prototype.authenticate = function(infos) {
    console.log("Warning! You need to override 'authenticate(auth)' for git-stateless-push.")
    return false;
};

GitPush.prototype.extractAuth = function(req) {
    var ret = {
        repoId: req.repoId
    };

    if (req.header('Authorization')) {
        var auth = new Buffer(req.header('Authorization').replace('Basic ', ''), 'base64').toString('ascii').split(':');
        ret.username = auth[0];
        ret.password = auth[1];
    }

    return ret;
}

// Handle a request
GitPush.prototype.handle = function (req, res, next) {
    var that = this, service;

    Q()
    .then(function() {
        var auth = that.extractAuth(req);

        // Filter invalid request
        if (req.method != 'GET' && req.method != 'POST') throw "Invalid HTTP method";
        if (!gitRouter[req.method].test(req.url)) throw "Invalid GIT operation";
        if (!req.repoId)  throw "Invalid Repository";

        return that.authenticate(auth);
    })
    .then(function(state) {
        if (!state) {
            var e = new Error('Authorization Required');
            e.code = 401;
            return Q.reject(e);
        }

        // Get path for the associated repositoy
        return that.repository(req.repoId);
    })
    .then(function(repoPath) {
        // Extract request infos
        var match = req.url.match(gitRouter[req.method]);
        service = 'git-' + match[1] + '-pack';

        // Set headers
        res.setHeader('Expires', 'Fri, 01 Jan 1980 00:00:00 GMT');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Cache-Control', 'no-cache, max-age=0, must-revalidate');
        res.setHeader('Content-Type', 'application/x-' + service + '-advertisement');

        // Setup body of response to GET /:namespace/info/refs
        if (req.method == 'GET') {
            res.write(pack('# service=' + service + '\n'));
            res.write('0000');
        }

        // Run git method
        var args = _.compact([
            '--stateless-rpc',
            req.method == 'GET' ? '--advertise-refs' : null,
            repoPath
        ]);

        var git = spawn('/usr/bin/' + service, args);

        req.pipe(git.stdin);
        git.stdout.pipe(res);
        git.on('exit', function () {
            res.end();
        });
    })
    .fail(function(e) {
        if (e.code == 401) {
            res.statusCode = 401;
            res.setHeader('WWW-Authenticate', 'Basic realm="Authorization Required"');
            res.end('Unauthorized');
        } else {
            res.send(e.code || 500, e.message || e);
        }
    });
};


// Start the handling on a router
GitPush.prototype.start = function(router) {
    router.use(this.handle.bind(this));
};

module.exports = GitPush;
