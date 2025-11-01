/**
 * tests/report/summaryReporter.ts
 * --------------------------------------------------------------------------
 * 🧭 Custom Jest Reporter — Summary & Insights Dashboard
 *
 * Collects final test results and outputs:
 *   ✅ Summary stats (passed, failed, skipped)
 *   ✅ Execution duration per suite
 *   ✅ Optional JSON file output for CI pipelines
 *   ✅ Highlights critical failures (e.g., quota or auth issues)
 *
 * Run automatically via Jest config or manually imported.
 * --------------------------------------------------------------------------
 */

import type { AggregatedResult, TestResult } from "@jest/test-result";
import type { Reporter, Context } from "@jest/reporters";
import fs from "fs";
import path from "path";

class SummaryReporter implements Reporter {
  private startTime: number = Date.now();

  onRunStart(): void {
    console.log("\n🚀 Starting full test suite...\n");
  }

  onTestResult(_test: any, result: TestResult): void {
    const duration = (result.perfStats.end - result.perfStats.start) / 1000;
    console.log(
      `🧩 ${result.testFilePath.split("/").pop()} — ${result.numPassingTests}/${result.testResults.length} passed (${duration.toFixed(
        2
      )}s)`
    );

    result.testResults.forEach((r) => {
      if (r.status === "failed") {
        console.log(`   ❌ ${r.fullName}`);
        if (r.failureMessages?.length)
          console.log(`      ↳ ${r.failureMessages[0].split("\n")[0]}`);
      }
    });
  }

  onRunComplete(_: Set<Context>, results: AggregatedResult): void {
    const totalTime = ((Date.now() - this.startTime) / 1000).toFixed(2);
    const summary = {
      passed: results.numPassedTests,
      failed: results.numFailedTests,
      skipped: results.numPendingTests,
      total: results.numTotalTests,
      duration: `${totalTime}s`,
      successRate: `${(
        (results.numPassedTests / (results.numTotalTests || 1)) *
        100
      ).toFixed(2)}%`,
      timestamp: new Date().toISOString(),
    };

    console.log("\n────────────────────────────────────────────");
    console.log("🧾 TEST SUMMARY");
    console.log("────────────────────────────────────────────");
    console.log(`✅ Passed: ${summary.passed}`);
    console.log(`❌ Failed: ${summary.failed}`);
    console.log(`⏸️ Skipped: ${summary.skipped}`);
    console.log(`🧮 Total: ${summary.total}`);
    console.log(`📈 Success Rate: ${summary.successRate}`);
    console.log(`⏱️ Duration: ${summary.duration}`);
    console.log("────────────────────────────────────────────\n");

    // Save structured log to file for CI/CD monitoring
    const outputDir = path.resolve(process.cwd(), "tests/report/output");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    fs.writeFileSync(
      path.join(outputDir, "test-summary.json"),
      JSON.stringify(summary, null, 2)
    );

    // Highlight critical failures
    if (results.numFailedTests > 0) {
      console.warn("🚨 Critical: Some tests failed. Review logs for details.\n");
    } else {
      console.log("🎉 All tests passed successfully!\n");
    }
  }
}

export default SummaryReporter;