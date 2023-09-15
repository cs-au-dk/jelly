#!/usr/bin/env bash

TESTS=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

if ! [ -f /.dockerenv ]; then
  echo "Running in docker image jelly:latest..."

  OPTS=(--rm -it -v "$TESTS":/workspace -w /workspace --entrypoint bash)
  if ! docker info --format '{{join .SecurityOptions "\n"}}' | grep --silent "name=rootless"; then
    OPTS+=(--user "$(id -u):$(id -g)" -e HOME=/tmp)
  fi

  exec docker run "${OPTS[@]}" jelly:latest "./regenerate-dynamic-callgraphs.sh"
fi

set -euo pipefail

cd "$TESTS/micro"

for f in *.*js; do
  JSON="${f%.*}.json"
  if [[ -f "${JSON}" ]]; then
    jelly --skip-graal-test --dynamic "$JSON" "$f"
  fi
done

cd "$TESTS/mochatest"

jelly --skip-graal-test --dynamic "test.json" --npm-test .
jelly --skip-graal-test --dynamic "test-with-hook.json" --npm-test . -- -- -r ./require-hook

cd "$TESTS/helloworld"

# Run server in background
jelly --skip-graal-test --dynamic app.json app.js &
PID=$!

# Wait for server to come up and send two requests
node --no-warnings --eval "(async () => {
  while(true) {
    try {
      await fetch('http://localhost:3000/does-not-exist');
      console.log('Server is running');
      break;
    } catch(e) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  const response = await fetch('http://localhost:3000');
  console.log(await response.text());
})()"

wait $PID
