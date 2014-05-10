var inherits = require("util").inherits;
var EventEmitter = require('events').EventEmitter;
var spawn = require('child_process').spawn;
var url = require('url');
var path = require('path');
var fs = require('fs');

var tmp = require("tmp");
var Q = require("q");
var _ = require("lodash");
var wrench = require('wrench');

var util = require('./util');

var gitRouter = {
    "GET" : /\/info\/refs\?service\=git-(receive|upload)-pack/,
    "POST" : /\/git-(receive|upload)-pack/
}

var GitPush = function(options) {
    this.options = _.defaults(options || {}, {

    });

    // Map of current bare repositories
    this.bareRepos = {};
};
inherits(GitPush, EventEmitter);


// Prepare a repository by its id for a push
// By default, we create a bare tmp repository
GitPush.prototype.prepareRepository = function(repoId) {
    return Q.nfcall(tmp.dir)
    .then(function(repoPath) {
        console.log("create:", repoPath);
        return util.execQ('git --bare init', {
            cwd: repoPath
        })
        .then(function() {
            return repoPath;
        });
    });
};

// Clean a repository after a push
GitPush.prototype.cleanRepository = function(repoId, repoPath) {
    console.log("clean:", repoPath);
    return Q.nfcall(wrench.rmdirRecursive, repoPath);
};

// Authenticate an user for a repository
GitPush.prototype.authenticate = function(infos) {
    console.log("Warning! You need to override 'authenticate(auth)' for git-stateless-push.")
    return false;
};

// Save an operation
// By default in memory, but can be save in a database
GitPush.prototype.bareSet = function(repoId, _path) {
    this.bareRepos[repoId] = _path;
};

// Get an operation
// By default in memory, but can be get in a database
GitPush.prototype.bareGet = function(repoId) {
    return this.bareRepos[repoId];
};


// Handle a request
GitPush.prototype.handle = function (req, res, next) {
    var that = this, service, repoPath;

    console.log("request:"+req.path);

    Q()
    .then(function() {
        var auth = util.extractAuth(req);

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

        // test if a bare repo already exists for this id
        return that.bareGet(req.repoId);

    })
    .then(function(_bare) {
       if (_bare) return _bare;

        return Q(that.prepareRepository(req.repoId))
        .then(function(_repoPath) {
            return Q(that.bareSet(req.repoId, _repoPath))
            .then(function() {
                return _repoPath;
            })
        });
    })
    .then(function(_bare) {
        repoPath = _bare;
    })
    .then(function() {
        // Extract request infos
        var match = req.url.match(gitRouter[req.method]);
        service = 'git-' + match[1] + '-pack';

        if (service == "git-upload-pack") {
            throw "Only Push is available for this GIT url";
        }

        // Set headers
        res.setHeader('Expires', 'Fri, 01 Jan 1980 00:00:00 GMT');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Cache-Control', 'no-cache, max-age=0, must-revalidate');
        res.setHeader('Content-Type', 'application/x-' + service + '-advertisement');

        // Setup body of response to GET /:namespace/info/refs
        if (req.method == 'GET') {
            res.write(util.pack('# service=' + service + '\n'));
            res.write('0000');
        }

        // Run git method
        console.log("execute: ", req.method ,service);
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
        console.log(e.stack || e);

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
