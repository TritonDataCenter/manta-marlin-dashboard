#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright 2020 Joyent, Inc.
#

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

#
# Variables
#
NAME			= marlin-dashboard
NODE_PREBUILT_VERSION	= v0.10.48
NODE_PREBUILT_TAG	= zone
NODE_PREBUILT_IMAGE	= fd2cc906-8938-11e3-beab-4359c665ac99

ENGBLD_USE_BUILDIMAGE	= true
ENGBLD_REQUIRE		:= $(shell git submodule update --init deps/eng)
include ./deps/eng/tools/mk/Makefile.defs
TOP ?= $(error Unable to access eng.git submodule Makefiles.)

ifeq ($(shell uname -s),SunOS)
	include ./deps/eng/tools/mk/Makefile.node_prebuilt.defs
	include ./deps/eng/tools/mk/Makefile.agent_prebuilt.defs
else
	include ./deps/eng/tools/mk/Makefile.node.defs
endif
include ./deps/eng/tools/mk/Makefile.smf.defs

#
# MG Variables
#
RELEASE_TARBALL	:= $(NAME)-pkg-$(STAMP).tar.gz
ROOT		:= $(shell pwd)
RELSTAGEDIR	:= /tmp/$(NAME)-$(STAMP)

BASE_IMAGE_UUID = fd2cc906-8938-11e3-beab-4359c665ac99
BUILDIMAGE_NAME = mantav1-marlin-dashboard
BUILDIMAGE_DESC	= Manta marlin dashboard
AGENTS		= amon config registrar

# For mantav1, specify the branch to compare copyrights with
ENGBLD_CHECK_COPYRIGHT_ARGS = -b mantav1

#
# v8plus uses the CTF tools as part of its build, but they can safely be
# overridden here so that this works in dev zones without them.
# See marlin.git Makefile.
#
NPM_ENV		= MAKE_OVERRIDES="CTFCONVERT=/bin/true CTFMERGE=/bin/true"

#
# Repo-specific targets
#
.PHONY: all
all: $(SMF_MANIFESTS) | $(NPM_EXEC) $(REPO_DEPS) scripts
	$(NPM) install

CLEAN_FILES += node_modules
CLEAN_FILES += build

.PHONY: scripts
scripts: deps/manta-scripts/.git
	mkdir -p $(BUILD)/scripts
	cp deps/manta-scripts/*.sh $(BUILD)/scripts

release: all docs $(SMF_MANIFESTS)
	@echo "Building $(RELEASE_TARBALL)"
	@mkdir -p $(RELSTAGEDIR)/root/opt/smartdc/$(NAME)
	@mkdir -p $(RELSTAGEDIR)/root/opt/smartdc/boot
	@mkdir -p $(RELSTAGEDIR)/site
	@touch $(RELSTAGEDIR)/site/.do-not-delete-me
	@mkdir -p $(RELSTAGEDIR)/root
	@mkdir -p $(RELSTAGEDIR)/root/opt/smartdc/$(NAME)/etc
	cp -r   $(ROOT)/bin \
		$(ROOT)/boot \
		$(ROOT)/build \
		$(ROOT)/etc \
		$(ROOT)/node_modules \
		$(ROOT)/package.json \
		$(ROOT)/sapi_manifests \
		$(ROOT)/smf \
		$(ROOT)/www \
		$(RELSTAGEDIR)/root/opt/smartdc/$(NAME)
	#We remove build/prebuilt-* because those symlinks will cause tar
	# to complain when re-taring as a bundle once deployed, MANTA-495
	rm $(RELSTAGEDIR)/root/opt/smartdc/$(NAME)/build/prebuilt-*
	mv $(RELSTAGEDIR)/root/opt/smartdc/$(NAME)/build/scripts \
	    $(RELSTAGEDIR)/root/opt/smartdc/$(NAME)/boot
	ln -s /opt/smartdc/$(NAME)/boot/setup.sh \
	    $(RELSTAGEDIR)/root/opt/smartdc/boot/setup.sh
	chmod 755 $(RELSTAGEDIR)/root/opt/smartdc/$(NAME)/boot/setup.sh
	(cd $(RELSTAGEDIR) && $(TAR) -I pigz -cf $(ROOT)/$(RELEASE_TARBALL) root site)
	@rm -rf $(RELSTAGEDIR)

.PHONY: publish
publish: release
	mkdir -p $(ENGBLD_BITS_DIR)/$(NAME)
	cp $(ROOT)/$(RELEASE_TARBALL) $(ENGBLD_BITS_DIR)/$(NAME)/$(RELEASE_TARBALL)

include ./deps/eng/tools/mk/Makefile.deps
ifeq ($(shell uname -s),SunOS)
	include ./deps/eng/tools/mk/Makefile.node_prebuilt.targ
	include ./deps/eng/tools/mk/Makefile.agent_prebuilt.targ
else
	include ./deps/eng/tools/mk/Makefile.node.targ
endif
include ./deps/eng/tools/mk/Makefile.smf.targ
include ./deps/eng/tools/mk/Makefile.targ
