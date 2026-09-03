import { findDeploySiteUrlProblem } from './utils/deploy-site-url.mjs';

const problem = findDeploySiteUrlProblem(process.env.NEXT_PUBLIC_SITE_URL);

if (problem) {
  console.error(problem);
  process.exit(1);
}
