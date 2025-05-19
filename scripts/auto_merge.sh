#!/bin/bash
# Automatically merge the latest main branch into the current branch.
# If conflicts occur, the script tries to favor incoming changes.

set -e

TARGET_BRANCH="${1:-main}"

# Fetch the latest changes from origin
git fetch origin "$TARGET_BRANCH"

# Attempt the merge using the 'theirs' strategy
if ! git merge -s recursive -X theirs "origin/$TARGET_BRANCH"; then
  echo "Automatic merge failed. Please resolve conflicts manually." >&2
  exit 1
fi

echo "Merge completed successfully."
