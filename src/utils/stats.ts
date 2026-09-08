import "server-only";
import { cache } from "react";
import { setCacheScope } from "./cache";
import { GITHUB_REPO_URL, SITE_DOMAIN } from "@/constants";

// api.github.com is a third party on the render path of every public page. The badge streams behind
// a Suspense boundary, so a null count only costs the star number; an open socket costs the whole
// response, which is why this fetch always carries a deadline.
const GITHUB_STARS_FETCH_TIMEOUT_MS = 2_000;

export const getGithubStars = cache(async () => {
  if (!GITHUB_REPO_URL || typeof GITHUB_REPO_URL !== "string") {
    return null;
  }

  const match = GITHUB_REPO_URL.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) {
    return null;
  }

  const [, owner, rawRepo] = match;
  const repo = rawRepo?.replace(/\.git$/, "");

  if (!owner || !repo) {
    return null;
  }

  return getCachedGithubStars({ owner, repo });
});

async function getCachedGithubStars({
  owner,
  repo,
}: {
  owner: string;
  repo: string;
}) {
  "use cache: remote";
  setCacheScope({
    ttl: "1 hour",
  });

  const headers: HeadersInit = {
    Accept: "application/vnd.github+json",
    "User-Agent": `cloudflare-workers-nextjs-saas-template (${SITE_DOMAIN})`,
  };

  const githubToken = process.env.GITHUB_TOKEN;
  if (githubToken) {
    headers.Authorization = `Bearer ${githubToken}`;
  }

  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers,
      signal: AbortSignal.timeout(GITHUB_STARS_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      stargazers_count: number;
    };

    return data.stargazers_count;
  } catch {
    return null;
  }
}
