#!/usr/bin/env node

//Basic daemon for Chili, runs the server with forever

var Forever = require('forever-monitor')
  , Path = require('path')
  , Optionall = require('optionall')
  , Belt = require('jsbelt')
  , O = new Optionall({'__dirname': Path.resolve(module.filename + '/../..')})
  , Server = Forever.start(Path.resolve(module.filename + '/../chili.js'), {
    'options': [ (O.port ? '--port=' + O.port : undefined)
               , (O.environment ? '--environment=' + O.environment : undefined)
               , (O.key ? '--key=' + O.key : undefined)
               , (O.crt ? '--crt=' + O.crt : undefined)
               , (O.authenticate ? '--authenticate=' + O.authenticate : undefined)
               ]
  , 'watch': true
  , 'watchIgnoreDotFiles': true
  , 'watchDirectory': Path.resolve(module.filename + '/../..')
  , 'logFile': O.daemon_log
  , 'outFile': O.stdout
  , 'errFile': O.stderr
  })
;

Server.on('error', function(){
  console.log(['ERROR: [', new Date().toString(), ']'].join(''));
  return console.log(Belt.stringify(arguments, null, 2));
});

Server.on('start', function(){
  return console.log(['START: [', new Date().toString(), ']'].join(''));
});

Server.on('stop', function(){
  return console.log(['STOP: [', new Date().toString(), ']'].join(''));
});

Server.on('restart', function(){
  return console.log(['RESTART: [', new Date().toString(), ']'].join(''));
});

Server.on('exit', function(){
  return console.log(['EXIT: [', new Date().toString(), ']'].join(''));
});
