# Marlin dashboard

This is the temporary home of the Marlin dashboard.  It will eventually be
folded into a proper Manta operations dashboard.

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
