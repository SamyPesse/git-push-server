var GitPush = require("./");
var express = require("express");
var path = require("path");

// Create the http application
var app = express();

// Create the git-push server
var git = new GitPush();

// Create a router for the git-push server
var router = express.Router();

// Start the git server on the router
git.start(router);

git.authenticate = function() { return true; };
git.repository = function() { return path.join(__dirname, "testgit"); };

// Bind the router to the app
app.use('/:author/:repo.git', function(req, res, next) {
    // Needed to identify the repository
    req.repoId = [req.params.author, req.params.repo].join("/");
    next();
});
app.use('/:author/:repo.git', router);

// Start the http server
var server = app.listen(3000, function() {
    console.log('Listening on port %d', server.address().port);
});
