import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

import ts from 'typescript'

import { candidateContext } from '../src/services/candidateProfile.ts'
import { matchingPrompt, parseJobMatchResult } from '../src/services/jobMatching.ts'

void test('production AI handler supplies immutable resume and profile even with a custom prompt', async () => {
  const source = ts.createSourceFile(
    'handles.ts',
    readFileSync(new URL('../src/composables/useApplying/handles.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  )
  const registry = source.statements.find(
    (node): node is ts.ClassDeclaration =>
      ts.isClassDeclaration(node) && node.name?.text === 'TaskRegistry',
  )!
  const field = registry.members.find(
    (node): node is ts.PropertyDeclaration =>
      ts.isPropertyDeclaration(node) && node.name.getText(source) === 'aiFiltering',
  )!
  const script = ts.transpileModule(`exports.handler = class { ${field.getText(source)} };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports: any = {}
  runInNewContext(script, {
    exports,
    candidateContext,
    parseJobMatchResult,
    HelperConfigError: Error,
    defineTaskHandler: (_name: string, task: unknown) => ({ task }),
  })
  let selected: any
  let input: any
  const form = {
    aiFiltering: { enable: true, model: 'model', prompt: [{ role: 'user', content: '我的规则' }] },
    resumeMarkdown: { content: '原始简历' },
    candidateProfile: { content: '2027 届；深圳优先' },
  }
  const helper: any = {
    conf: { formData: form },
    chatModel: {
      createAgent(config: unknown) {
        selected = config
        return true
      },
      async chat(_role: string, data: unknown) {
        input = data
        return {
          text: JSON.stringify({
            decision: 'APPLY',
            reason: '有匹配的工程经历',
            matchPoints: ['仿真'],
            gaps: [],
            uncertainties: [],
          }),
        }
      },
    },
  }
  const task = await new exports.handler().aiFiltering.task({ helper })
  form.resumeMarkdown.content = '运行期间的新简历'
  form.candidateProfile.content = '运行期间的新偏好'
  const data = { jobData: { jobDescription: '完整 JD' }, state: {} as any }
  await task({ helper }, data)
  assert.equal(input.resumeMarkdown, '原始简历')
  assert.match(input.candidateContext, /2027 届；深圳优先/)
  assert.equal(selected.prompt[0].content, '我的规则')
  assert.equal(selected.prompt[1].content, '{{ candidateContext }}')
  assert.equal(data.state.aiMatchResult.decision, 'APPLY')
})

void test('matching prompt fixtures cover hard eligibility, transferable work, preference and untrusted JD', () => {
  const cases = JSON.parse(
    readFileSync(new URL('./evaluation/matching-cases.json', import.meta.url), 'utf8'),
  )
  for (const item of cases) {
    assert.ok(item.id && item.jd && item.expectedDecisions.length && item.criteria.length)
    assert.match(matchingPrompt[0]!.content, /个人资料/)
  }
  const ids = new Set(cases.map((item: { id: string }) => item.id))
  for (const id of [
    'thermal-intern',
    'graduate-cohort-conflict',
    'degree-conflict',
    'hardware-solutions',
    'perovskite-core',
    'routine-test-agent',
    'test-engineering-judgment',
    'injection-unknown-hours',
    'offtrack-growth',
  ])
    assert.ok(ids.has(id), `Missing matching scenario: ${id}`)
})
