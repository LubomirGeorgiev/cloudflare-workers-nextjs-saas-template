import { findDeployLocalModeProblem, findDeploySiteUrlProblem } from './utils/deploy-site-url.mjs';

const problems = [
  findDeploySiteUrlProblem(process.env.NEXT_PUBLIC_SITE_URL),
  findDeployLocalModeProblem(process.env.NEXT_PUBLIC_APP_LOCAL_MODE),
].filter(Boolean);

if (problems.length > 0) {
  console.error(problems.join("\n\n"));
  process.exit(1);
}
