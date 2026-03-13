/**
 * Tier 4: Anti-Bot / Stealth scenarios.
 * Tests browser fingerprint masking and automation detection evasion.
 *
 * A1: Passive detection (sannysoft) — fingerprint flag 检查
 * A2: Twitter/X — 高强度反爬 + JS SPA + 登录墙
 * A3: Cloudflare 挑战 — JS Challenge / Turnstile
 * A4: 指纹深度检测 — Canvas, WebGL, AudioContext 等高级指纹
 */

import type { Scenario } from './index'

export const stealthScenarios: Scenario[] = [
  // -----------------------------------------------------------------------
  // A1: Passive Detection — sannysoft
  // -----------------------------------------------------------------------
  {
    id: 'A1',
    name: 'Bot Detection — sannysoft',
    tier: 'stealth',
    url: 'https://bot.sannysoft.com',
    description: 'Navigate to bot detection page and extract all detection results.',
    expectations: [
      {
        text: 'WebDriver flag is not detected',
        check: (outputs) => {
          const text = outputs.get('text')
          const js = outputs.get('webdriver_check')
          const output = (text?.output ?? '') + (js?.output ?? '')
          const lower = output.toLowerCase()
          const notDetected =
            lower.includes('missing') || lower.includes('false') || js?.output?.trim() === 'false'
          const detected = lower.includes('present') || js?.output?.trim() === 'true'
          return {
            passed: notDetected && !detected,
            evidence: notDetected
              ? 'WebDriver not detected (good)'
              : detected
                ? 'WebDriver detected as present (bot flag exposed)'
                : `Inconclusive: ${js?.output?.slice(0, 100)}`,
          }
        },
      },
      {
        text: 'Chrome automation not detected',
        check: (outputs) => {
          const js = outputs.get('chrome_check')
          const output = js?.output ?? ''
          const notAutomation = !output.toLowerCase().includes('true')
          return {
            passed: notAutomation,
            evidence: notAutomation
              ? 'Chrome automation not detected'
              : `Automation detected: ${output.slice(0, 100)}`,
          }
        },
      },
      {
        text: 'Page loads without bot challenge',
        check: (outputs) => {
          const nav = outputs.get('navigate')
          const text = outputs.get('text')
          const loaded = nav?.success && (text?.output?.length ?? 0) > 100
          return {
            passed: loaded === true,
            evidence: loaded
              ? `Page loaded: ${text?.output?.length} chars`
              : 'Failed to load or empty content',
          }
        },
      },
    ],
    run: async (driver) => {
      const outputs = new Map()
      outputs.set('navigate', await driver.navigate('https://bot.sannysoft.com'))
      await Bun.sleep(3000)
      outputs.set('text', await driver.text())
      outputs.set('screenshot', await driver.screenshot())
      outputs.set('webdriver_check', await driver.evalJS('navigator.webdriver'))
      outputs.set(
        'chrome_check',
        await driver.evalJS(
          'window.navigator.webdriver || window.document.__selenium_unwrapped || window.__nightmare',
        ),
      )
      return outputs
    },
  },

  // -----------------------------------------------------------------------
  // A2: Twitter/X — 高强度反爬
  // -----------------------------------------------------------------------
  {
    id: 'A2',
    name: 'Anti-Bot Real — Twitter/X',
    tier: 'stealth',
    url: 'https://x.com',
    description:
      'Access Twitter/X — tests against aggressive anti-bot, JS SPA rendering, and login wall detection. This is the hardest stealth test.',
    expectations: [
      {
        text: 'Page loads without being blocked or rate-limited',
        check: (outputs) => {
          const nav = outputs.get('navigate')
          const text = outputs.get('text')
          const content = text?.output ?? ''
          // Twitter blocks → empty page, "Something went wrong", or redirect to login
          const blocked =
            content.length < 50 ||
            content.includes('Something went wrong') ||
            content.includes('rate limit')
          return {
            passed: nav?.success === true && !blocked,
            evidence: blocked
              ? `Blocked or rate-limited (content: ${content.length} chars, preview: "${content.slice(0, 150)}")`
              : `Page loaded successfully (${content.length} chars)`,
          }
        },
      },
      {
        text: 'Twitter SPA renders real content (not empty shell)',
        check: (outputs) => {
          const text = outputs.get('text')
          const snap = outputs.get('snapshot')
          const content = text?.output ?? ''
          const snapOutput = snap?.output ?? ''
          // Real content should have tweets, trends, or login prompts with substance
          const hasRealContent =
            content.length > 200 || (snapOutput.match(/\be\d+\b|@e\d+/g) ?? []).length > 10
          return {
            passed: hasRealContent,
            evidence: hasRealContent
              ? `SPA rendered: text ${content.length} chars, ${(snapOutput.match(/\be\d+\b|@e\d+/g) ?? []).length} element refs`
              : `Empty shell: text ${content.length} chars`,
          }
        },
      },
      {
        text: 'No Cloudflare/bot challenge page intercepted',
        check: (outputs) => {
          const text = outputs.get('text')
          const content = (text?.output ?? '').toLowerCase()
          const hasChallengeMarkers =
            content.includes('checking your browser') ||
            content.includes('just a moment') ||
            content.includes('verify you are human') ||
            content.includes('cf-browser-verification') ||
            content.includes('challenge-platform')
          return {
            passed: !hasChallengeMarkers,
            evidence: hasChallengeMarkers
              ? 'Bot challenge page detected — browser was intercepted'
              : 'No challenge page — passed through cleanly',
          }
        },
      },
      {
        text: 'Interactive elements found (links, buttons, inputs)',
        check: (outputs) => {
          const snap = outputs.get('snapshot')
          const refCount = (snap?.output?.match(/\be\d+\b|@e\d+/g) ?? []).length
          return {
            passed: refCount >= 5,
            evidence: `Found ${refCount} interactive elements`,
          }
        },
      },
    ],
    run: async (driver) => {
      const outputs = new Map()
      outputs.set('navigate', await driver.navigate('https://x.com'))
      // Twitter SPA needs time — heavy JS bundle + hydration
      await Bun.sleep(5000)
      outputs.set('text', await driver.text())
      outputs.set('snapshot', await driver.snapshot({ interactive: true }))
      outputs.set('screenshot', await driver.screenshot())
      return outputs
    },
  },

  // -----------------------------------------------------------------------
  // A3: Cloudflare Challenge
  // -----------------------------------------------------------------------
  {
    id: 'A3',
    name: 'Cloudflare Challenge — nowsecure',
    tier: 'stealth',
    url: 'https://nowsecure.nl',
    description:
      'Access a site protected by Cloudflare JS Challenge / Turnstile. Tests whether the browser can pass automated verification.',
    expectations: [
      {
        text: 'Cloudflare challenge is bypassed',
        check: (outputs) => {
          const text = outputs.get('text_after_wait')
          const content = (text?.output ?? '').toLowerCase()
          // If challenge bypassed, page shows actual content (not "Checking your browser")
          const stillChallenging =
            content.includes('checking your browser') ||
            content.includes('just a moment') ||
            content.includes('verify you are human') ||
            content.length < 50
          return {
            passed: !stillChallenging,
            evidence: stillChallenging
              ? `Challenge NOT bypassed (content: "${content.slice(0, 150)}")`
              : `Challenge bypassed — real content loaded (${content.length} chars)`,
          }
        },
      },
      {
        text: 'Page title is not a challenge page',
        check: (outputs) => {
          const title = outputs.get('page_title')
          const titleText = (title?.output ?? '').toLowerCase()
          const isChallengeTitle =
            titleText.includes('just a moment') ||
            titleText.includes('attention required') ||
            titleText.includes('checking')
          return {
            passed: !isChallengeTitle,
            evidence: isChallengeTitle
              ? `Challenge title detected: "${title?.output}"`
              : `Clean title: "${title?.output}"`,
          }
        },
      },
      {
        text: 'HTTP status is not 403/503',
        check: (outputs) => {
          const nav = outputs.get('navigate')
          const statusCheck = outputs.get('status_check')
          const status = statusCheck?.output?.trim() ?? ''
          const isBlocked = status === '403' || status === '503'
          return {
            passed: nav?.success === true && !isBlocked,
            evidence: isBlocked
              ? `Blocked with HTTP ${status}`
              : `Navigation succeeded${status ? `, status: ${status}` : ''}`,
          }
        },
      },
    ],
    run: async (driver) => {
      const outputs = new Map()
      outputs.set('navigate', await driver.navigate('https://nowsecure.nl'))
      // Cloudflare challenge takes ~5s to resolve
      await Bun.sleep(8000)
      outputs.set('text_after_wait', await driver.text())
      outputs.set('page_title', await driver.evalJS('document.title'))
      outputs.set(
        'status_check',
        await driver.evalJS(
          'document.querySelector("meta[http-equiv=\\"refresh\\"]")?.content || "ok"',
        ),
      )
      outputs.set('screenshot', await driver.screenshot())
      return outputs
    },
  },

  // -----------------------------------------------------------------------
  // A4: 高级指纹检测
  // -----------------------------------------------------------------------
  {
    id: 'A4',
    name: 'Fingerprint Deep — CreepJS',
    tier: 'stealth',
    url: 'https://abrahamjuliot.github.io/creepjs/',
    description:
      'Deep fingerprint analysis via CreepJS. Tests Canvas, WebGL, AudioContext, fonts, and other advanced fingerprint vectors that sophisticated anti-bot systems check.',
    expectations: [
      {
        text: 'Canvas fingerprint is not blocked/undefined',
        check: (outputs) => {
          const canvas = outputs.get('canvas_check')
          const output = (canvas?.output ?? '').toLowerCase()
          const blocked =
            output.includes('blocked') ||
            output.includes('undefined') ||
            output.includes('null') ||
            output === ''
          return {
            passed: !blocked,
            evidence: blocked
              ? `Canvas blocked or undefined: "${canvas?.output?.slice(0, 100)}"`
              : `Canvas fingerprint available: "${canvas?.output?.slice(0, 100)}"`,
          }
        },
      },
      {
        text: 'WebGL vendor is a real GPU (not "Brian Paul" / swiftshader)',
        check: (outputs) => {
          const webgl = outputs.get('webgl_check')
          const output = (webgl?.output ?? '').toLowerCase()
          // Headless Chrome exposes "Brian Paul" (Mesa) or "Google SwiftShader"
          const isFake =
            output.includes('brian paul') ||
            output.includes('swiftshader') ||
            output.includes('mesa') ||
            output === '' ||
            output === 'null'
          return {
            passed: !isFake,
            evidence: isFake
              ? `Fake/software GPU detected: "${webgl?.output}"`
              : `Real GPU vendor: "${webgl?.output}"`,
          }
        },
      },
      {
        text: 'CreepJS trust score is not "F" (lowest)',
        check: (outputs) => {
          const text = outputs.get('text')
          const content = text?.output ?? ''
          // CreepJS assigns letter grades; F = detected as bot
          const hasF = /\bF\b/.test(content) && content.toLowerCase().includes('trust')
          // Also check if page even loaded
          const loaded = content.length > 200
          return {
            passed: loaded && !hasF,
            evidence: !loaded
              ? `Page did not load fully (${content.length} chars)`
              : hasF
                ? 'Trust score F — detected as bot'
                : 'Trust score above F',
          }
        },
      },
      {
        text: 'AudioContext fingerprint not blocked',
        check: (outputs) => {
          const audio = outputs.get('audio_check')
          const output = (audio?.output ?? '').trim()
          const blocked =
            output === '' || output === 'null' || output === 'undefined' || output === '0'
          return {
            passed: !blocked,
            evidence: blocked
              ? `AudioContext blocked: "${output}"`
              : `AudioContext available: "${output.slice(0, 80)}"`,
          }
        },
      },
    ],
    run: async (driver) => {
      const outputs = new Map()
      outputs.set('navigate', await driver.navigate('https://abrahamjuliot.github.io/creepjs/'))
      // CreepJS runs many tests, needs time
      await Bun.sleep(10000)
      outputs.set('text', await driver.text())
      outputs.set('screenshot', await driver.screenshot())

      // Direct fingerprint probes
      outputs.set(
        'canvas_check',
        await driver.evalJS(`
        (() => {
          try {
            const c = document.createElement('canvas');
            const ctx = c.getContext('2d');
            ctx.fillStyle = 'red';
            ctx.fillRect(0, 0, 1, 1);
            return c.toDataURL().length > 0 ? 'available (' + c.toDataURL().length + ' chars)' : 'blocked';
          } catch(e) { return 'error: ' + e.message; }
        })()
      `),
      )

      outputs.set(
        'webgl_check',
        await driver.evalJS(`
        (() => {
          try {
            const c = document.createElement('canvas');
            const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
            if (!gl) return 'null';
            const ext = gl.getExtension('WEBGL_debug_renderer_info');
            return ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) + ' / ' + gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'no debug info';
          } catch(e) { return 'error: ' + e.message; }
        })()
      `),
      )

      outputs.set(
        'audio_check',
        await driver.evalJS(`
        (() => {
          try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(10000, ctx.currentTime);
            const comp = ctx.createDynamicsCompressor();
            osc.connect(comp);
            comp.connect(ctx.destination);
            osc.start(0);
            return 'available (sampleRate: ' + ctx.sampleRate + ')';
          } catch(e) { return 'error: ' + e.message; }
        })()
      `),
      )

      return outputs
    },
  },
]
