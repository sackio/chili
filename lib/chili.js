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

    //express and middleware
  , Express = require('express')
  , HTTP = require('http')
  , Sessions = require('express-session')
  , Redis_Sessions = require('connect-redis')(Sessions)
  , Multer = require('multer')
  , Morgan = require('morgan')
  , Body_Parser = require('body-parser')
  , Cookie_Parser = require('cookie-parser')
  , Error_Handler = require('errorhandler')

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
  if (S.settings.environment !== 'production') S.app.use(Error_Handler());
  S.app.use(Morgan('dev')); //logging
  S.app.use(Body_Parser.json(S.settings.body_parser));
  S.app.use(Body_Parser.urlencoded(S.settings.body_parser));
  S.app.use(Cookie_Parser(S.settings.cookie_secret));
  S.app.use(Sessions(S.settings.sessions)); //sessions
  S.app.use(Multer(S.settings.uploads)); //uploads

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
        , 'paths': ['cwd', 'env', 'encoding', 'timeout', 'maxBuffer', 'killSignal']
        , 'encoding': 'utf8'
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

  /*
    Spawn a process on the server - includes the following options:
      -all options for Node's child_process.spawn
      -stdin - passing this will use the request as a readable stream used as stdin for the process
      -autokill - kill the process when request ends (defaults to false)
      -stream - stream back stdout in response (no markup). Pass 'stderr' to stream stderr
      -headers - set headers for the response (i.e. content-type)
  */
  S.app.all('/ps', function(request, response){
    var self = this
      , data = S.request_data(request)
      , o = _.defaults(data, {
          'command': data.command || data.cmd
        , 'args': data.args || data.arguments || data.argv || []
        , 'cwd': S.settings.cwd
        , 'paths': ['cwd', 'env', 'stdio', 'detached', 'uid', 'gid']
        , 'encoding': 'utf8'
        })
      , headers = {
          'Content-Type': 'text/plain'
        , 'Transfer-Encoding': 'chunked'
        , 'Connection': 'Keep-Alive'
        }
      , ended = false;

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
  // GET /fs

  /*
    Stream a file to the server
      Creates a writable stream, piping request to create a new file, modifying a byte range
      , appending to the end of the file, or inserting a byte range
      -headers - set headers for the response (i.e. content-type)
  */
  // POST & PUT /fs

  //END ROUTES

  //START
  S.server = HTTP.createServer(S.app).listen(S.app.get('port'), function(){
    console.log('[%s] Express server started:', S.settings.name);
    return console.log(JSON.stringify({
      'environment': S.settings.environment.toUpperCase()
    , 'port': S.app.get('port')
    , 'upload_path': S.settings.upload_path
    }, null, 2));
  });

  return S;
};

if (require.main === module){
  var M = new module.exports();
}
