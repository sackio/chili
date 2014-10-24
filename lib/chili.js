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
  , Multer = require('multer')
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
  , 'upload_path': Path.join(Opts.__dirname, '/', 'assets', '/', 'uploads')
  , 'body_parser': {'limit': '500mb', 'extended': true}
  , 'redis': {}
  , 'cwd': '/'
  , 'users': []
  }, Opts, Opts.express);
  S.settings = _.defaults(S.settings, {
    'sessions': {
      'store': new Redis_Sessions(S.settings.redis)
    , 'secret': S.settings.session_secret
    , 'cookie': {'maxAge': 60000000}
    , 'key': S.settings.session_key
    , 'saveUninitialized': true
    , 'resave': true
    }
  , 'uploads': {
      'dest': S.settings.upload_path
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
  S.app.use(Multer(S.settings.uploads)); //uploads

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
        });
    o.paths = ['cwd', 'env', 'encoding', 'timeout', 'maxBuffer', 'killSignal'];
    return Child_Process.exec(o.command, _.pick(o, o.paths)
    , function(err, stdout, stderr){
      return response.status(200).json({
        'error': Belt._get(err, 'message')
      , 'stdout': Belt._call(stdout, 'toString', o.encoding)
      , 'stderr': Belt._call(stderr, 'toString', o.encoding)
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
        })
      , headers = {
          'Content-Type': o.content_type
        , 'Transfer-Encoding': 'chunked'
        , 'Connection': 'Keep-Alive'
        }
      , ended = false;

    o.paths = ['cwd', 'env', 'stdio', 'detached', 'uid', 'gid'];

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

    var cp = Child_Process.spawn(o.command, o.args, _.pick(o, o.paths));
    return setImmediate(function(){
      if (o.stdin) request.pipe(cp.stdin); //pipe in the stdin

      if (o.stream && o.stream === 'stderr') return cp.stderr.pipe(request);
      if (o.stream) return cp.stdout.pipe(request);

      cp.on('error', function(err){
        if (ended) return;
        return response.write(['<error>', Belt._get(err, 'message'), ' | '
                              , Belt._get(err, 'code'), '</error>\r'].join(''));
      });

      cp.stderr.on('data', function(data){
        if (ended) return;
        return response.write(['<stderr>', Belt._call(data, 'toString', o.encoding), '</stderr>\r'].join(''));
      });

      cp.stdout.on('data', function(data){
        if (ended) return;
        return response.write(['<stdout>', Belt._call(data, 'toString', o.encoding), '</stdout>\r'].join(''));
      });

      cp.on('exit', function(code, signal){
        if (ended) return;
        ended = true;
        response.write(['<exit>', code , ' | ', signal, '</exit>\r'].join(''));
        return response.end();
      });

      if (ended) return;

      return response.write(['<pid>', Belt._get(cp, 'pid'), '</pid>\r'].join(''));
    });
  });

  /*
    Stream back a file from the server
      Creates a readable stream, piping back full contents or reading a specified byte range
      -headers - set headers for the response (i.e. content-type)
  */
  S.app.get('/fs', function(request, response){
    var self = this
      , data = S.request_data(request)
      , o = _.defaults(data, {
          'path': data.path || data.file || data.filepath
        , 'encoding': 'utf8'
        , 'start': false
        , 'stop': false
        });

    o.paths = ['encoding', 'start', 'stop'];
    o.content_type = o.content_type || FSTK._mime.lookup(o.path) || 'text/plain';

    var headers = {
          'Content-Type': o.content_type
        , 'Transfer-Encoding': 'chunked'
        , 'Connection': 'Keep-Alive'
        }
      , ended = false, error = false;
    if (o.attachment) headers['Content-Disposition'] = 'attachment; filename="' + FSTK.filename(o.path) + '"';

    var fs = FSTK._fs.createReadStream(o.path, _.pick(o, o.paths));
    return setImmediate(function(){
      fs.on('error', function(err){
        if (ended) return;
        return response.status(404).end(err.message);
      });

      response.on('end', function(){
        return ended = true;
      });

      _.each(headers, function(v, k){ return response.set(k, v); });
      response.status(200);

      return fs.pipe(response);
    });
  });

  /*
    Stream a file to the server
      Creates a writable stream, piping request to create a new file, modifying a byte range
      , appending to the end of the file, or inserting a byte range
      -headers - set headers for the response (i.e. content-type)
  */
  S.app.post('/fs', function(request, response){
    var self = this
      , data = S.request_data(request)
      , o = _.defaults(data, {
          'path': data.path || data.file || data.filepath
        , 'encoding': 'utf8'
        , 'start': false
        , 'mode': data.start ? 'r+' : 'w'
        }), ended = false;

    o.paths = ['encoding', 'start', 'mode'];

    var fs = FSTK._fs.createWriteStream(o.path, _.pick(o, o.paths));
    return setImmediate(function(){
      fs.on('error', function(err){
        if (ended) return;
        return response.status(404).end(err.message);
      });

      response.on('end', function(){
        return ended = true;
      });

      response.status(200);

      return response.pipe(fs);
    });
  });

  /*
    Upload files and move to path
  */
  S.app.post('/upload', function(request, response){
    var self = this
      , data = S.request_data(request)
      , o = _.defaults(data, {
          'path': data.path || data.file || data.filepath
        }), ended = false;

    if (!_.any(request.files)) return response.status(200).end();

    var globals = {};
    return Async.waterfall([
      function(cb){
        return Async.eachSeries(request.files, function(a, _cb){
          return FSTK.mv(a.path, request.files.length === 1 ? o.path
                               : Path.join(o.path, '/', a.originalName), Belt.cw(_cb, 0));
        }, Belt.cw(cb, 0));
      }
    ], function(err){
      if (err) console.error(err);
      return response.status(err ? 404 : 200).end(Belt._get(err, 'message'));
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
