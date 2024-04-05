#!/usr/bin/env sh

# If a single file name [file.js] is specified, only regenerate for that single. Format is the file name *with* extension
FILE_TO_REGEN=$1
if [ -n "$FILE_TO_REGEN" ]; then
  echo "Regenerating hints and dynamic call graph for single file $FILE_TO_REGEN"
      filename_without_extension="${FILE_TO_REGEN%.js}"

      # Generate hints files
      node lib/main.js --approx-only tests/approx/hints-"$filename_without_extension".json tests/approx/"$FILE_TO_REGEN"

      # Generate dynamic call graphs
      node lib/main.js -d tests/approx/"$filename_without_extension".json tests/approx/"$FILE_TO_REGEN" --skip-graal-test
  exit 0
fi


# Regenerate hints files and dynamic call graphs for all .js files in the test directory
for file in tests/approx/*.js; do
  echo "Regenerating hints and dynamic call graph for $file"
  if [ -f "$file" ]; then
    filename=$(basename "$file")
    filename_without_extension="${filename%.js}"

    # Generate hints files
    node lib/main.js --approx-only tests/approx/hints-"$filename_without_extension".json tests/approx/"$filename"

    # Generate dynamic call graphs
    node lib/main.js -d tests/approx/"$filename_without_extension".json tests/approx/"$filename" --skip-graal-test
  fi
done

for file in tests/approx/hintsOnly/*.js; do
  echo "Regenerating hints for $file"
    if [ -f "$file" ]; then
      filename=$(basename "$file")
      filename_without_extension="${filename%.js}"

      # Generate hints files
      node lib/main.js --approx-only tests/approx/hints-"$filename_without_extension".json tests/approx/hintsOnly/"$filename"
  fi
done

# TODO: Clean up instead of having specific tasks for all special cases

# Regenerate for packageStructure
node lib/main.js --approx-only tests/approx/hints-packageStructure.json tests/approx/packageStructure

# Regenerate for typescript file
node lib/main.js --approx-only tests/approx/hints-ts-file.json tests/approx/ts-file.ts
