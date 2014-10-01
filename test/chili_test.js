'use strict';

var Chili = new require('../lib/chili.js')()
  , FSTK = require('fstk')
  , Async = require('async')
  , _ = require('underscore')
  , Belt = require('jsbelt')
  , Path = require('path')
  , Request = require('request')
;

exports['tests'] = {
  setUp: function(done) {
    // setup here
    done();
  },
  'no args': function(test) {
    var globals = {};
    return Async.waterfall([
      function(cb){
        return Request('http://localhost:' + Chili.settings.port + '/eval?code=300'
        , {'json': true}, Belt.cs(cb, globals, 'response', 2, 0));
      }
    , function(cb){
        test.ok(globals.response === 300);
        return cb();
      }
    , function(cb){
        return Request('http://localhost:' + Chili.settings.port + '/exec?command=echo "hello world"'
        , {'json': true}, Belt.cs(cb, globals, 'response', 2, 0));
      }
    , function(cb){
        test.ok(globals.response.stdout === "hello world\n");
        return cb();
      }
    , function(cb){
        return Request('http://localhost:' + Chili.settings.port + '/ps?command=ps'
        , {'json': false}, Belt.cs(cb, globals, 'response', 2, 0));
      }
    , function(cb){
        test.ok(globals.response.match(/<stdout>  PID TTY          TIME CMD/));
        return cb();
      }
    ], function(err){
      if (err) console.error(err);
      test.ok(!err);
      return test.done();
    });
  },
};
