#!/usr/bin/env bun
/**
 * Browser Comparison Benchmark Runner
 *
 * Runs all scenarios across all drivers (agent-browser, pinchtab-cli, pinchtab-http),
 * collecting performance metrics and generating grading.json files compatible
 * with aggregate_benchmark.py.
 *
 * Usage:
 *   bun run benchmarks/browser-comparison/run.ts [--runs N] [--drivers d1,d2] [--scenarios s1,s2]
 *
 * Prerequisites:
 *   - Chrome running with --remote-debugging-port=9222 (for agent-browser)
 *   - PinchTab server running: pinchtab (port 9867)
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AgentBrowserDriver } from './drivers/agent-browser'
import { estimateTokens } from './drivers/base'
import type { BrowserDriver, DriverResult } from './drivers/base'
import { PinchTabCLIDriver } from './drivers/pinchtab-cli'
import { PinchTabHTTPDriver } from './drivers/pinchtab-http'
import { allScenarios } from './scenarios/index'
import type { Scenario } from './scenarios/index'

// ---------------------------------------------------------------------------
// CLI Args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)

function getArg(name: string, fallback: string): string {
  const idx = args.indexOf(`--${name}`)
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback
}

const RUNS_PER_CONFIG = Number.parseInt(getArg('runs', '3'), 10)
const DRIVER_FILTER = getArg('drivers', '').split(',').filter(Boolean)
const SCENARIO_FILTER = getArg('scenarios', '').split(',').filter(Boolean)

// ---------------------------------------------------------------------------
// Driver Factory
// ---------------------------------------------------------------------------

function createDrivers(): BrowserDriver[] {
  const all: BrowserDriver[] = [
    new AgentBrowserDriver(),
    new PinchTabCLIDriver(),
    new PinchTabHTTPDriver(),
  ]
  if (DRIVER_FILTER.length > 0) {
    return all.filter((d) => DRIVER_FILTER.includes(d.name))
  }
  return all
}

function filterScenarios(): Scenario[] {
  if (SCENARIO_FILTER.length > 0) {
    return allScenarios.filter((s) => SCENARIO_FILTER.includes(s.id))
  }
  return allScenarios
}

// ---------------------------------------------------------------------------
// Grading — convert scenario results to grading.json format
// ---------------------------------------------------------------------------

interface GradingJSON {
  expectations: { text: string; passed: boolean; evidence: string }[]
  summary: { passed: number; failed: number; total: number; pass_rate: number }
  execution_metrics: {
    tool_calls: Record<string, number>
    total_tool_calls: number
    total_steps: number
    errors_encountered: number
    output_chars: number
  }
  timing: {
    total_duration_seconds: number
  }
}

function gradeRun(scenario: Scenario, outputs: Map<string, DriverResult>): GradingJSON {
  const expectations = scenario.expectations.map((exp) => {
    const result = exp.check(outputs)
    return { text: exp.text, passed: result.passed, evidence: result.evidence }
  })

  const passed = expectations.filter((e) => e.passed).length
  const total = expectations.length

  // Aggregate metrics from all outputs
  let totalDuration = 0
  let totalChars = 0
  let errorCount = 0

  for (const [, result] of outputs) {
    totalDuration += result.duration_ms
    totalChars += result.output?.length ?? 0
    if (!result.success) errorCount++
  }

  return {
    expectations,
    summary: {
      passed,
      failed: total - passed,
      total,
      pass_rate: total > 0 ? Math.round((passed / total) * 100) / 100 : 0,
    },
    execution_metrics: {
      tool_calls: { browser: outputs.size },
      total_tool_calls: outputs.size,
      total_steps: outputs.size,
      errors_encountered: errorCount,
      output_chars: totalChars,
    },
    timing: {
      total_duration_seconds: Math.round(totalDuration / 100) / 10,
    },
  }
}

// ---------------------------------------------------------------------------
// Output Writer
// ---------------------------------------------------------------------------

async function writeGrading(
  resultsDir: string,
  scenarioId: string,
  scenarioName: string,
  driverName: string,
  runNumber: number,
  grading: GradingJSON,
  rawOutputs: Map<string, DriverResult>,
): Promise<void> {
  const evalDir = join(resultsDir, `eval-${scenarioId}-${slugify(scenarioName)}`)
  const runDir = join(evalDir, driverName, `run-${runNumber}`)
  const outputsDir = join(runDir, 'outputs')

  await mkdir(outputsDir, { recursive: true })

  // Write grading.json
  await writeFile(join(runDir, 'grading.json'), JSON.stringify(grading, null, 2))

  // Write timing.json
  await writeFile(
    join(runDir, 'timing.json'),
    JSON.stringify(
      {
        total_duration_seconds: grading.timing.total_duration_seconds,
        total_tokens: estimateTokens([...rawOutputs.values()].map((r) => r.output).join('')),
      },
      null,
      2,
    ),
  )

  // Write raw outputs for debugging
  const outputData: Record<string, unknown> = {}
  for (const [key, result] of rawOutputs) {
    outputData[key] = {
      success: result.success,
      duration_ms: result.duration_ms,
      output_length: result.output?.length ?? 0,
      output_tokens: estimateTokens(result.output ?? ''),
      error: result.error,
      output_preview: (result.output ?? '').slice(0, 500),
    }
  }
  await writeFile(join(outputsDir, 'raw.json'), JSON.stringify(outputData, null, 2))

  // Write eval_metadata.json (at eval dir level, once)
  const metaPath = join(evalDir, 'eval_metadata.json')
  await writeFile(
    metaPath,
    JSON.stringify({ eval_id: scenarioId, eval_name: scenarioName }, null, 2),
  ).catch(() => {}) // OK if already exists
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

// ---------------------------------------------------------------------------
// Preflight Checks
// ---------------------------------------------------------------------------

async function preflight(drivers: BrowserDriver[]): Promise<BrowserDriver[]> {
  const available: BrowserDriver[] = []

  for (const driver of drivers) {
    try {
      await driver.startup()
      available.push(driver)
      console.log(`  [OK] ${driver.name}`)
    } catch (err) {
      console.log(`  [SKIP] ${driver.name}: ${err instanceof Error ? err.message : err}`)
    }
  }

  return available
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16)
  const resultsDir = join(import.meta.dir, 'results', timestamp)
  await mkdir(resultsDir, { recursive: true })

  console.log('=== Browser Comparison Benchmark ===')
  console.log(`Timestamp: ${timestamp}`)
  console.log(`Runs per config: ${RUNS_PER_CONFIG}`)
  console.log()

  // Preflight
  console.log('Checking driver availability...')
  const allDrivers = createDrivers()
  const drivers = await preflight(allDrivers)

  if (drivers.length === 0) {
    console.error('\nNo drivers available. Ensure browser services are running.')
    process.exit(1)
  }

  console.log(`\nAvailable drivers: ${drivers.map((d) => d.name).join(', ')}`)

  // Filter scenarios
  const scenarios = filterScenarios()
  console.log(`Scenarios: ${scenarios.map((s) => s.id).join(', ')}`)

  const totalRuns = drivers.length * scenarios.length * RUNS_PER_CONFIG
  console.log(`Total runs: ${totalRuns}\n`)

  // Execute
  let completed = 0

  for (const scenario of scenarios) {
    console.log(`\n--- ${scenario.id}: ${scenario.name} ---`)

    for (const driver of drivers) {
      for (let run = 1; run <= RUNS_PER_CONFIG; run++) {
        completed++
        const progress = `[${completed}/${totalRuns}]`
        process.stdout.write(`  ${progress} ${driver.name} run ${run}... `)

        try {
          const outputs = await scenario.run(driver)
          const grading = gradeRun(scenario, outputs)

          await writeGrading(
            resultsDir,
            scenario.id,
            scenario.name,
            driver.name,
            run,
            grading,
            outputs,
          )

          const passRate = (grading.summary.pass_rate * 100).toFixed(0)
          const duration = grading.timing.total_duration_seconds.toFixed(1)
          console.log(`${passRate}% pass, ${duration}s`)
        } catch (err) {
          console.log(`ERROR: ${err instanceof Error ? err.message : err}`)

          // Write error grading
          const errorGrading: GradingJSON = {
            expectations: scenario.expectations.map((e) => ({
              text: e.text,
              passed: false,
              evidence: `Run failed: ${err instanceof Error ? err.message : err}`,
            })),
            summary: {
              passed: 0,
              failed: scenario.expectations.length,
              total: scenario.expectations.length,
              pass_rate: 0,
            },
            execution_metrics: {
              tool_calls: {},
              total_tool_calls: 0,
              total_steps: 0,
              errors_encountered: 1,
              output_chars: 0,
            },
            timing: { total_duration_seconds: 0 },
          }

          await writeGrading(
            resultsDir,
            scenario.id,
            scenario.name,
            driver.name,
            run,
            errorGrading,
            new Map(),
          )
        }
      }
    }
  }

  // Shutdown drivers
  for (const driver of drivers) {
    await driver.shutdown().catch(() => {})
  }

  // Print summary
  console.log('\n=== Benchmark Complete ===')
  console.log(`Results: ${resultsDir}`)
  console.log('\nTo aggregate:')
  console.log(
    `  python .zero/skills/skill-creator/scripts/aggregate_benchmark.py ${resultsDir} --skill-name browser-comparison`,
  )

  // Generate a quick summary
  await generateQuickSummary(resultsDir, drivers, scenarios)
}

async function generateQuickSummary(
  resultsDir: string,
  drivers: BrowserDriver[],
  scenarios: Scenario[],
): Promise<void> {
  const lines: string[] = [
    '# Browser Comparison — Quick Summary',
    '',
    `| Scenario | ${drivers.map((d) => d.name).join(' | ')} |`,
    `|----------|${drivers.map(() => '--------').join('|')}|`,
  ]

  for (const scenario of scenarios) {
    const cells: string[] = []
    for (const driver of drivers) {
      // Read grading.json for run-1 (quick preview)
      const gradingPath = join(
        resultsDir,
        `eval-${scenario.id}-${slugify(scenario.name)}`,
        driver.name,
        'run-1',
        'grading.json',
      )
      try {
        const data = await Bun.file(gradingPath).json()
        const passRate = (data.summary.pass_rate * 100).toFixed(0)
        const time = data.timing.total_duration_seconds.toFixed(1)
        cells.push(`${passRate}% / ${time}s`)
      } catch {
        cells.push('N/A')
      }
    }
    lines.push(`| ${scenario.id}: ${scenario.name.split('—')[0].trim()} | ${cells.join(' | ')} |`)
  }

  const summaryMd = lines.join('\n')
  await writeFile(join(resultsDir, 'quick-summary.md'), summaryMd)
  console.log(`\n${summaryMd}`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
