'use strict';

var FSTK = require('fstk')
  , Async = require('async')
  , _ = require('underscore')
  , Belt = require('jsbelt')
  , Path = require('path')
  , Optionall = require('optionall')
  , O = new Optionall({'__dirname': Path.resolve(module.filename + '/../..')})
  , Chili = new require('../lib/server.js')(Belt.extend(O, {
      'key': Path.resolve(module.filename + '/../../chili.key')
    , 'crt': Path.resolve(module.filename + '/../../chili.crt')
    , 'port': 9000
    }))
  , Request = require('request')
  , Client = require('../lib/client.js')()
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
        return Request('https://localhost:' + Chili.settings.port + '/eval?code=300'
        , {'json': true, 'strictSSL': false}, Belt.cs(cb, globals, 'response', 2, 0));
      }
    , function(cb){
        test.ok(globals.response === 300);
        return cb();
      }
    , function(cb){
        return Request('https://localhost:' + Chili.settings.port + '/exec?command=echo "hello world"'
        , {'json': true, 'strictSSL': false}, Belt.cs(cb, globals, 'response', 2, 0));
      }
    , function(cb){
        test.ok(globals.response.stdout === "hello world\n");
        return cb();
      }
    , function(cb){
        return Request('https://localhost:' + Chili.settings.port + '/ps?command=ps'
        , {'json': false, 'strictSSL': false}, Belt.cs(cb, globals, 'response', 2, 0));
      }
    , function(cb){
        test.ok(globals.response.match(/<stdout>  PID TTY          TIME CMD/));
        return cb();
      }
    , function(cb){
        globals.response = Client.parseSML(globals.response);
        test.ok(globals.response.pid[0]);
        test.ok(globals.response.stdout[0]);
        test.ok(globals.response.exit[0] === '0 | ');
        return cb();
      }
    , function(cb){
        return Client.request({'H': 'https://localhost:' + Chili.settings.port
                             , 'P': 'ps'
                             , 'a': ['aux']
                             , 'ssl': true
                             }, Belt.cs(cb, globals, 'response', 1, 0));
      }
    , function(cb){
        test.ok(globals.response.stdout[0].length > 100);
        test.ok(globals.response.exit[0] === '0 | ');
        return cb();
      }
    , function(cb){
        return Client.request({'H': 'https://localhost:' + Chili.settings.port
                             , 'C': 'echo "hello"'
                             , 'ssl': true
                             }, Belt.cs(cb, globals, 'response', 1, 0));
      }
    , function(cb){
        test.ok(globals.response.stdout === 'hello\n');
        return cb();
      }
    , function(cb){
        return Client.request({'H': 'https://localhost:' + Chili.settings.port
                             , 'E': function(){ return "hello"; }
                             , 'ssl': true
                             }, Belt.cs(cb, globals, 'response', 1, 0));
      }
    , function(cb){
        test.ok(globals.response === 'hello');
        return cb();
      }
    , function(cb){
        globals.path = FSTK.tempfile();

        FSTK._fs.writeFileSync(globals.path, 'This is a test file');

        return Client.request({'H': 'https://localhost:' + Chili.settings.port
                             , 'P': 'tail'
                             , 'a': ['-f', globals.path]
                             , 'streamback': true
                             , 'ssl': true
                             }, Belt.cs(cb, globals, 'response', 1, 0));
      }
    , function(cb){
        globals.stdout = '';

        globals.response.on('data', function(d){
          return globals.stdout += d.toString();
        });

        FSTK._fs.appendFileSync(globals.path, '\nThis is a test file');
        FSTK._fs.appendFileSync(globals.path, '\nThis is a test file');
        FSTK._fs.appendFileSync(globals.path, '\nThis is a test file');

        return setTimeout(cb, 5000);
      }
    , function(cb){
        test.ok(globals.stdout.match(/<stdout>This is a test file\n/));
        return cb();
      }
    ], function(err){
      if (err) console.error(err);
      test.ok(!err);
      return test.done();
    });
  },
};
