#!/usr/bin/env node

/*
 * chili
 * https://github.com/sackio/chili
 *
 * Copyright (c) 2014 Ben Sack
 * Licensed under the MIT license.
 */


var Path = require('path')
  , Optionall = require('optionall')
  , Crypto = require('crypto')
  , Child_Process = require('child_process')
  , FSTK = require('fstk')
  , Async = require('async')
  , _ = require('underscore')
  , Belt = require('jsbelt')
  , Util = require('util')
  , OS = require('os')

    //express and middleware
  , Express = require('express')
  , HTTP = require('http')
  , HTTPS = require('https')
  , Sessions = require('express-session')
  , Redis_Sessions = require('connect-redis')(Sessions)
  , Morgan = require('morgan')
  , Body_Parser = require('body-parser')
  , Cookie_Parser = require('cookie-parser')
  , Error_Handler = require('errorhandler')
  , Passport = require('passport')
  , Passport_HTTP = require('passport-http').BasicStrategy

;

module.exports = function(O){
  var Opts = O || new Optionall({
                                  '__dirname': Path.resolve(module.filename + '/../..')
                                });

  var S = {};
  S.settings = Belt.extend({
    'port': 8000
  , 'session_secret': Crypto.randomBytes(1024).toString('base64')
  , 'cookie_secret': Crypto.randomBytes(1024).toString('base64')
  , 'body_parser': {'limit': '500mb', 'extended': true}
  , 'redis': {}
  , 'cwd': '/'
  , 'users': []
  , 'uid': 1000
  }, Opts.express, Opts);
  S.settings = _.defaults(S.settings, {
    'sessions': {
      'store': new Redis_Sessions(S.settings.redis)
    , 'secret': S.settings.session_secret
    , 'cookie': {'maxAge': 60000000}
    , 'key': S.settings.session_key
    , 'saveUninitialized': true
    , 'resave': true
    }
  });

  //SERVER SETTINGS
  S.app = Express();
  S.app.set('port', S.settings.port);
  S.app.set('trust proxy', true);

  //MIDDLEWARE
  //TODO - add user access

  if (S.settings.environment !== 'production') S.app.use(Error_Handler());
  S.app.use(Morgan('dev')); //logging
  S.app.use(/^(?!\/ps)|^(?!\/fs)/, Body_Parser.json(S.settings.body_parser));
  S.app.use(/^(?!\/ps)|^(?!\/fs)/, Body_Parser.urlencoded(S.settings.body_parser));

  S.app.use(Cookie_Parser(S.settings.cookie_secret));
  S.app.use(Sessions(S.settings.sessions)); //sessions

  //Authentication middleware
  if (S.settings.authenticate){
    if (!_.any(S.settings.user)) throw new Error('Users must be included for authentication');

    S.app.use(Passport.initialize());

    Passport.use(new Passport_HTTP({}, 
      function(username, password, done){
        var user = _.find(S.settings.users, function(u){ return u.user === username && u.password === password; });

        if (!user) return done(null, false);
        return done(null, user);
      }
    ));

    Passport.serializeUser(function(user, done) {
      return done(null, user);
    });
    Passport.deserializeUser(function(user, done) {
      return done(null, user);
    });

    //allow and disallow url regexes
    S.app.all('*', Passport.authenticate('basic'), function(request, response, next){
      var allow = Belt._get(request, 'user.allow');
      if (allow && !Belt._call(request, 'originalUrl.match', new RegExp(allow))) return response.status(500)
                                                                                        .end('User is not authorized to request this url');
      var disallow = Belt._get(request, 'user.disallow');
      if (disallow && Belt._call(request, 'originalUrl.match', new RegExp(disallow))) return response.status(500)
                                                                                             .end('User is not authorized to request this url');
      return next();
    });
  }

  //UTILITIES
  //cascade request data into one object
  S['request_data'] = function(request){
    return Belt.extend({},[Belt._get(request, 'params')
                         , Belt._get(request, 'query')
                         , Belt._get(request, 'body')
                         , Belt._get(request, 'session')
                         , {
                             'params': Belt._get(request, 'params')
                           , 'query': Belt._get(request, 'query')
                           , 'body': Belt._get(request, 'body')
                           , 'session': Belt._get(request, 'session')
                           }]
                      );
  };

  S['get_user_environment'] = function(uid, options, callback){
    var a = Belt.argulint(arguments)
      , self = this;
    a.o = _.defaults(a.o, {
    
    });

    return Child_Process.exec('sudo -u \\#' + uid + ' printenv', function(err, stdout, stderr){
      if (!err && stderr) err = new Error(stderr.toString());
      if (err) return a.cb(err);

      var env = {};
      _.each(stdout.toString().split(/[\n\r]+/), function(e){
        var v = e.split('=')
          , k = v[0];
        if (!k) return;
        v.shift();
        v = v.join('=');
        if (!v) return;
        return env[k] = v;
      });

      return a.cb(err, env);
    });
  };

  //ROUTES

  /*
    Evaluate code in the context of this process
  */
  S.app.all('/eval', function(request, response){
    var self = this
      , data = S.request_data(request)
      , o = _.defaults(data, {
        'command': data.command || data.cmd || data.code
      });

    try{
      return response.status(200).json(eval(o.command));
    } catch(err) {
      return response.status(200).json({'error': Belt._get(err, 'message')});
    }
  });

  /*
    Execute a command on the server
  */
  S.app.all('/exec', function(request, response){
    var self = this
      , data = S.request_data(request)
      , o = _.defaults(data, {
          'command': data.command || data.cmd
        , 'cwd': S.settings.cwd
        , 'maxBuffer': Infinity
        , 'encoding': 'utf8'
        , 'uid': S.settings.uid
        });

    o.paths = ['cwd', 'env', 'encoding', 'timeout', 'maxBuffer', 'killSignal'];

    if (!o.command) return response.status(200).json({
      'error': 'command is required'
    });

    o.command = 'sudo -u \\#' + o.uid + ' ' + o.command;

    var gb = {};
    return Async.waterfall([
      function(cb){
        return S.get_user_environment(o.uid, Belt.cs(cb, gb, 'env', 1, 0));
      }
    , function(cb){
        o.env = Belt.extend(o.env || {}, gb.env);
        return cb();
      }
    ], function(err){
      if (err) return response.status(200).json({
        'error': Belt._get(err, 'message')
      });

      return Child_Process.exec(o.command, _.pick(o, o.paths)
      , function(err, stdout, stderr){
        return response.status(200).json({
          'error': Belt._get(err, 'message')
        , 'stdout': Belt._call(stdout, 'toString', o.encoding)
        , 'stderr': Belt._call(stderr, 'toString', o.encoding)
        });
      });
    });
  });

  /*
    Spawn a process on the server - includes the following options:
      -all options for Node's child_process.spawn
      -stdin - passing this will use the request as a readable stream used as stdin for the process
      -autokill - kill the process when request ends (defaults to false)
      -stream - stream back stdout in response (no markup). Pass 'stderr' to stream stderr
  */
  S.app.all('/ps', function(request, response){
    var self = this
      , data = S.request_data(request)
      , o = _.defaults(data, {
          'command': data.command || data.cmd
        , 'args': data.args || data.arguments || data.argv || []
        , 'cwd': S.settings.cwd
        , 'encoding': 'utf8'
        , 'content_type': 'text/plain'
        , 'uid': S.settings.uid
        })
      , headers = {
          'Content-Type': o.content_type
        , 'Transfer-Encoding': 'chunked'
        , 'Connection': 'Keep-Alive'
        }
      , ended = false, err = false;

    o.paths = ['cwd', 'env', 'stdio', 'detached', 'uid', 'gid'];
    if (o.args) o.args = Belt.toArray(o.args);

    if (o.uid) o.uid = parseInt(o.uid);
    if (o.gid) o.gid = parseInt(o.gid);

    response.on('end', function(){
      if (!ended && o.autokill) Belt._call(cp, 'kill', o.autokill);
      return ended = true; 
    });

    _.each(headers, function(v, k){ return response.set(k, v); });
    response.status(200);

    if (!o.command){
      if (ended) return;
      response.write(['<error>command is required</error>\r'].join(''));
      return response.end();
    }

    var gb = {}, cp;

    return Async.waterfall([
      function(cb){
        return S.get_user_environment(o.uid, Belt.cs(cb, gb, 'env', 1, 0));
      }
    , function(cb){
        o.env = Belt.extend(o.env || {}, gb.env);
        return cb();
      }
    ], function(err){
      if (err){
        response.write(['<error>', Belt._get(err, 'message'), ' | '
                       , Belt._get(err, 'code'), '</error>\r'].join(''));
        return response.end();
      }

      cp = Child_Process.spawn(o.command, o.args, _.pick(o, o.paths));

      return setImmediate(function(){
        if (o.stdin) request.pipe(cp.stdin); //pipe in the stdin

        if (o.stream && o.stream === 'stderr') return cp.stderr.pipe(request);
        if (o.stream) return cp.stdout.pipe(request);

        cp.on('error', function(err){
          if (ended) return;
          return response.write(['<error>', Belt._get(err, 'message'), ' | '
                                , Belt._get(err, 'code'), '</error>\r'].join(''));
        });

        if (!o.quiet) cp.stderr.on('data', function(data){
          if (ended) return;
          return response.write(['<stderr>', Belt._call(data, 'toString', o.encoding), '</stderr>\r'].join(''));
        });

        if (!o.quiet) cp.stdout.on('data', function(data){
          if (ended) return;
          return response.write(['<stdout>', Belt._call(data, 'toString', o.encoding), '</stdout>\r'].join(''));
        });

        cp.on('exit', function(code, signal){
          if (ended) return;
          return response.write(['<exit>', code , ' | ', signal, '</exit>\r'].join(''));
        });

        cp.on('close', function(code, signal){
          if (ended) return;
          ended = true;
          response.write(['<close>', code , ' | ', signal, '</close>\r'].join(''));
          return response.end();
        });

        if (ended) return;

        return response.write(['<pid>', Belt._get(cp, 'pid'), '</pid>\r'].join(''));
      });
    });
  });

  S.app.get('/', function(request, response){
    return response.status(200).json({
      'chili': {
        'environment': S.settings.environment.toUpperCase()
      , 'port': S.app.get('port')
      , 'upload_path': S.settings.upload_path
      , 'authenticate': S.settings.authenticate
      , 'ssl': (S.settings.key && S.settings.crt ? true : false)
      }
    , 'os': _.object(['hostname', 'type', 'platform', 'arch', 'release', 'uptime'
                     , 'loadavg', 'totalmem', 'freemem', 'cpus', 'networkinterfaces'
                     , 'tmpdir','endianness']
                     , _.map(['hostname', 'type', 'platform', 'arch', 'release', 'uptime'
                             , 'loadavg', 'totalmem', 'freemem', 'cpus', 'networkInterfaces'
                             , 'tmpdir','endianness'], function(o){ return OS[o](); }))
    });
  });

  //END ROUTES

  if (S.settings.key && S.settings.crt){
    //START HTTPS
    S.settings.ssl = {
      'key': FSTK._fs.readFileSync(Path.resolve(S.settings.key))
    , 'cert': FSTK._fs.readFileSync(Path.resolve(S.settings.crt))
    , 'requestCert': false
    , 'rejectUnauthorized': false
    };

    S.server = HTTPS.createServer(S.settings.ssl, S.app).listen(S.app.get('port'), function(){
      console.log('[%s] Express HTTPS server started:', S.settings.name);
      return console.log(JSON.stringify({
        'environment': S.settings.environment.toUpperCase()
      , 'port': S.app.get('port')
      , 'upload_path': S.settings.upload_path
      }, null, 2));
    });
  } else {
    //START HTTP
    S.server = HTTP.createServer(S.app).listen(S.app.get('port'), function(){
      console.log('[%s] Express HTTP server started:', S.settings.name);
      return console.log(JSON.stringify({
        'environment': S.settings.environment.toUpperCase()
      , 'port': S.app.get('port')
      , 'upload_path': S.settings.upload_path
      }, null, 2));
    });
  }

  return S;
};

if (require.main === module){
  var M = new module.exports();
}
