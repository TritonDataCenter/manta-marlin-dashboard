#!/usr/bin/env node
/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * server.js: kang-based server for Marlin dashboard
 */

var mod_fs = require('fs');
var mod_http = require('http');
var mod_jsprim = require('jsprim');
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
var mLastSnapshot = undefined;
var mLastTime = undefined;
var mPending = [];

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
	if (mLastSnapshot !== undefined &&
	    Date.now() - mLastTime < 1000) {
		response.writeHead(200, mkHeaders({}));
		response.end(JSON.stringify(mLastSnapshot));
		return;
	}

	mPending.push(response);
	if (mPending.length > 1)
		return;

	mod_kang.knFetchAll({
	    'sources': mSources,
	    'clientOptions': {
		'connectTimeout': 5000
	    }
	}, function (err, snapshot) {
		if (err) {
			console.error(new Date().toISOString() +
			    ': error: ' + err);
			if (snapshot)
				snapshot.error = err.toString();
		}

		postprocessSnapshot(snapshot);
		mPending.forEach(function (res) {
			if (!snapshot) {
				res.writeHead(500, mkHeaders({}));
				res.end(
				    JSON.stringify({ 'error': err.message }));
				return;
			}

			res.writeHead(200, mkHeaders({}));
			res.end(JSON.stringify(snapshot));
		});

		mPending = [];
		mLastSnapshot = snapshot;
		mLastTime = Date.now();
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

/*
 * For space reasons, trim out parts of the snapshot that are unused by clients.
 * If these parts are _never_ used, then we should consider removing them from
 * the kang output of the corresponding components.  The stuff we remove here
 * are items included in kang output because it's useful for local debugging,
 * but not for a global status overview.
 */
function postprocessSnapshot(snapshot)
{
	var zones, newzones;

	/*
	 * The list of requests being serviced by each agent at any given time
	 * is usually small, but it's not very interesting for the global status
	 * overview.
	 */
	delete (snapshot.cs_objects['request']);

	mod_jsprim.forEachKey(snapshot.cs_objects['job'], function (_, jobs) {
		jobs.forEach(function (j) {
			/*
			 * Agents report the job's Moray record for the
			 * convenience of local debugging, but we already have
			 * that from the jobsupervisor so we don't need N copies
			 * of it.
			 */
			if (mod_jsprim.startsWith(j.origin, 'marlin.agent')) {
				delete (j.record);
				return;
			}

			/*
			 * For job records, remove the user's credentials.  Even
			 * public keys just clutter output.
			 */
			if (j.hasOwnProperty('record') &&
			    j.record.hasOwnProperty('auth') &&
			    j.record.auth.hasOwnProperty('conditions') &&
			    j.record.auth.conditions.hasOwnProperty('owner')) {
				delete (j.record.auth.conditions.owner.keys);
			}
		});
	});

	/*
	 * Transform the per-zone output into something much more concise for
	 * the dashboard.
	 */
	zones = snapshot.cs_objects['zone'];
	delete (snapshot.cs_objects['zone']);
	snapshot.cs_objects['zonesbyorigin'] = newzones = {};
	mod_jsprim.forEachKey(zones, function (zonename, zonelist) {
		var zone = zonelist[0];
		if (!newzones.hasOwnProperty(zone.origin))
			newzones[zone.origin] = [];
		newzones[zone.origin].push({
		    'zonename': zonename,
		    'state': zone.state,
		    'disableTime': zone.disableTime,
		    'disableErrorMessage': zone.disableErrorMessage
		});
	});
}

main();
