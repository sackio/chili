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
    , 'port': 84984
    }))
  , Request = require('request')
  , Client = require('../lib/client.js')()
  , Winston = require('winston')
;

var gb = {}
  , log = new Winston.Logger()
;

log.add(Winston.transports.Console, {'level': 'debug', 'colorize': true, 'timestamp': false});

/*exports['tests'] = {
  setUp: function(done) {
    done();
  },
  'timeout-exec': function(test){
    var testn = 'timeout-exec';

    log.profile(testn);
    log.debug('TEST: ' + testn);

    return Request('https://localhost:' + Chili.settings.port + '/exec?command=sleep 360s; echo "hello world"'
    , {'json': true, 'strictSSL': false}, function(err, res, body){
      log.profile(testn);

      test.ok(!err);
      test.ok(body.stdout.match(/hello world/));
      return test.done();
    });
  }
, 'timeout-ps-quiet': function(test){
    var testn = 'timeout-ps-quiet';

    log.profile(testn);
    log.debug('TEST: ' + testn);

    return Request('https://localhost:' + Chili.settings.port + '/ps?command=sleep&args[]=360s&quiet=true'
    , {'json': false, 'strictSSL': false}, function(err, res, body){
      log.profile(testn);

      test.ok(!err);
      test.ok(body.match(/<close>0 \| <\/close>/));

      return test.done();
    });
  }
, 'timeout-ps-script-quiet': function(test){
    var testn = 'timeout-ps-script-quiet';

    log.profile(testn);
    log.debug('TEST: ' + testn);

    return Request('https://localhost:' + Chili.settings.port + '/ps?command=./assets/fixtures/timeout.sh&args[]=1000&quiet=true&cwd=' + O.__dirname
    , {'json': false, 'strictSSL': false}, function(err, res, body){
      log.profile(testn);

      test.ok(!err);
      test.ok(body.match(/<close>0 \| <\/close>/));

      return test.done();
    });
  }
, 'timeout-client-ps-script-quiet': function(test){
    var testn = 'timeout-client-ps-script-quiet';

    log.profile(testn);
    log.debug('TEST: ' + testn);

    return Client.request({'H': 'https://localhost:' + Chili.settings.port
                          , 'P': './assets/fixtures/timeout.sh'
                          , 'a': ['1000']
                          , 'q': true
                          , 'cwd': O.__dirname
                          , 'ssl': true}, function(err, res){
      log.profile(testn);

      test.ok(!err);
      test.ok(res.pid[0]);
      test.ok(res.exit[0] === '0 | ');
      test.ok(res.close[0] === '0 | ');

      return test.done();
    });
  }
};*/
