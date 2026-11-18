// UI fixture test against an already-open Chrome-for-Testing extension panel.
// No real business operation: detach polling, replace all helper commands, then reload.
// Usage: node tests/browser/collection-ui.mjs [CDP port] [width] [height]
import { writeFile } from 'node:fs/promises'

const port = Number(process.argv[2] ?? 9334)
const width = Number(process.argv[3] ?? 360)
const height = Number(process.argv[4] ?? 650)
const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(
  (item) => item.url?.startsWith('chrome-extension://') && item.url.endsWith('/sidepanel.html'),
)
if (!target) throw new Error('Open the Boss Helper side panel in the test browser first')
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})
let id = 0
const pending = new Map()
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (!message.id) return
  const waiter = pending.get(message.id)
  pending.delete(message.id)
  if (message.error) waiter.reject(new Error(message.error.message))
  else waiter.resolve(message.result)
})
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const requestId = ++id
    pending.set(requestId, { resolve, reject })
    socket.send(JSON.stringify({ id: requestId, method, params }))
  })
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails)
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}
try {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await send('Page.reload', { ignoreCache: true })
  await new Promise((resolve) => setTimeout(resolve, 1200))
  const checks = await evaluate(`(async () => {
    const tick = () => new Promise(resolve => setTimeout(resolve, 400));
    const check = (condition, message) => { if (!condition) throw new Error(message); return message };
    const checks = [];
    const byText = (text, root = document) => [...root.querySelectorAll('button')].find(button => button.textContent.trim() === text);
    const provides = document.querySelector('#app').__vue_app__._context.provides;
    const ctx = Reflect.ownKeys(provides).map(key => provides[key]).find(value => value?.jobMaps && value.jobList);
    if (!ctx) throw new Error('Helper provider not found');
    window.dispatchEvent(new Event('pagehide'));
    const calls = { start: 0, retry: [], deliver: [], stop: 0, reset: 0 };
    ctx.start = async () => { calls.start++; };
    ctx.stop = () => { calls.stop++; ctx.workflow.status.value = 'stop'; };
    ctx.reset = () => { calls.reset++; };
    ctx.retryJob = async () => { throw new Error('Unexpected retry before fixture binding'); };
    ctx.deliverJob = async key => { calls.deliver.push(key); };
    ctx.workflow.status.value = 'pending'; ctx.workflow.errorMessage.value = null; ctx.actionRunning.value = false;
    ctx.conf.formData.aiFiltering.enable = false; ctx.conf.formData.resumeMarkdown.content = '';
    ctx.conf.formData.feishu.enable = false; ctx.conf.formData.autoDelivery.value = true;
    ctx.pageConnection.value = 'connecting'; await tick();
    checks.push(check(document.body.innerText.includes('正在连接 BOSS 页面，请稍等') && !document.body.innerText.includes('尚未连接到可用'), 'initial connection is a neutral loading hint'));
    ctx.pageConnection.value = 'reading'; await tick();
    checks.push(check(document.body.innerText.includes('已连接，正在读取岗位列表'), 'connected empty snapshot shows reading'));
    ctx.pageConnection.value = 'error'; await tick();
    checks.push(check(document.body.innerText.includes('正在自动重试') && byText('开始采集').disabled, 'persistent disconnect disables start'));
    ctx.pageConnection.value = 'ready';
    const job = (key, name) => ({ key, jobName: name + '（UI验证）', positionName: name, brand: { name: '示例团队' }, link: 'https://www.zhipin.com/', salary: '面议', address: '深圳' });
    const state = (decision = 'APPLY') => ({ stages: {
      detail: { status: 'succeeded', attempts: 1 }, analysis: { status: 'succeeded', attempts: 1 }, storage: { status: 'succeeded', attempts: 1 },
    }, aiMatchResult: { decision, reason: '岗位内容与项目实践相关；完整匹配点、缺口和待核实项放在分析详情中。', matchPoints: ['项目实践相关'], gaps: ['需要进一步确认具体职责'], uncertainties: [] }, delivered: false });
    const records = [
      { jobData: job('old', '上一页岗位'), state: state('REJECT') },
      { jobData: job('failed', 'AI 产品实习生｜智能体与工作流产品规划及落地实践方向'), state: state() },
      { jobData: job('unknown', '发送待核实岗位'), state: state() },
      { jobData: job('disabled', '未启用AI岗位'), state: state() },
      ...Array.from({ length: 44 }, (_, i) => ({ jobData: job('extra-' + i, '历史岗位 ' + i), state: state() })),
    ];
    records[1].state.stages.storage = { status: 'failed', attempts: 2, message: '缺少表格字段，请检查字段配置' };
    records[2].state.stages.delivery = { status: 'unknown', attempts: 1 };
    records[3].state.stages.analysis = { status: 'skipped', attempts: 0 };
    records[3].state.stages.storage = { status: 'skipped', attempts: 0 };
    delete records[3].state.aiMatchResult;
    ctx.jobMaps.clear(); ctx.jobResultMaps.clear();
    for (const record of records) { ctx.jobMaps.set(record.jobData.key, { ...record, rawData: {} }); ctx.jobResultMaps.set(record.jobData.key, { status: record.jobData.key === 'failed' ? 'error' : 'success' }); }
    ctx.jobList.value = [records[1].jobData, records[3].jobData]; ctx.currentJob.value = 'failed';
    ctx._logs.value = [{ title: '模拟日志', message: '仅在点击后展示的运行记录', state_name: '消息' }];
    await tick();
    const main = document.querySelector('.cw-content');
    checks.push(check(!document.querySelector('.p-datatable') && !main.innerText.includes('上一页岗位') && byText('记录 48'), '48 session jobs stay behind a records button'));
    checks.push(check(!main.innerText.includes('AI 未启用') && !main.innerText.includes('飞书未启用') && !main.innerText.includes('仅采集与分析') && !main.innerText.includes('模拟日志'), 'configuration, policy and logs are hidden by default'));
    checks.push(check(!byText('投递该岗位…') && !document.body.innerText.includes('独立投递'), 'manual delivery controls are removed'));
    checks.push(check(!byText('开始采集').disabled, 'AI disabled does not require resume or enable legacy auto delivery'));
    byText('开始采集').click(); await tick();
    checks.push(check(calls.start === 1 && calls.deliver.length === 0, 'collection remains zero-send'));
    const primary = () => document.querySelector('.cw-footer button');
    checks.push(check(primary().textContent.trim() === '取消采集' && !primary().disabled && document.querySelectorAll('.cw-footer button').length === 1 && !byText('暂停'), 'same enabled button cancels even while launch acknowledgment is pending'));
    primary().click(); await tick();
    checks.push(check(calls.stop === 1 && primary().textContent.trim() === '继续采集', 'second click stops through helper and restores the single start action'));
    ctx.workflow.status.value = 'pending'; await tick();
    checks.push(check(document.querySelector('.cw-footer [role=progressbar]').getAttribute('aria-valuenow') === '97', 'PrimeVue progress counts completed and skipped stages but excludes failed jobs'));
    const markers = [...document.querySelectorAll('.cw-stages .p-timeline-event-marker')].map(el => el.getBoundingClientRect());
    checks.push(check(markers.length === 3 && markers.every(rect => Math.abs(rect.top - markers[0].top) < 2) && markers[0].left < markers[1].left && markers[1].left < markers[2].left, 'three stages render on a horizontal line'));
    checks.push(check(document.querySelectorAll('.cw-stages .p-tag-danger').length === 1 && !main.innerText.includes('缺少表格字段'), 'failed stage remains visible while diagnostic text is deferred'));
    byText('查看失败原因').click(); await tick();
    let dialog = document.querySelector('[role=dialog]');
    checks.push(check(dialog.innerText.includes('缺少表格字段') && dialog.innerText.includes('尝试 2 次'), 'stage diagnostics and attempts are available on demand'));
    byText('关闭', dialog).click(); await tick();
    byText('检查配置').click(); await tick();
    dialog = document.querySelector('[role=dialog]');
    checks.push(check(dialog.innerText.includes('已读取 2 个岗位') && dialog.innerText.includes('AI 未启用') && dialog.innerText.includes('不代表远端服务已连通'), 'configuration check reports saved configuration without claiming network verification'));
    byText('知道了', dialog).click(); await tick();
    document.querySelector('button[aria-label="查看运行说明"]').click(); await tick();
    dialog = document.querySelector('[role=dialog]');
    checks.push(check(dialog.innerText.includes('不自动投递') && dialog.innerText.includes('刷新该页面后不会恢复'), 'info icon has a click-accessible explanation'));
    byText('知道了', dialog).click(); await tick();
    byText('运行日志').click(); await tick();
    dialog = document.querySelector('[role=dialog]');
    checks.push(check(dialog.innerText.includes('模拟日志'), 'logs remain accessible on demand'));
    byText('关闭', dialog).click(); await tick();
    byText('记录 48').click(); await tick();
    dialog = document.querySelector('[role=dialog]');
    checks.push(check(dialog.querySelectorAll('tbody tr').length === 6 && dialog.querySelector('.p-paginator'), 'record dialog uses six-row pagination'));
    byText(records[0].jobData.jobName, dialog).click(); await tick();
    dialog = document.querySelector('[role=dialog]');
    checks.push(check(dialog.innerText.includes('上一页岗位') && ctx.currentJob.value === 'failed', 'historical inspection does not hijack the active job'));
    byText('关闭', dialog).click(); await tick();
    ctx.currentJob.value = 'old'; await tick();
    checks.push(check(document.querySelectorAll('.cw-stages .p-tag-success').length === 3 && main.innerText.includes('不建议投递'), 'REJECT is an analysis decision, not a pipeline failure'));
    ctx.currentJob.value = 'disabled'; await tick();
    checks.push(check([...document.querySelectorAll('.cw-stages .p-tag')].filter(tag => tag.textContent === '未启用').length === 2, 'disabled stages show neutral skipped states'));
    ctx.currentJob.value = 'failed'; await tick();
    let finishRetry;
    ctx.retryJob = async key => {
      calls.retry.push(key); ctx.actionRunning.value = true;
      ctx.jobMaps.get(key).state.stages.storage = { status: 'running', attempts: 3 };
      await new Promise(resolve => { finishRetry = resolve; });
    };
    byText('重试该岗位', main).click(); await tick();
    checks.push(check(calls.retry.length === 1 && calls.retry[0] === 'failed' && primary().textContent.trim() === '取消采集', 'retry uses keyed helper and primary action becomes cancel instead of starting another task'));
    ctx.jobMaps.get('failed').state.stages.storage = { status: 'succeeded', attempts: 3 };
    ctx.actionRunning.value = false; finishRetry(); await tick();
    checks.push(check(ctx.jobMaps.get('failed').state.stages.detail.attempts === 1 && ctx.jobMaps.get('failed').state.stages.analysis.attempts === 1, 'retry retains completed stages'));
    ctx.workflow.status.value = 'running'; await tick();
    ctx.jobMaps.get('failed').state.stages.storage = { status: 'running', attempts: 3 };
    await tick();
    checks.push(check(primary().textContent.trim() === '取消采集' && !primary().disabled, 'running view keeps the same button cancellable'));
    primary().click(); await tick();
    checks.push(check(calls.stop === 2 && calls.deliver.length === 0 && primary().textContent.trim() === '正在取消…' && primary().disabled, 'cancel waits for the in-flight stage and prevents immediate restart'));
    ctx.jobMaps.get('failed').state.stages.storage = { status: 'failed', attempts: 3 };
    await tick();
    checks.push(check(primary().textContent.trim() === '继续采集' && !primary().disabled, 'settled cancellation restores resumable action without deleting successful stages'));
    ctx.workflow.status.value = 'pending';
    ctx.jobMaps.get('failed').state.stages.storage = { status: 'failed', attempts: 3, message: '缺少表格字段，请检查字段配置' };
    await tick();
    checks.push(check(main.scrollHeight <= main.clientHeight + 1 && document.documentElement.scrollWidth === innerWidth, 'default workbench fits without vertical or horizontal scrolling: ' + main.scrollHeight + '/' + main.clientHeight + ', ' + document.documentElement.scrollWidth + '/' + innerWidth));
    checks.push(check(document.querySelector('.cw-stages').getBoundingClientRect().bottom < document.querySelector('.cw-footer').getBoundingClientRect().top, 'all stages and primary actions are visible together'));
    return checks;
  })()`)
  await new Promise((resolve) => setTimeout(resolve, 500))
  const screenshot = `/tmp/boss-compact-${width}x${height}.png`
  await writeFile(
    screenshot,
    Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'),
  )
  await evaluate(`document.querySelector('.cw-current button').click()`)
  await new Promise((resolve) => setTimeout(resolve, 500))
  await writeFile(
    `/tmp/boss-compact-details-${width}x${height}.png`,
    Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'),
  )
  console.log(JSON.stringify({ checks, mockedCommands: true, persisted: false, screenshot }))
} catch (error) {
  await writeFile(
    '/tmp/boss-compact-test-failure.png',
    Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'),
  )
  throw error
} finally {
  await send('Page.reload', { ignoreCache: true })
  await send('Emulation.clearDeviceMetricsOverride')
  socket.close()
}
