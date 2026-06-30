import "server-only";
import { setCacheScope } from "./cache";
import { GITHUB_REPO_URL, SITE_DOMAIN } from "@/constants";

export async function getGithubStars() {
  if (!GITHUB_REPO_URL || typeof GITHUB_REPO_URL !== "string") {
    return null;
  }

  const match = GITHUB_REPO_URL.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) return null;

  const [, owner, rawRepo] = match;
  const repo = rawRepo?.replace(/\.git$/, "");

  if (!owner || !repo) return null;

  return getCachedGithubStars({ owner, repo });
}

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
    });

    if (!response.ok) return null;

    const data = (await response.json()) as {
      stargazers_count: number;
    };

    return data.stargazers_count;
  } catch {
    return null;
  }
}
