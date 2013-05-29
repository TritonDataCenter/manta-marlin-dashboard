#
# Copyright (c) 2013, Joyent, Inc. All rights reserved.
#
# Makefile: top-level Makefile
#
# This Makefile contains only repo-specific logic and uses included makefiles
# to supply common targets (javascriptlint, jsstyle, restdown, etc.), which are
# used by other repos as well.
#

#
# Tools
#
NPM		?= npm

#
# Files
#
JSL_FILES_NODE	:= $(wildcard bin/*.js)
JSL_CONF_NODE	 = tools/jsl.node.conf
JSL_FILES_WEB	:= $(wildcard www/*.js)
JSL_CONF_WEB	 = tools/jsl.web.conf
JS_FILES	 = $(JSL_FILES_WEB) $(JSL_FILES_NODE)
JSSTYLE_FILES	 = $(JS_FILES)

all:
	$(NPM) install

CLEAN_FILES += node_modules

include ./tools/Makefile.targ
