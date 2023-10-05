#!/usr/bin/env bash

(cd tests/helloworld; npm ci)
(cd tests/mochatest; npm ci)
(cd tests/vulnerabilities; npm ci)
(cd tests/npm-packages; npm ci)
