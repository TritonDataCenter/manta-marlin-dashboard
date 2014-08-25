#!/bin/bash
# -*- mode: shell-script; fill-column: 80; -*-
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright (c) 2014, Joyent, Inc.
#

set -o xtrace

SOURCE="${BASH_SOURCE[0]}"
if [[ -h $SOURCE ]]; then
    SOURCE="$(readlink "$SOURCE")"
fi
DIR="$( cd -P "$( dirname "$SOURCE" )" && pwd )"
SVC_ROOT=/opt/smartdc/marlin-dashboard

source ${DIR}/scripts/util.sh
source ${DIR}/scripts/services.sh


export PATH=$SVC_ROOT/build/node/bin:/opt/local/bin:/usr/sbin/:/usr/bin:$PATH

function manta_setup_marlin_user {
    useradd -c "Marlin" -b /home -d /home/marlin -s /usr/bin/bash marlin
    usermod -K defaultpriv=basic,net_privaddr marlin
    mkdir /home/marlin
    chown marlin /home/marlin
    cp -r /root/.ssh /home/marlin/.
    chown -R marlin /home/marlin/.ssh
    cat /opt/smartdc/common/etc/config.json | \
        json -e "this.manta.sign.key='/home/marlin/.ssh/id_rsa'" \
        >/home/marlin/manta.config.json
}

function manta_setup_marlin_dashboard {
    /opt/smartdc/marlin-dashboard/bin/generate-config.js
    if [[ $? != 0 ]]; then
        echo "Unable to generate marlin dashboard config."
        exit 1;
    fi

    #Server
    svccfg import $SVC_ROOT/smf/manifests/marlin-dashboard.xml \
        || fatal "unable to import marlin dashboard manifest"
    svcadm enable marlin-dashboard || fatal "unable to start marlin-dashboard"

    manta_add_logadm_entry "marlin-dashboard"
}


# Mainline

echo "Running common setup scripts"
manta_common_presetup

#echo "Adding local manifest directories"
manta_add_manifest_dir "/opt/smartdc/marlin-dashboard"

manta_common_setup "marlin-dashboard"

manta_ensure_zk

manta_setup_marlin_user

echo "Setting up marlin-dashboard"
manta_setup_marlin_dashboard

manta_common_setup_end

exit 0
