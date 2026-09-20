#!/usr/bin/env bash
# PostToolUse hook: enforce `terraform fmt` on edited .tf/.tfvars files.
#
# Single-file, non-recursive `terraform fmt -check -write=false "$FILE"`
# only -- deliberately NOT `terraform fmt -check -recursive terraform/`.
# That relative recursive form regressed twice while drafting this hook
# (#1098): from a foreign cwd it exits 2 with "Error: No file or
# directory at terraform" (a bare non-zero check would misreport that as
# drift), and resolved against $CLAUDE_PROJECT_DIR it checks the ROOT
# checkout -- a different branch from whichever worktree this hook is
# actually running in, so it can hard-block on drift unrelated to the
# file just edited. Scoping to the one absolute path this PostToolUse
# call actually touched avoids both failure modes.
#
# Hard-block convention (modeled on check-alpine-csp.sh): print offenders,
# exit 2. Not the advisory JSON "decision":"block" protocol
# check-palette-drift.sh uses -- fmt drift is unambiguous and mechanically
# fixable, so there is no judgment call to defer to the agent.

FILE=$(jq -r '.tool_input.file_path // empty')
[[ -z "$FILE" ]] && exit 0
[[ "$FILE" != *.tf && "$FILE" != *.tfvars ]] && exit 0
[[ ! -f "$FILE" ]] && exit 0

# This file is checked into git and runs in every operator session and
# worktree. A missing `terraform` binary must never nag -- fail open,
# silently.
command -v terraform >/dev/null 2>&1 || exit 0

# Capture stderr only; discard terraform's own stdout. terraform prints
# the offending path relative to CWD (verified: it printed
# "../../../tmp/..." when run from /tmp), which would be unreadable in a
# hook message -- the messages below always name "$FILE" itself instead.
stderr_output=$(terraform fmt -check -write=false "$FILE" 2>&1 >/dev/null)
exit_code=$?

if [[ "$exit_code" -eq 0 ]]; then
    exit 0
fi

if [[ "$exit_code" -eq 3 ]]; then
    echo "TERRAFORM FMT DRIFT in $FILE"
    echo ""
    echo "Fix with: terraform fmt -recursive terraform/"
    exit 2
fi

# Any other non-zero exit is a terraform error (e.g. invalid HCL), not
# fmt drift -- do not conflate the two or suggest the fmt fix for it.
echo "TERRAFORM ERROR checking $FILE (not fmt drift):"
echo "$stderr_output"
exit 2
