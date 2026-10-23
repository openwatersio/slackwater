#!/bin/bash
set -e

# Publish workspace packages sequentially in topological order
# (following the `workspaces` array in root package.json).
#
# This replaces `changeset publish` to work around:
# - changesets/changesets#238: packages published concurrently, not in dependency order
# - npm/cli#4513: npm registry eventual consistency causes ETARGET errors

# Create git tags first so changesets/action can create GitHub Releases
# even if an npm publish fails
changeset git-tag

# `changeset publish` would take the dist-tag from pre mode; npm publish needs it passed
tag=latest
if [ "$(jq -r '.mode // empty' .changeset/pre.json 2>/dev/null)" = "pre" ]; then
  tag=$(jq -r '.tag' .changeset/pre.json)
fi

# Read workspaces from root package.json
workspaces=$(jq -r '.workspaces[]' package.json)

for workspace in $workspaces; do
  package_json="$workspace/package.json"
  name=$(jq -r '.name' "$package_json")
  version=$(jq -r '.version' "$package_json")

  # Check if version exists on npm
  if npm view "$name@$version" version &>/dev/null; then
    echo "✓ $name@$version is already published"
    continue
  fi

  npm publish --provenance -w "$name" --access public --tag "$tag"
  echo "✓ Successfully published $name@$version under $tag"
done

echo ""
echo "✓ All packages published successfully"
