<!--
    This Source Code Form is subject to the terms of the Mozilla Public
    License, v. 2.0. If a copy of the MPL was not distributed with this
    file, You can obtain one at http://mozilla.org/MPL/2.0/.
-->

<!--
    Copyright 2019 Joyent, Inc.
-->

# manta-marlin-dashboard

This repository is part of the Joyent Manta project.  For contribution
guidelines, issues, and general documentation, visit the main
[Manta](http://github.com/joyent/manta) project page.

This is the temporary home of the Marlin dashboard.  It will eventually be
folded into a proper Manta operations dashboard.


## Active Branches

This repository is part of mantav1, the long term support maintenance version
of Manta. Development is done on the **[`mantav1`](../../tree/mantav1/)
branch**, the `master` branch is no longer used. See the [mantav2 overview
document](https://github.com/joyent/manta/blob/master/docs/mantav2.md) for
details on major Manta versions.


# Development notes

You run the server as:

    $ bin/server.js etc/config.json

The configuration file specifies the listen port and a set of
[Kang](https://github.com/davepacheco/kang) servers to query, as in:

    {
        "index": "index.htm",
        "listenPort": 8080,
        "kang_sources": [
            "10.2.211.2:9080",
            "10.2.211.95",
            "10.2.211.96"
        ]
    }

The server doesn't log anything.  Besides a single dynamic resource, /marlin,
which returns the full Marlin distributed service snapshot, it also serves
static files in "www".
