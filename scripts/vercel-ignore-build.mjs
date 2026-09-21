// Vercel "Ignored Build Step": decides whether a deployment is allowed to build.
//
// GitHub branch protection is unavailable on a private repo on the Free plan, so the
// gate lives here instead. A production build waits for the CI workflow to finish on
// the same commit and proceeds only if every required check passed.
//
// Vercel's contract is inverted from a normal script:
//   exit 0 -> SKIP the build
//   exit 1 -> RUN the build
//
// Set GITHUB_CI_TOKEN in the Vercel project (a fine-grained token with read-only
// access to Checks on this repository). Previews always build.

const REQUIRED_CHECKS = ["Types, lint, tests", "End-to-end"];
const POLL_INTERVAL_MS = 15_000;
const TIMEOUT_MS = 20 * 60_000;

// A missing or broken token is a configuration problem, not a failing test. Building
// anyway keeps a bad token from silently halting every deploy — at the cost that the
// gate disappears if the token expires. Set this to false to fail closed instead.
const BUILD_ON_CONFIG_ERROR = true;

const SKIP = 0;
const BUILD = 1;

const skip = (reason) => ({ code: SKIP, reason });
const build = (reason) => ({ code: BUILD, reason });
const onConfigError = (reason) => (BUILD_ON_CONFIG_ERROR ? build(reason) : skip(reason));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const { VERCEL_ENV, VERCEL_GIT_COMMIT_SHA, VERCEL_GIT_REPO_OWNER, VERCEL_GIT_REPO_SLUG } =
    process.env;
  const token = process.env.GITHUB_CI_TOKEN;

  if (VERCEL_ENV !== "production") {
    return build(`${VERCEL_ENV ?? "unknown"} deployment — previews are not gated.`);
  }
  if (!token) {
    return onConfigError("GITHUB_CI_TOKEN is not set, so CI status cannot be read.");
  }
  if (!VERCEL_GIT_COMMIT_SHA || !VERCEL_GIT_REPO_OWNER || !VERCEL_GIT_REPO_SLUG) {
    return onConfigError("Vercel git environment variables are missing.");
  }

  const endpoint =
    `https://api.github.com/repos/${VERCEL_GIT_REPO_OWNER}/${VERCEL_GIT_REPO_SLUG}` +
    `/commits/${VERCEL_GIT_COMMIT_SHA}/check-runs?per_page=100`;

  /** Returns the required check runs on this commit, or null if the request failed. */
  async function fetchRequiredRuns() {
    const response = await fetch(endpoint, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "user-agent": "tolle-lege-deploy-gate",
        "x-github-api-version": "2022-11-28",
      },
    });
    if (!response.ok) {
      console.log(`GitHub API returned ${response.status}.`);
      return null;
    }
    const { check_runs: runs = [] } = await response.json();
    return runs.filter((run) => REQUIRED_CHECKS.includes(run.name));
  }

  const sha = VERCEL_GIT_COMMIT_SHA.slice(0, 7);
  console.log(`Waiting for CI on ${sha}: ${REQUIRED_CHECKS.join(", ")}`);

  const deadline = Date.now() + TIMEOUT_MS;
  let consecutiveApiFailures = 0;

  while (Date.now() < deadline) {
    const runs = await fetchRequiredRuns().catch(() => null);

    if (runs === null) {
      // The token can be revoked mid-wait; don't let one blip decide the deployment.
      if (++consecutiveApiFailures >= 4) {
        return onConfigError("GitHub API unreachable after 4 attempts.");
      }
    } else {
      consecutiveApiFailures = 0;
      const completed = runs.filter((run) => run.status === "completed");
      const failed = completed.filter(
        (run) => run.conclusion !== "success" && run.conclusion !== "skipped",
      );
      if (failed.length > 0) {
        const detail = failed.map((run) => `${run.name} (${run.conclusion})`).join(", ");
        return skip(`CI failed on ${sha}: ${detail}`);
      }
      if (completed.length === REQUIRED_CHECKS.length) {
        return build(`all ${REQUIRED_CHECKS.length} required checks passed on ${sha}.`);
      }
      const waiting = REQUIRED_CHECKS.filter(
        (name) => !completed.some((run) => run.name === name),
      );
      console.log(`  still waiting on: ${waiting.join(", ")}`);
    }

    await sleep(POLL_INTERVAL_MS);
  }

  return skip(`timed out after ${TIMEOUT_MS / 60_000} minutes waiting for CI on ${sha}.`);
}

// Set exitCode rather than calling process.exit(), so pending sockets close cleanly.
const { code, reason } = await main();
console.log(`${code === BUILD ? "BUILD" : "SKIP"}: ${reason}`);
process.exitCode = code;
