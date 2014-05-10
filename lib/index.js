var inherits = require("util").inherits;
var EventEmitter = require('events').EventEmitter;
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
        debug: false
    });

    // Map of current bare repositories
    this.bareRepos = {};
};
inherits(GitPush, EventEmitter);

// Authenticate an user for a repository
GitPush.prototype.log = function() {
    if (!this.options.debug) return;
    console.log.apply(console, arguments);
};


// Prepare a repository by its id for a push
// By default, we create a bare tmp repository
GitPush.prototype.prepareRepository = function(repoId) {
    var that = this;

    return Q.nfcall(tmp.dir)
    .then(function(repoPath) {
        that.log("create:", repoPath);
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
    this.log("clean:", repoPath);
    return Q.nfcall(wrench.rmdirRecursive, repoPath);
};

// Authenticate an user for a repository
GitPush.prototype.authenticate = function(infos) {
    return true;
};

// Save a bare repository in the index
// By default in memory, but can be save in a database
GitPush.prototype.bareSet = function(repoId, _path) {
    this.bareRepos[repoId] = _path;
};

// Get a bar repository from the index
// By default in memory, but can be get in a database
GitPush.prototype.bareGet = function(repoId) {
    return this.bareRepos[repoId];
};

// Delete a bare repository from the index
GitPush.prototype.bareDel = function(repoId) {
    this.bareRepos[repoId] = null;
};

// On push
GitPush.prototype.push = function(pushInfos) {
    this.log("push: ", pushInfos);
    return Q();
};

// Run push
GitPush.prototype.runPush = function(pushInfos) {
    var that = this;

    // Clone bare
    return Q.nfcall(tmp.dir)
    .then(function(contentPath) {
        pushInfos.content = contentPath

        return util.execQ("git clone "+pushInfos.bare, {
            cwd: contentPath
        });
    })

    // Run operation
    .then(function() {
        return that.push(pushInfos);
    })

    // Clean repository
    .fin(function() {
        that.log("cleanpush:", pushInfos);
        return Q.all([
            Q.nfcall(wrench.rmdirRecursive, pushInfos.content),
            that.cleanRepository(pushInfos.repoId, pushInfos.bare),
            Q(that.bareDel(pushInfos.repoId))
        ])
    })
};


// Handle a request
GitPush.prototype.handle = function (req, res, next) {
    var that = this, service, repoPath, auth;

    that.log("request:"+req.path);

    Q()
    .then(function() {
        auth = util.extractAuth(req);

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
        that.log("execute: ", req.method ,service);
        var args = _.compact([
            '--stateless-rpc',
            req.method == 'GET' ? '--advertise-refs' : null,
            repoPath
        ]);

        return util.spawnQ('/usr/bin/' + service, args)
        .progress(function(git) {
            req.pipe(git.stdin);
            git.stdout.pipe(res);
        });
    })
    .then(function() {
        if (req.method == "POST") {
            return that.runPush({
                'repoId': req.repoId,
                'auth': auth,
                'bare': repoPath
            });
        }
    })
    .then(function() {
        res.end();
    }, function(e) {
        that.log("Error", e.stack || e);

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
    this.log("start");
    router.use(this.handle.bind(this));
};

module.exports = GitPush;
