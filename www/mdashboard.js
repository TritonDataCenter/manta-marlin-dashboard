/*
 * mdashboard.js: Marlin dashboard implementation
 */

window.onload = mInit;

var mTableCommonConfig = {
    'bFilter': false,
    'bInfo': false,
    'bPaginate': false,
    'bLengthChange': false
};

var mTableConfig = {
    'supervisors': {
	'domid': 'mSupervisorTable',
	'autolink': [ 0 ],
	'config': {
	    'aoColumns': [
		{ 'sTitle': 'Supervisor', 'sClass': 'mUuid' },
		{ 'sTitle': 'Started' },
		{ 'sTitle': 'AuthP' },
		{ 'sTitle': 'LocsP' },
		{ 'sTitle': 'DelsP' },
		{ 'sTitle': 'LRq' },
		{ 'sTitle': 'LRs' },
		{ 'sTitle': 'ARq' },
		{ 'sTitle': 'ARs' }
	    ]
	}
    },
    'jobs': {
	'domid': 'mJobTable',
	'autolink': [ 0 ],
	'config': {
	    'aaSorting': [ [ 3, 'asc' ] ],
	    'aoColumns': [
		{ 'sTitle': 'Jobid', 'sClass': 'mUuid' },
		{ 'sTitle': '' },
		{ 'sTitle': 'User' },
		{ 'sTitle': 'Started' },
		{ 'sTitle': 'Z' },
		{ 'sTitle': 'A' },
		{ 'sTitle': 'Ip' },
		{ 'sTitle': 'Td' },
		{ 'sTitle': 'Tc' },
		{ 'sTitle': 'O' },
		{ 'sTitle': 'R' },
		{ 'sTitle': 'Err' }
	    ]
	}
    },
    'groups': {
	'domid': 'mRunningGroupsTable',
	'autolink': [ 1 ],
	'config': {
	    'aaSorting': [ [ 0, 'asc' ], [ 1, 'asc' ], [ 2, 'asc' ] ],
	    'aoColumns': [
		{ 'sTitle': 'DC' },
		{ 'sTitle': 'Server' },
		{ 'sTitle': 'Jobid', 'sClass': 'mUuid' },
		{ 'sTitle': 'Ph' },
		{ 'sTitle': 'Kind' },
		{ 'sTitle': 'Qd' },
		{ 'sTitle': 'Run' },
		{ 'sTitle': 'Zones' },
		{ 'sTitle': 'Share' }
	    ]
	}
    },
    'streams': {
	'domid': 'mStreamsTable',
	'autolink': [ 1, 2 ],
	'config': {
	    'aaSorting': [ [ 0, 'asc' ], [ 1, 'asc' ], [ 2, 'asc' ] ],
	    'aoColumns': [
		{ 'sTitle': 'DC' },
		{ 'sTitle': 'Server' },
		{ 'sTitle': 'Jobid / phase / machine', 'sClass': 'mUuid' },
		{ 'sTitle': 'Last task started' }
	    ]
	}
    },
    'disabled_zones': {
	'domid': 'mDisabledZonesTable',
	'autolink': [ 1, 2 ],
	'config': {
	    'aaSorting': [ [ 0, 'asc' ], [ 1, 'asc' ], [ 2, 'asc' ] ],
	    'aoColumns': [
		{ 'sTitle': 'DC' },
		{ 'sTitle': 'Server' },
		{ 'sTitle': 'Zonename', 'sClass': 'mUuid' },
		{ 'sTitle': 'Since' },
		{ 'sTitle': 'Reason', 'sClass': 'mTextBlock' }
	    ]
	}
    }
};

/* DOM elements */
var spanUpdateTime;				/* last updated time */
var divErrorContainer;				/* error alert */

/* Application configuration */
var mRefreshInterval = 5000;			/* ms between refreshes */
var mServerUrl;					/* kang proxy server location */
if (window.location.hash)
	mServerUrl = window.location.hash.substr(1);
else
	mServerUrl = window.location.origin;

/* Application state */
var mTables = {};
var mZoneStates;
var mUpdateTime;
var mSnapshot;
var mDetails;
var mRefreshOkay = true;

function mInit()
{
	var k;

	for (k in mTableConfig)
		mTables[k] = new mTable(k, mTableConfig[k]);
	mZoneStates = new mZoneStateWidget('zonegrid', 'mZoneStates');
	spanUpdateTime = document.getElementById('mUpdateTime');
	divErrorContainer = document.getElementById('mErrorContainer');

	$('#tabs').tab();
	$('#inner-tabs').tab();

	mRedrawWorld();
	mRefresh();
}

function mRedrawWorld()
{
	var k;

	for (k in mTables)
		mTables[k].redraw();

	mZoneStates.redraw();
	spanUpdateTime.firstChild.nodeValue = mFormatDate(mUpdateTime);
}

function mShowError(message, severe)
{
	var div = $('<div class="alert' +
	    (severe ? ' alert-error' : '') + '">' + message + '</div>');

	if (divErrorContainer.firstChild) {
		divErrorContainer.replaceChild(
		    div[0], divErrorContainer.firstChild);
	} else {
		divErrorContainer.appendChild(div[0]);
	}
}

function mHideError()
{
	if (divErrorContainer.firstChild)
		divErrorContainer.removeChild(divErrorContainer.firstChild);
}

function mRefresh()
{
	$.ajax({
	    'url': mServerUrl + '/marlin',
	    'dataType': 'json',
	    'success': function (data) {
		mHideError();
		mLoadData(data);
		mRedrawWorld();
		if (data['error'])
			mShowError('Warning: ' + data['error']);
		mRefreshOkay = true;
		setTimeout(mRefresh, mRefreshInterval);
	    },
	    'error': function (data) {
		if (mRefreshOkay) {
			mShowError('Failed to refresh dashboard (will retry)',
			    true);
			mRefreshOkay = false;
		}

		setTimeout(mRefresh, mRefreshInterval);
		console.error('failed to refresh dashboard:', data);
	    }
	});
}

function mLoadData(data)
{
	mUpdateTime = new Date();
	mSnapshot = data;
	mDetails = {};

	var svcs, rows, k, o, r, i, e;
	var rowbyagent = {};
	var dcbyagent = {};
	var namebyagent = {};
	var zonedata = {};
	var rowbyjob = {};
	var extra;

	svcs = data.cs_objects['service'];

	if (data.cs_objects['agent']) {
		for (k in data.cs_objects['agent']) {
			o = data.cs_objects['agent'][k][0];
			r = [
			    (o['datacenter'] || '-') + '<br />' +
			    o['hostname'] || '-',
			    data.cs_objects['stats'][o['origin']][0]['started'].
			        substr(5, 14),
			    o['slopDiskUsed'] + ' / ' +
			        o['slopDiskTotal'] + 'GB<br/>' +
			    o['slopMemUsed'] + ' / ' +
			        o['slopMemTotal'] + 'MB',
			    o['nTasks'],
			    0,	/* total nzones */
			    0,	/* nbusy */
			    0,	/* ninit */
			    0 	/* ndisabled */
			];
			mDetails[r[0]] = o;
			namebyagent[o['origin']] = o['hostname'] || o['origin'];
			dcbyagent[o['origin']] = o['datacenter'] || '-';
			rowbyagent[o['origin']] = r;
		}
	}

	if (data.cs_objects['zone']) {
		for (k in data.cs_objects['zone']) {
			o = data.cs_objects['zone'][k][0];
			r = rowbyagent[o['origin']];
			if (!r)
				continue;

			r[4]++;
			if (o['state'] == 'busy')
				r[5]++;
			else if (o['state'] == 'uninit')
				r[6]++;
			else if (o['state'] == 'disabled')
				r[7]++;
		}

		for (k in rowbyagent) {
			zonedata[k] = {
			    'i': 0,
			    'values': rowbyagent[k],
			    'data': new Array(rowbyagent[k][4]),
			    'label': svcs[k][0]['ident']
			};
		}

		for (k in data.cs_objects['zone']) {
			o = data.cs_objects['zone'][k][0];
			r = rowbyagent[o['origin']];
			if (!r)
				continue;

			e = zonedata[o['origin']];
			e['data'][e['i']++] = [ k, o['state'][0] ];
		}

		mZoneStates.zs_data = zonedata;

		rows = [];
		for (k in data.cs_objects['zone']) {
			o = data.cs_objects['zone'][k][0];
			if (o['state'] != 'disabled')
				continue;
			mDetails[k] = o;
			rows.push([
			    dcbyagent[o['origin']] || '-',
			    namebyagent[o['origin']] || o['origin'],
			    k,
			    o['disableTime'],
			    o['disableErrorMessage']
			]);
		}
		mTables['disabled_zones'].t_rows = rows;
	}

	rows = [];
	if (data.cs_objects['worker']) {
		for (k in data.cs_objects['worker']) {
			o = data.cs_objects['worker'][k][0];
			mDetails[o['conf']['instanceUuid']] = o;
			r = [
			    o['conf']['instanceUuid'],
			    data.cs_objects['stats'][o['origin']][0]['started'].
			        substr(5, 14),
			    o['nLocs'],
			    o['nLocIn'],
			    o['nLocOut'],
			    o['nAuths'],
			    o['nAuthsIn'],
			    o['nAuthsOut'],
			    o['nDels']
			];
			delete (o['conf']);
			rows.push(r);
		}
	}
	mTables['supervisors'].t_rows = rows;

	rows = [];
	if (data.cs_objects['job']) {
		for (k in data.cs_objects['job']) {
			/* Find the worker "job" record, not the agent ones. */
			for (i = 0; i < data.cs_objects['job'][k].length; i++) {
				o = data.cs_objects['job'][k][i];
				if (svcs[o['origin']][0]['component'] ==
				    'jobworker')
					break;
			}

			if (svcs[o['origin']][0]['component'] != 'jobworker')
				continue;

			mDetails[o['record']['jobId']] = o['record'];

			if (o['record']['name'] ==
			        'interactive compute job' &&
			    o['record']['phases'][0].exec ==
			        '/assets/poseidon/public/medusa/agent.sh') {
				extra = '<span class="mHoverText" ' +
				    'title="mlogin job">$</span>';
			} else if (!o['record']['timeInputDone']) {
				extra = '<span class="mHoverText" ' +
				    'title="job waiting for input">' +
				    '&hellip;</span>';
			} else if (o['record']['timeCancelled']) {
				extra = '<span class="mHoverText" ' +
				    'title="job was cancelled">' +
				    'C</span>';
			} else {
				extra = '&nbsp;';
			}

			r = [
			    o['record']['jobId'],
			    extra,
			    o['record']['auth']['login'],
			    o['record']['timeCreated'].substr(5, 14),
			    0,
			    o['record']['stats']['nAssigns'],
			    o['record']['stats']['nInputsRead'],
			    o['record']['stats']['nTasksDispatched'],
			    o['record']['stats']['nTasksCommittedOk'] +
			        o['record']['stats']['nTasksCommittedFail'],
			    o['record']['stats']['nJobOutputs'],
			    o['record']['stats']['nRetries'],
			    o['record']['stats']['nErrors']
			];
			rowbyjob[o['record']['jobId']] = r;

			rows.push(r);
		}
	}
	mTables['jobs'].t_rows = rows;

	rows = [];
	if (data.cs_objects['taskgroup']) {
		for (k in data.cs_objects['taskgroup']) {
			data.cs_objects['taskgroup'][k].forEach(function (g) {
				o = g;
				if (!svcs[o['origin']])
					return;
				r = [
				    dcbyagent[o['origin']],
				    namebyagent[o['origin']],
				    o['jobid'],
				    o['phasei'],
				    o['phase'] ?
					(o['phase']['type'] +
				        (o['phase']['type'] == 'reduce' ?
				        ' (' + (o['phase']['count'] || 1) +
					')' : '')) : 'unknown',
				    o['ntasks'],
				    o['nrunning'],
				    o['nstreams'],
				    o['share']
				];
				rows.push(r);
				if (rowbyjob[o['jobid']])
					rowbyjob[o['jobid']][4] +=
					    o['nrunning'];
			});
		}
	}
	mTables['groups'].t_rows = rows;

	rows = [];
	if (data.cs_objects['taskstream']) {
		for (k in data.cs_objects['taskstream']) {
			data.cs_objects['taskstream'][k].forEach(function (g) {
				o = g;
				if (!svcs[o['origin']])
					return;
				r = [
				    dcbyagent[o['origin']],
				    namebyagent[o['origin']],
				    o['id'],
				    o['taskStart'] || 'N/A'
				];
				rows.push(r);
				mDetails[o['id']] = o;
			});
		}
	}
	mTables['streams'].t_rows = rows;
}

function mTable(key, conf)
{
	this.t_key = key;
	this.t_elt = document.getElementById(conf['domid']);
	this.t_rows = [];
	this.t_config = {};
	this.t_drawn = false;
	this.t_autolink = conf['autolink'] || [];

	var k;
	for (k in mTableCommonConfig)
		this.t_config[k] = mTableCommonConfig[k];
	for (k in conf['config'])
		this.t_config[k] = conf['config'][k];
}

mTable.prototype.redraw = function ()
{
	if (this.t_drawn)
		$(this.t_elt).dataTable().fnDestroy();

	var t = this;
	this.t_autolink.forEach(function (col) {
		t.t_rows.forEach(function (row) {
			row[col] = '<a href="javascript:mDetailShow(\'' +
			    row[col] + '\');">' + row[col] + '</a>';
		});
	});

	var conf = {};
	for (var k in this.t_config)
		conf[k] = this.t_config[k];
	conf['aaData'] = this.t_rows;
	$(this.t_elt).dataTable(conf);
	this.t_drawn = true;

};

function mFormatDate(time)
{
	if (!time)
		return ('never');

	var h, m, s;
	h = time.getHours();
	m = time.getMinutes();
	if (m < 10)
		m = '0' + m;
	s = time.getSeconds();
	if (s < 10)
		s = '0' + s;

	return (h + ':' + m + ':' + s);
}

function mZoneStateWidget(key, domid)
{
	this.zs_data = {};
	this.zs_table = new mTable(key, {
	    'domid': domid,
	    'autolink': [ 0 ],
	    'config': {
		'aaSorting': [ [ 0, 'asc' ] ],
	        'aoColumns': [
		    { 'sTitle': 'DC<br/>Host' },
		    { 'sTitle': 'Started' },
		    { 'sTitle': 'Disk slop used<br />mem slop used' },
		    { 'sTitle': 'Tasks' },
		    { 'sTitle': 'Z' },
		    { 'sTitle': 'B' },
		    { 'sTitle': 'R' },
		    { 'sTitle': 'D' },
		    { 'sTitle': 'Zones' }
		]
	    }
	});
}

mZoneStateWidget.prototype.redraw = function ()
{
	var data = this.zs_data;
	var rows, div, wrap, k, row;

	rows = [];

	for (k in data) {
		wrap = document.createElement('div');
		div = wrap.appendChild(document.createElement('div'));
		div.className = 'mZoneRow';

		data[k]['data'].forEach(function (s, i) {
			var elt = div.appendChild(
			    document.createElement('div'));
			elt.className = 'mZoneState' + s[1].toUpperCase();
			elt.title = s[0];

			if (i % 32 == 31) {
				div = wrap.appendChild(
				    document.createElement('div'));
				div.className = 'mZoneRow';
			}
		});

		row = data[k]['values'].slice(0);
		row.push(wrap.innerHTML);
		rows.push(row);
	}

	this.zs_table.t_rows = rows;
	this.zs_table.redraw();
};

function mDetailShow(id)
{
	var html = [
	    '<div class="mModal modal hide face" role="dialog" ' +
	        'aria-hidden="true">',
	    '<div class="modal-header">',
	    '<button type="button" class="close" data-dismiss="modal" ' +
	        'aria-hidden="true">×</button>',
	    '<h3>Details for ' + id + '</h3>',
	    '</div>',
	    '<div class="modal-body">',
	    '<pre>',
	    JSON.stringify(mDetails[id], false, 4),
	    '</pre>',
	    '</div>',
	    '<div class="modal-footer">',
	    '<button class="btn" data-dismiss="modal" aria-hidden="true">' +
	        'Close</button>',
	    '</div>',
	    '</div>'
	].join('\n');

	$(html).modal({ 'show': true });
}
