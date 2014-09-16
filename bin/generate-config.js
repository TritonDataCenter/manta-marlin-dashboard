#!/usr/bin/env node
// -*- mode: js -*-
/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var bunyan = require('bunyan');
var fs = require('fs');
var path = require('path');
var sdc = require('sdc-clients');
var vasync = require('vasync');

var LOG = bunyan.createLogger({
	'level': (process.env.LOG_LEVEL || 'debug'),
	'name': 'generate_config',
	'stream': process.stdout,
	'serializers': bunyan.stdSerializers
});



// --- Helpers

function getDcClients(opts, cb) {
	var self = this;
	var clients = {};

	function url(svc) {
		return ('http://' + svc + '.' + opts.dc + '.' + opts.dnsDomain);
	}

	vasync.pipeline({
		'funcs': [
			function cnapi(_, subcb) {
				self.log.debug({
					'client': 'cnapi',
					'dc': opts.dc,
					'url': url('cnapi')
				});
				clients['CNAPI'] = new sdc.CNAPI({
					log: self.log,
					url: url('cnapi'),
					agent: false
				});
				subcb();
			},
			function vmapi(_, subcb) {
				self.log.debug({
					'client': 'vmapi',
					'dc': opts.dc,
					'url': url('vmapi')
				});
				clients['VMAPI'] = new sdc.VMAPI({
					log: self.log,
					url: url('vmapi'),
					agent: false
				});
				subcb();
			}
		]
	}, function (err) {
		cb(err, clients);
	});
}


function setupSingleDcClients(_, cb) {
	var self = this;
	vasync.pipeline({
		'funcs': [
			function ufds(_2, subcb) {
				self.log.debug({
					'ufdsConfig': self.UFDS_CONFIG
				}, 'connecting to ufds');

				self['UFDS'] = new sdc.UFDS(self.UFDS_CONFIG);

				self['UFDS'].on('ready', function (err) {
					self.log.debug({
						'ufdsConfig': self.UFDS_CONFIG,
						'err': err
					}, 'ufds onReady');
					return (subcb(err));
				});
			},
			function sapi(_2, subcb) {
				var url = 'http://sapi.' + self.DATACENTER +
					'.' + self.DNS_DOMAIN;
				self.log.debug({
					'client': 'sapi',
					'url': url
				});
				self['SAPI'] = new sdc.SAPI({
					log: self.log,
					url: url,
					agent: false
				});
				subcb();
			}
		]
	}, function (err) {
		cb(err);
	});
}


function getDcs(_, cb) {
	var self = this;
	var ufds = self['UFDS'];
	ufds.listDatacenters(self.REGION, function (err, res) {
		if (err) {
			return (cb(err));
		}
		if (res.length === 0) {
			self.log.info({
				res: res,
				region: self.REGION
			}, 'ufds listDatacenters result');
			return (cb(new Error('no datacenters found')));
		}
		var dcs = {};
		res.forEach(function (datacenter) {
			// Take the first sdc resolver we come across.
			if (dcs[datacenter.datacenter] === undefined) {
				dcs[datacenter.datacenter] = {};
			}
		});
		self['DCS'] = dcs;
		return (cb());
	});
}


function setupXDcClients(_, cb) {
	var self = this;
	var dcs = Object.keys(self.DCS);
	var i = 0;

	function setupNextClient() {
		var dc = dcs[i];
		if (dc === undefined) {
			return (cb());
		}
		var opts = {
			'dc': dc,
			'dnsDomain': self.DNS_DOMAIN
		};
		getDcClients.call(self, opts, function (err, clients) {
			if (err) {
				cb(err);
				return;
			}
			self.DCS[dc]['CLIENT'] = clients;
			++i;
			setupNextClient();
		});
	}
	setupNextClient();
}


function findVm(instance, cb) {
	var self = this;
	var uuid = instance.uuid;
	if (!instance.metadata || !instance.metadata.DATACENTER) {
		self.log.error({
			'instance': instance
		}, 'instance has no DATACENTER');
		return (cb(new Error('instance has no DATACENTER: ' + uuid)));
	}
	var dc = instance.metadata.DATACENTER;
	var vmapi = self.DCS[dc].CLIENT.VMAPI;
	return (vmapi.getVm({ uuid: uuid }, cb));
}


function findServer(server, cb) {
	var self = this;
	var dcs = Object.keys(self.DCS);
	vasync.forEachParallel({
		'inputs': dcs.map(function (dc) {
			return (self.DCS[dc].CLIENT.CNAPI);
		}),
		'func': function (client, subcb) {
			client.getServer(server, subcb);
		}
	}, function (err, results) {
		if (results.successes.length < 1) {
			cb(new Error('unable to get server for ' + server));
			return;
		}
		cb(null, results.successes[0]);
	});
}


function findServerIp(network, server) {
	var ip = null;
	var taggedNic = null;
	var nics = server.sysinfo['Network Interfaces'];
	var nns = Object.keys(nics);
	for (var i = 0; i < nns.length; ++i) {
		var nn = nns[i];
		var nic = nics[nn];
		if (nic['NIC Names'].indexOf(network) !== -1) {
			ip = nic['ip4addr'];
			taggedNic = nn;
			break;
		}
	}

	// If the physical nic doesn't have an ip address, it's probably
	// on a vnic
	if (taggedNic !== null && ip === '') {
		var vnics = server.sysinfo['Virtual Network Interfaces'];
		var labs = Object.keys(vnics);
		for (i = 0; i < labs.length; ++i) {
			var vnic = vnics[labs[i]];
			if (vnic['Host Interface'] === taggedNic &&
			    labs[i].indexOf(network) === 0) {
				ip = vnic.ip4addr;
				break;
			}
		}
	}

	return (ip === null || ip === '' ? null : ip);
}



// --- Main

var _self = this;
_self.log = LOG;
var _configFile = process.argv[2] ||
	'/opt/smartdc/marlin-dashboard/etc/generate-config.json';
try {
	var _contents = fs.readFileSync(_configFile, 'utf-8');
	var _opts = JSON.parse(_contents);
} catch (e) {
	LOG.fatal(e, 'Error while reading/parsing ' + _configFile);
	process.exit(1);

}

function checkOpts(k) {
	if (_opts[k] === undefined) {
		LOG.fatal({ key: k, file: _configFile },
			'Key not present in config file');
		process.exit(1);
	}
	return (_opts[k]);
}
_self['REGION'] = checkOpts('region');
_self['DATACENTER'] = checkOpts('datacenter');
_self['DNS_DOMAIN'] = checkOpts('dns_domain');
_self['UFDS_CONFIG'] = checkOpts('ufds');
_self['NETWORK_TAG'] = 'manta';
_self['OUTPUT_FILENAME'] = '/opt/smartdc/marlin-dashboard/etc/config.json';

vasync.pipeline({
	'funcs': [
		setupSingleDcClients.bind(_self),
		getDcs.bind(_self),
		setupXDcClients.bind(_self),
		function lookupPoseidon(_, subcb) {
			_self.log.debug({
				'datacenter': _self['DATACENTER']
			}, 'connecting to ufds in dc');
			var ufds = _self.UFDS;
			ufds.getUser('poseidon', function (err, user) {
				if (err) {
					subcb(err);
					return;
				}
				_self['POSEIDON'] = user;
				_self.log.debug({
					'uuid': _self['POSEIDON'].uuid
				}, 'found poseidon');
				subcb();
			});
		},
		function lookupMantaApplication(_, subcb) {
			_self.log.debug({
				'datacenter': _self['DATACENTER']
			}, 'connecting to sapi in dc to get manta application');
			var sapi = _self.SAPI;
			var search = {
				'name': 'manta',
				'owner_uuid':  _self['POSEIDON'].uuid,
				'include_master': true
			};
			sapi.listApplications(search, function (err, apps) {
				if (err) {
					subcb(err);
					return;
				}
				if (apps.length < 1) {
					subcb(new Error('unable to find the ' +
							'manta application'));
					return;
				}
				_self['MANTA'] = apps[0];
				_self.log.debug({
					'manta': _self['MANTA'].uuid
				}, 'found the manta application');
				subcb();
			});
		},
		function lookupServices(_, subcb) {
			var services = ['jobsupervisor', 'storage'];
			var sapi = _self.SAPI;
			var muuid = _self['MANTA'].uuid;
			vasync.forEachParallel({
				'inputs': services,
				'func': function getService(s, c) {
					var o = {
						'name': s,
						'application_uuid': muuid,
						'include_master': true
					};
					sapi.listServices(o, c);
				}
			}, function (err, res) {
				if (err || res.successes.length !==
				    services.length) {
					LOG.fatal({
						'err': err,
						'res': res
					}, 'couldnt find services');
					err = err || new Error(
						'couldnt find services');
					return (subcb(err));
				}
				_self['SERVICES'] = {};
				res.successes.forEach(function (s) {
					_self['SERVICES'][s[0].name] = s[0];
				});
				_self.log.debug({
					'services': _self.SERVICES
				}, 'found services');
				return (subcb());
			});
		},
		function lookupInstances(_, subcb) {
			var services = Object.keys(_self.SERVICES);
			var sapi = _self.SAPI;
			vasync.forEachParallel({
				'inputs': services,
				'func': function getInstances(s, c) {
					var u = _self.SERVICES[s].uuid;
					var o = {
						'service_uuid': u,
						'include_master': true
					};
					sapi.listInstances(o, c);
				}
			}, function (err, res) {
				if (err || res.successes.length !==
				    services.length) {
					LOG.fatal({
						'err': err,
						'res': res
					}, 'couldnt find instances');
					err = err || new Error(
						'couldnt find instances');
					return (subcb(err));
				}
				_self['INSTANCES'] = {};
				for (var i = 0; i < services.length; ++i) {
					var s = services[i];
					var ins = res.operations[i].result;
					_self['SERVICES'][s]['INSTANCES'] = ins;
					ins.map(function (inst) {
						_self['INSTANCES'][inst.uuid] =
							inst;
					});
				}
				return (subcb());
			});
		},
		function lookupVms(_, subcb) {
			_self.log.debug('looking up vms');
			var inputs = Object.keys(_self.INSTANCES).map(
				function (uuid) {
					return (_self['INSTANCES'][uuid]);
				});
			vasync.forEachParallel({
				'inputs': inputs,
				'func': findVm.bind(_self)
			}, function (err, results) {
				if (err) {
					subcb(err);
					return;
				}
				_self['VMS'] = {};
				var opers = results.operations;
				for (var i = 0; i < opers.length; ++i) {
					var uuid = inputs[i].uuid;
					var res = opers[i].result;
					_self['VMS'][uuid] = res;
				}
				_self.log.debug({
					'vms': Object.keys(
						_self['VMS']).sort()
				}, 'found vmapi vms');
				subcb();
			});
		},
		function lookupServers(_, subcb) {
			_self.log.debug('looking up servers for storage');
			var servers = [];
			var vms = _self['SERVICES']['storage']['INSTANCES'].map(
				function (inst) {
					return (inst.uuid);
				});
			for (var i = 0; i < vms.length; ++i) {
				var vm = _self['VMS'][vms[i]];
				var server = vm.server_uuid;
				if (servers.indexOf(server) === -1) {
					servers.push(server);
				}
			}
			vasync.forEachParallel({
				'inputs': servers,
				'func': findServer.bind(_self)
			}, function (err, results) {
				if (err) {
					subcb(err);
					return;
				}
				var opers = results.operations;
				_self['SERVERS'] = {};
				for (var j = 0; j < opers.length; ++j) {
					var uuid = servers[j];
					var res = opers[j].result;
					_self['SERVERS'][uuid] = res;
				}
				_self.log.debug({
					'servers': Object.keys(
						_self['SERVERS']).sort()
				}, 'found cnapi servers');
				subcb();
			});
		},
		function gatherHosts(_, subcb) {
			_self.log.debug('gathering kang sources');
			_self['KANG'] = [];

			// First the job supervisors
			var instances =
				_self['SERVICES']['jobsupervisor']['INSTANCES'];
			var m;
			var vm;
			for (var i = 0; i < instances.length; ++i) {
				var uuid = instances[i].uuid;
				vm = _self['VMS'][uuid];
				var nics = vm.nics;
				var ip = null;
				for (var j = 0; j < nics.length; ++j) {
					var nic = nics[j];
					var nt = _self['NETWORK_TAG'];
					if (nic.nic_tag === nt) {
						ip = nic.ip;
						break;
					}
				}

				if (!ip) {
					m = 'vm doesnt have nics';
					_self.log.error({
						'uuid': uuid,
						'vm': vm
					}, m);
					return (subcb(new Error(m)));
				}

				_self.KANG.push(ip);
			}

			_self.log.debug({
				'sources': _self.KANG
			}, 'kang sources after job supervisors');

			// Now the marlin agents...
			instances =
				_self['SERVICES']['storage']['INSTANCES'];
			instances.map(function (inst) {
				vm = _self['VMS'][inst.uuid];
				var sv = _self['SERVERS'][vm.server_uuid];
				if (sv === undefined) {
					m = 'didnt find server for vm';
					_self.log.error({
						'vm': vm
					}, m);
					return (subcb(new Error(m)));
				}
				ip = findServerIp(_self['NETWORK_TAG'], sv);
				if (ip === null) {
					m = 'didnt find ip for server';
					_self.log.error({
						'server': sv
					}, m);
					return (subcb(new Error(m)));
				}
				var src = ip + ':9080';
				if (_self.KANG.indexOf(src) === -1) {
					_self.KANG.push(src);
				}
			});
			_self.log.debug({
				'sources': _self.KANG
			}, 'kang sources after marlin agents');
			subcb();
		}
	]
}, function (err) {
	if (err) {
		_self.log.fatal(err);
		process.exit(1);
	}

	// Ok, now output config...
	var serialized = JSON.stringify({
		'index': 'index.htm',
		'listenPort': 80,
		'kang_sources': _self.KANG
	}, null, 2);
	fs.writeFileSync(_self['OUTPUT_FILENAME'], serialized);
	_self.log.debug('Done.');
	process.exit(0);
});
