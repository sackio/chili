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
  , Events = require('events')
;

module.exports = function(O){
  var Opts = O || new Optionall({
                                  '__dirname': Path.resolve(module.filename + '/../..')
                                });

  var S = {};
  S.settings = Belt.extend({
    'cwd': '/'
  , 'users': []
  , 'uid': 1000
  }, Opts);

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

  /*
    Evaluate code in the context of this process
  */
  S['eval'] = function(options, callback){
    var a = Belt.argulint(arguments)
      , self = this;
    a.o = _.defaults(a.o, {
      'command': a.o.command || a.o.cmd || a.o.code
    });

    try{
      return a.cb(null, eval(a.o.command));
    } catch(err) {
      return a.cb(err);
    }
  };

  /*
    Execute a command on the server
  */
  S['exec'] = function(options, callback){
    var a = Belt.argulint(arguments)
      , self = this;
    a.o = _.defaults(a.o, {
      'command': a.o.command || a.o.cmd
    , 'cwd': S.settings.cwd
    , 'maxBuffer': Infinity
    , 'encoding': 'utf8'
    , 'uid': S.settings.uid
    });

    a.o.paths = ['cwd', 'env', 'encoding', 'timeout', 'maxBuffer', 'killSignal'];

    if (!a.o.command) return a.cb(new Error('command is required'));

    a.o.command = 'sudo -u \\#' + a.o.uid + ' ' + a.o.command;

    var gb = {};
    return Async.waterfall([
      function(cb){
        return S.get_user_environment(a.o.uid, Belt.cs(cb, gb, 'env', 1, 0));
      }
    , function(cb){
        a.o.env = Belt.extend(a.o.env || {}, gb.env);
        return cb();
      }
    ], function(err){
      if (err) return a.cb(err);

      return Child_Process.exec(a.o.command, _.pick(a.o, a.o.paths)
      , function(err, stdout, stderr){
        return a.cb(err, {
          'error': Belt.get(err, 'message')
        , 'stdout': Belt._call(stdout, 'toString', a.o.encoding)
        , 'stderr': Belt._call(stderr, 'toString', a.o.encoding)
        });
      });
    });
  };

  /*
    Spawn a process on the server - includes the following options:
      -all options for Node's child_process.spawn
      -stdin - passing this will use the request as a readable stream used as stdin for the process
      -autokill - kill the process when request ends (defaults to false)
      -stream - stream back stdout in response (no markup). Pass 'stderr' to stream stderr
  */
  S['ps'] = function(options, callback){
    var a = Belt.argulint(arguments)
      , self = this;
    a.o = _.defaults(a.o, {
      'command': a.o.command || a.o.cmd
    , 'args': a.o.args || a.o.arguments || a.o.argv || []
    , 'cwd': S.settings.cwd
    , 'encoding': 'utf8'
    , 'uid': S.settings.uid
    , 'emitter': new (Events.EventEmitter.bind({}))()
    });

    var ended = false, err = false;

    a.o.paths = ['cwd', 'env', 'stdio', 'detached', 'uid', 'gid'];
    if (a.o.args) a.o.args = Belt.toArray(a.o.args);

    if (a.o.uid) a.o.uid = parseInt(a.o.uid);
    if (a.o.gid) a.o.gid = parseInt(a.o.gid);

    a.o.emitter.on('end', function(){
      if (!ended && a.o.autokill) Belt._call(cp, 'kill', a.o.autokill);
      return ended = true; 
    });

    a.o.emitter.on('error', function(err){
      return a.o.emitter.emit('end', err);
    });

    if (!a.o.command){
      if (ended) return;
      return a.o.emitter.emit('error', new Error('Command is required'));
    }

    var gb = {}, cp;

    return Async.waterfall([
      function(cb){
        return S.get_user_environment(a.o.uid, Belt.cs(cb, gb, 'env', 1, 0));
      }
    , function(cb){
        a.o.env = Belt.extend(a.o.env || {}, gb.env);
        return cb();
      }
    ], function(err){
      if (err) return a.o.emitter.emit('error', err);

      cp = Child_Process.spawn(a.o.command, a.o.args, _.pick(a.o, a.o.paths));

      return setImmediate(function(){
        if (a.o.stdin) a.o.stdin.pipe(cp.stdin); //pipe in the stdin

        if (a.o.stream && a.o.stream === 'stderr') return cp.stderr.pipe(a.o.stream);
        if (a.o.stream) return cp.stdout.pipe(a.o.stream);

        cp.on('error', function(err){
          if (ended) return;
          return a.o.emitter.emit('error', err);
        });

        if (!a.o.quiet) cp.stderr.on('data', function(data){
          if (ended) return;
          return a.o.emitter.emit('stderr', Belt._call(data, 'toString', a.o.encoding));
        });

        if (!a.o.quiet) cp.stdout.on('data', function(data){
          if (ended) return;
          return a.o.emitter.emit('stdout', Belt._call(data, 'toString', a.o.encoding));
        });

        cp.on('exit', function(code, signal){
          if (ended) return;
          return a.o.emitter.emit('exit', code, signal);
        });

        cp.on('close', function(code, signal){
          if (ended) return;
          ended = true;
          return a.o.emitter.emit('close', code, signal);
        });

        if (ended) return;

        return a.o.emitter.emit('pid', Belt._get(cp, 'pid'));
      });
    });
  };

  S['status'] = function(options, callback){
    var a = Belt.argulint(arguments)
      , self = this;
    a.o = _.defaults(a.o, {
    
    });
    return a.cb(null, _.object(['hostname', 'type', 'platform', 'arch', 'release', 'uptime'
    , 'loadavg', 'totalmem', 'freemem', 'cpus', 'networkinterfaces', 'tmpdir','endianness']
    , _.map(['hostname', 'type', 'platform', 'arch', 'release', 'uptime', 'loadavg', 'totalmem'
      , 'freemem', 'cpus', 'networkInterfaces', 'tmpdir','endianness'], function(o){ return OS[o](); })
      )
    );
  };

  return S;
};

