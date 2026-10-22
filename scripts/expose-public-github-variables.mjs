import { appendFileSync } from "node:fs";

// The build bakes NEXT_PUBLIC_* values in, and the deploy scripts read them, so both CI jobs call this.
const variables = JSON.parse(process.env.GITHUB_VARIABLES_JSON || "{}");
const publicVariableNames = Object.keys(variables)
  .filter((name) => /^NEXT_PUBLIC_[A-Z0-9_]+$/.test(name))
  .sort();

for (const name of publicVariableNames) {
  const delimiter = `GITHUB_ENV_${name}_${Date.now()}`;
  appendFileSync(
    process.env.GITHUB_ENV,
    `${name}<<${delimiter}\n${variables[name]}\n${delimiter}\n`
  );
}

console.log(
  publicVariableNames.length > 0
    ? `Exposed public variables: ${publicVariableNames.join(", ")}`
    : "No NEXT_PUBLIC_* GitHub variables found."
);
