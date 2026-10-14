// Prints the test-run history (backend/tests/results.json) as a table. Run: npm run test:report
import fs from "fs";
const file = new URL("./results.json", import.meta.url);
if (!fs.existsSync(file)) { console.log("No runs recorded yet. Run npm test."); process.exit(0); }
const runs = JSON.parse(fs.readFileSync(file, "utf8"));
console.log("| When (UTC) | Passed | Failed | Commit |\n|---|---|---|---|");
for (const r of runs.slice(-15).reverse()) console.log(`| ${r.at.slice(0, 16).replace("T", " ")} | ${r.passed} | ${r.failed} | ${r.commit ? r.commit.slice(0, 7) : "local"} |`);
const last = runs[runs.length - 1];
console.log(`\nLatest: ${last.failed ? "FAILING" : "passing"} (${last.passed} checks)`);
