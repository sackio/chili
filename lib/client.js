#!/usr/bin/env node

/*
 * chili-client
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
  , Request = require('request')
  , Chili = require('./chili.js')
;

module.exports = function(O){
  var Opts = O || new Optionall({
                                  '__dirname': Path.resolve(module.filename + '/../..')
                                });

  var S = {};
  S.settings = Belt.extend({

  }, Opts);
  S.settings = _.defaults(S.settings, {

  });

  S.chili = new Chili(S.settings);
  S.parseSML = S.chili.parseSML;

  /*
    General Chili request method
  */
  S['request'] = function(options, callback){
    var a = Belt.argulint(arguments)
      , self = this;
    a.o = _.defaults(a.o, {
      'host': a.o.H
    , 'username': a.o.u
    , 'password': a.o.p
    , 'command': a.o.C || a.o.cmd
    , 'code': a.o.E
    , 'process': a.o.P
    , 'args': a.o.a || a.o.arguments || a.o.argv
    , 'quiet': a.o.q
    , 'streamback': a.o.s
    });

    var gb = {};
    if (a.o.process){
      gb.request = {
        'method': 'POST'
      , 'url': a.o.host + '/ps'
      , 'qs': Belt.extend(_.pick(a.o, ['encoding', 'cwd', 'env', 'stdio'
              , 'detached', 'uid', 'gid', 'args', 'stream', 'autokill', 'quiet']), {
          'command': a.o.process
        })
      , 'auth': (a.o.username ? {
          'user': a.o.username
        , 'pass': a.o.password
        } : undefined)
      , 'json': false
      };
    } else if (a.o.command){
      gb.request = {
        'method': 'POST'
      , 'url': a.o.host + '/exec'
      , 'qs': Belt.extend(_.pick(a.o, ['encoding', 'cwd', 'env', 'uid']), {
          'command': a.o.command
        })
      , 'auth': (a.o.username ? {
          'user': a.o.username
        , 'pass': a.o.password
        } : undefined)
      , 'json': true
      };
    } else if (a.o.code){
      gb.request = {
        'method': 'POST'
      , 'url': a.o.host + '/eval'
      , 'qs': Belt.extend(_.pick(a.o, []), {
          'code': _.isFunction(a.o.code) ? ('(' + a.o.code.toString() + ').call()') : a.o.code
        })
      , 'auth': (a.o.username ? {
          'user': a.o.username
        , 'pass': a.o.password
        } : undefined)
      , 'json': true
      };
    } else return a.cb(new Error('Invalid request'));

    if (a.o.ssl) gb.request.strictSSL = false;

    return Async.waterfall([
      function(cb){
        if (a.o.streamback){
          gb.response = Request(gb.request);
          return cb();
        }

        return Request(gb.request, Belt.cs(cb, gb, 'response'
        , a.o.streamback ? 1 : 2, 0));
      }
    , function(cb){
        if (a.o.process && !a.o.streamback) gb.response = S.chili.parseSML(gb.response);
        return cb();
      }
    ], function(err){
      if (err) console.error(err);
      return a.cb(err, gb.response);
    });
  };

  return S;
};

if (require.main === module){
  var m = new module.exports()
    , gb = {};

  Async.waterfall([
    function(cb){
      if (!m.settings.P && !m.settings.C && !m.settings.E) return cb();

      return m.request(m.settings, Belt.cs(cb, gb, 'response', 1, 0));
    }
  , function(cb){
      if (!m.settings.P && !m.settings.C && !m.settings.E) return cb();

      if (m.settings.s){
        gb.response.on('data', function(d){
          return console.log(d.toString(m.settings.encoding || 'utf8'));
        });
      } else if (!m.settings.q){
        console.log(JSON.stringify(gb.response, null, 2));
      }

      return cb();
    }
  , function(cb){
      if (!m.settings.P && !m.settings.C && !m.settings.E) console.log(
        'Chili ships with a basic commandline client for making remote requests to Chili servers. The client accepts the following options:\n\n'
      + '  * -H - the host domain (including optional port) of the Chili server\n'
      + '  * -u - username for server\n'
      + '  * -p - password for the server\n'
      + '  * -C - bash command to be executed on the server (hits the /exec endpoint)\n'
      + '  * -E - code to be evaluated on the server\n'
      + '  * -P - process to be spawned on the server\n'
      + '  * -a - arguments (array) to be included with spawned process\n'
      + '  * -q - run quietly, do not output Chili responses\n'
      + '  * -s - stream back Chili response as it is received\n'
      + '  * -ssl - allow self-signed/invalid SSL certificates'
      + '  * -uid - user id to run as (on remote server)'
      );

      return cb();
    }
  ], function(err){
    if (err) console.error(err);
    return process.exit(err ? 1 : 0);
  });
}
