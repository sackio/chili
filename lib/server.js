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
  , FSTK = require('fstk')
  , Async = require('async')
  , _ = require('underscore')
  , Belt = require('jsbelt')
  , Util = require('util')
  , Events = require('events')

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

  , Chili = require('./chili.js')
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

  S.chili = new Chili(S.settings);

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

  //ROUTES

  /*
    Evaluate code in the context of this process
  */
  S.app.all('/eval', function(request, response){
    var data = S.request_data(request);

    return S.chili.eval(data, function(err, val){
      if (err) return response.status(200).json({'error': Belt.get(err, 'message')});

      return response.status(200).json(val);
    });
  });

  /*
    Execute a command on the server
  */
  S.app.all('/exec', function(request, response){
    var data = S.request_data(request);

    return S.chili.exec(data, function(err, json){
      if (err) return response.status(200).json({
        'error': err.message
      });

      return response.status(200).json(json);
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
    var data = S.request_data(request)
      , o = _.defaults(data, {
          'command': data.command || data.cmd
        , 'args': data.args || data.arguments || data.argv || []
        , 'cwd': S.settings.cwd
        , 'encoding': 'utf8'
        , 'content_type': 'text/plain'
        , 'uid': S.settings.uid
        , 'emitter': new (Events.EventEmitter.bind({}))()
        })
      , headers = {
          'Content-Type': o.content_type
        , 'Transfer-Encoding': 'chunked'
        , 'Connection': 'Keep-Alive'
        };

    if (o.stdin) o.stdin = request;
    if (o.stream) o.stream = response;

    var ended = false;

    response.on('end', function(){
      ended = true;
      return o.emitter.emit('end');
    });

    _.each(headers, function(v, k){ return response.set(k, v); });
    response.status(200);

    o.emitter.on('error', function(err){
      if (ended) return;
      response.write(['<error>', Belt.get(err, 'message'), ' | ', Belt.get(err, 'code'), '</error>\r'].join(''));
      return response.end();
    });

    o.emitter.on('stderr', function(data){
      if (ended) return;
      return response.write(['<stderr>', data, '</stderr>\r'].join(''));
    });

    o.emitter.on('stdout', function(data){
      if (ended) return;
      return response.write(['<stdout>', data, '</stdout>\r'].join(''));
    });

    o.emitter.on('exit', function(code, signal){
      if (ended) return;
      return response.write(['<exit>', code, ' | ', signal, '</exit>\r'].join(''));
    });

    o.emitter.on('close', function(code, signal){
      if (ended) return;
      ended = true;
      response.write(['<close>', code, ' | ', signal, '</close>\r'].join(''));
      return response.end();
    });

    o.emitter.on('pid', function(pid){
      if (ended) return;
      return response.write(['<pid>', pid, '</pid>\r'].join(''));
    });

    if (ended) return;

    return S.chili.ps(o, Belt.noop);
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
    , 'os': S.chili.status()
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
