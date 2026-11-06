#!/usr/bin/env bash
#
# Configure npm trusted publishing for packages of this repository, so that the Release workflow
# (.github/workflows/release.yml) can publish them without an npm token.
#
# A new configuration expires if no publish succeeds with it within 2 days, so only configure the
# packages about to be published: run this on the "Version packages" pull request branch before
# merging it (no argument), or pass the package names. Needs npm 11.15+, write access to the
# packages and 2FA: npm asks for it on the first package, then skips it for 5 minutes.
#
# Usage: scripts/trust-packages.sh [--dry-run] [package...]

set -Eeuo pipefail

repository="folkloreinc/pingpong"
workflow="release.yml"
dry_run=()

if [ "${1:-}" = "--dry-run" ]; then
    dry_run=(--dry-run)
    shift
fi

if [ $# -gt 0 ]; then
    packages=("$@")
else
    # Packages whose current version isn't on npm yet
    plan_file="$(mktemp)"
    trap 'rm -f "$plan_file"' EXIT
    npx changeset publish-plan --output "$plan_file" > /dev/null
    names="$(node -e '
        const { plan } = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
        plan.flat()
            .filter((release) => release.kind === "publish")
            .forEach((release) => console.log(release.name));
    ' "$plan_file")"
    packages=()
    while IFS= read -r package; do
        [ -n "$package" ] && packages+=("$package")
    done <<< "$names"
fi

if [ ${#packages[@]} -eq 0 ]; then
    echo "No package to configure: every version is already on npm."
    exit 0
fi

failed=()
for package in "${packages[@]}"; do
    echo "Configuring ${package}..."
    if ! npm trust github "$package" \
        --file "$workflow" \
        --repository "$repository" \
        --allow-publish \
        --yes \
        ${dry_run[@]+"${dry_run[@]}"}; then
        failed+=("$package")
    fi
    sleep 2
done

if [ ${#failed[@]} -gt 0 ]; then
    echo "Failed (already configured, or no write access?): ${failed[*]}" >&2
    exit 1
fi
