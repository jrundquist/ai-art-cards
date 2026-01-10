#!/bin/bash

# Ensure we have a GH_TOKEN
if [ -z "$GH_TOKEN" ]; then
  echo "Error: GH_TOKEN environment variable is not set."
  echo "Please export your GitHub Personal Access Token."
  echo "Example: export GH_TOKEN=your_token_here"
  exit 1
fi

# Check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
  echo "⚠️  Uncommitted changes detected."
  read -p "Do you want to commit them as 'chore: prepare release' before determining version? (y/n) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    git add .
    git commit -m "chore: prepare release"
  else
    echo "Aborting. Please clean your working directory."
    exit 1
  fi
fi

# Ask for version bump type
echo "Current version: $(node -p "require('./package.json').version")"
echo "Select version bump:"
select bump in "patch" "minor" "major"; do
    case $bump in
        patch|minor|major ) break;;
        * ) echo "Please select 1-3";;
    esac
done

# Bump version (creates git tag)
echo "Bumping version ($bump)..."
npm version $bump -m "chore(release): %s"

# Build and Publish
echo "Building and Publishing to GitHub..."
yarn dist --publish always

# Push changes and tags
echo "Pushing to GitHub..."
git push && git push --tags

echo "Done! Release published."
