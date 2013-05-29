#!/usr/bin/env node

/*
 * server.js: kang-based server for Marlin dashboard
 */

var mod_fs = require('fs');
var mod_http = require('http');
var mod_path = require('path');
var mod_url = require('url');

var mod_kang = require('kang');

var mArg0 = mod_path.basename(process.argv[1]);
var mConf;
var mServer;
var mSources;
var mHeaders = {
    'access-control-allow-origin': '*'
};

function usage()
{
	console.error('usage: %s CONFIG_FILE', mArg0);
	process.exit(2);
}

function fatal(message)
{
	console.error('%s: %s', mArg0, message);
	process.exit(1);
}

function main()
{
	if (process.argv.length != 3)
		usage();

	try {
		mConf = JSON.parse(
		    mod_fs.readFileSync(process.argv[2]).toString('utf8'));
		mSources = mConf['kang_sources'].map(function (url) {
			return (mod_kang.knMakeSource(url));
		});
	} catch (ex) {
		fatal('failed to read config: ' + ex.message);
	}

	if (mSources.length === 0)
		fatal('no sources found in configuration file');

	mServer = mod_http.createServer(onRequest);
	mServer.listen(mConf['listenPort'], function () {
		console.log('server started on port %s', mConf['listenPort']);
	});
}

function onRequest(request, response)
{
	var rqpath;

	if (request.method != 'GET') {
		response.writeHead(405, mkHeaders({}));
		response.end();
		return;
	}

	rqpath = mod_url.parse(request.url).pathname;
	if (rqpath == '/') {
		response.writeHead(301, mkHeaders({
		    'location': '/' + mConf['index']
		}));
		response.end();
		return;
	}

	if (rqpath == '/marlin') {
		onMarlinRequest(request, response);
		return;
	}

	onFileRequest(request, response, rqpath);
}

function mkHeaders(headers)
{
	for (var k in mHeaders)
		headers[k] = mHeaders[k];
	return (headers);
}

function onMarlinRequest(request, response)
{
	mod_kang.knFetchAll({ sources: mSources }, function (err, snapshot) {
		if (err) {
			response.writeHead(500, mkHeaders({}));
			response.end(JSON.stringify({ 'error': err.message }));
			return;
		}

		response.writeHead(200, mkHeaders({}));
		response.end(JSON.stringify(snapshot));
	});
}

function onFileRequest(request, response, path)
{
	/*
	 * This isn't super-secure, but it should be enough for our purposes.
	 * We have no symlinks in this repo.
	 */
	if (path[0] != '/' ||
	    path.indexOf('/../') != -1 ||
	    path.indexOf('/..') == path.length - '/..'.length) {
		response.writeHead(400, mkHeaders({}));
		response.end(JSON.stringify({ 'error': 'path not allowed' }));
		return;
	}

	var localpath = mod_path.join(__dirname, '../www', path);
	mod_fs.readFile(localpath, function (err, contents) {
		if (err) {
			response.writeHead(404, mkHeaders({}));
			response.end();
			return;
		}

		response.writeHead(200, mkHeaders({}));
		response.end(contents);
	});
}

main();
