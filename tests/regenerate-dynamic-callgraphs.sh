#!/usr/bin/env bash

TESTS=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

if ! [ -f /.dockerenv ]; then
  echo "Running in docker image jelly:latest..."

  if docker info --format '{{join .SecurityOptions "\n"}}' | grep --silent "name=rootless"; then
	  OPTS=""
  else
	  OPTS="--user $(id -u):$(id -g) -e HOME=/tmp"
  fi

  exec docker run --rm -it $OPTS -v "$TESTS":/workspace -w /workspace --entrypoint bash jelly:latest "./regenerate-dynamic-callgraphs.sh"
fi

cd "$TESTS/micro" || exit 1

for f in *.*js; do
	JSON="${f%.*}.json"
	if [[ -f "${JSON}" ]]; then
		jelly --skip-graal-test --dynamic "$JSON" "$f"
	fi
done

cd ../mochatest || exit 1

jelly --skip-graal-test --dynamic "test.json" --npm-test .

# TODO: Can we regenerate the CG for the express helloworld example too, which is a server application?
