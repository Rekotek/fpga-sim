# Site settings for the deployment scripts (decision 173): sourced, not run.
# Reads FPGASIM_SITE_ENV (default ~/.config/fpgasim/site.env) if it exists; variables already set
# in the environment win over the file. The format is described in deploy/site.env.example.
FPGASIM_SITE_ENV="${FPGASIM_SITE_ENV:-${HOME}/.config/fpgasim/site.env}"
if [ -f "${FPGASIM_SITE_ENV}" ]; then
    while IFS='=' read -r name value; do
        case "${name}" in '' | \#*) continue ;; esac
        if [ -z "${!name:-}" ]; then export "${name}=${value}"; fi
    done < "${FPGASIM_SITE_ENV}"
fi
