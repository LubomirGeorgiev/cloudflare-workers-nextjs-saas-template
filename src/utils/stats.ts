import "server-only";
import { getDB } from "@/db";
import { userTable } from "@/db/schema";
import { CACHE_TAGS, setCacheScope } from "./cache";
import { GITHUB_REPO_URL, SITE_DOMAIN } from "@/constants";

export async function getTotalUsers() {
  "use cache: remote";
  setCacheScope({
    tags: [CACHE_TAGS.TOTAL_USERS],
    ttl: "1 hour",
  });

  const db = getDB();

  return await db.$count(userTable);
}

export async function getGithubStars() {
  if (!GITHUB_REPO_URL || typeof GITHUB_REPO_URL !== "string") {
    return null;
  }

  // Extract owner and repo from GitHub URL
  const match = (GITHUB_REPO_URL as string)?.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) return null;

  const [, owner, repo] = match;

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
    tags: [CACHE_TAGS.githubStars({ owner, repo })],
    ttl: "1 hour",
  });

  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: {
      "User-Agent": `cloudflare-workers-nextjs-saas-template (${SITE_DOMAIN})`,
    },
  });

  if (!response.ok) return null;

  const data = (await response.json()) as {
    stargazers_count: number;
  };

  return data.stargazers_count;
}
