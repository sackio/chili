# chili

Lightweight and simple RPC daemon using Node.js

## Getting Started
Install the module with: `npm install -g chili`

Control script and NGINX configuration files are in `./assets/scripts`

Chili can be run from the commandline with `chili --port=8080`. Port defaults to 8000. This will start an HTTP server on the specified port, ready for requests.

Chili includes a lightweight commandline client for interacting with a Chili server running on another host. The client is accessible from the commandline with `chili-client <args>`.

## Server
Chili exposes the following endpoints to remote requests:

* **/eval?code=** - evaluates value of `code` parameter in the context of the Chili process and returns the result as JSON
* **/exec?cmd=** - executes value of `cmd` parameter as a bash command. Accepts options for `cwd`, `maxBuffer` (maximum buffer size to be returned), `encoding` (encoding type for response), `env` (a hash of environment variables). Returns an `error`, `stdout`, and `stderr` of the executed command.
* **/ps?cmd=** - spawn a process with the given `cmd`. Accepts `args` as an array of commandline arguments, along with options for `cwd`, `encoding`, `autokill` (kills the process when the request ends), `stream` (streams back stdout or stderr if set to `stderr` as response), `content_type` (if `stream` is set, this sets the `Content-Type` header in the response), `uid` (the user id to run the process as), `gid` (the group id to run the process as), `env` (a hash of environment variables), and `stdin` (if true, uses the request as the `stdin` for the process. Returns a chunked response of pseudo-XML, enclosing chunks of `stdout`, `stderr`, and `error` in `<tag></tag>`. If `stream` is set, response streams back the specified output stream.
* **GET /fs?path=** - streams back a file at `path`. Accepts options of `encoding` to set the encoding of the response, `start` and/or `stop` to specify a byte range of the file to return, `content_type` to specify `Content-Type` header, and `attachment` to specify if response should include an attachment disposition.
* **POST /fs?path=** - writes a file to `path`. Pipes request's body into a file write stream. Accepts options to set `encoding`, `start` to append to an existing file or modify a specific byte range.
* **POST /upload?path=** - upload files as multipart form data, moving uploaded file(s) to `path`. If multiple files are included, filenames are retained and moved to `path`. If only one file is uploaded, uploaded file is moved to `path` in a rename.

## Access Control
Just in case it doesn't go without saying, unprotected remote access is a **REALLY BAD IDEA**. Chili is meant to be used as a quick and easy RPC tool, mainly for use with internal servers, or behind other access controls such as a web server (i.e. NGINX) or a firewall. When used with HTTPS, HTTP authentication, and requester whitelisting, Chili might be suitable for more public use, assuming requesters can be trusted.

Chili includes some basic application-level tools for controlling access and user rights. By including `users` as an environmental variable array, Chili will require HTTP authentication for all endpoints. Elements of the `users` array should be objects including `username` and `password` (used for HTTP authentication), and optional `uid` (sets uid to this value for all requests), `gid` (sets gid for all requests) (if `uid` and/or `gid` is set, only `/ps` endpoints will be permitted), `allow` (a regular expression that a full url must match in order to accept the request from the user), and `deny` (a regular expression that a full url must not match in order to be accepted).

Again, Chili is not meant to provide any kind of sandboxed or public remote access to a system. If you need something like this, check out some of the other fine solutions that are much more battle-hardened and production-ready.

## Client
Chili ships with a basic commandline client for making remote requests to Chili servers. The client accepts the following options:

* **-H** - the host domain (including optional port) of the Chili server.
* **-u** - username for server
* **-p** - password for the server
* **-C** - bash command to be executed on the server (hits the `/exec` endpoint)
* **-E** - code to be evaluated on the server
* **-P** - process to be spawned on the server
* **-a** - arguments (array) to be included with spawned process
* **-q** - run quietly, do not output Chili responses
* **-s** - stream back Chili response as it is received
* **process options** - see above for options accepted for spawning processes through Chili

Note: filesystem endpoints are not included in the client. If you're at the commandline, there are other, more secure options for transferring files between hosts.

The commandline client is also include as a Node module for use in projects.

## License
Copyright (c) 2014 Ben Sack
Licensed under the MIT license.
