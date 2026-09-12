// UI fixture test against an already-open Chrome-for-Testing extension panel.
// No real business operation: detach polling, replace all helper commands, then reload.
// Usage: node tests/browser/collection-ui.mjs [CDP port] [width]
import { writeFile } from 'node:fs/promises'

const port = Number(process.argv[2] ?? 9334)
const width = Number(process.argv[3] ?? 360)
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
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await send('Page.reload', { ignoreCache: true })
  await new Promise((resolve) => setTimeout(resolve, 1200))
  const checks = await evaluate(`(async () => {
    const tick = () => new Promise(resolve => setTimeout(resolve, 60));
    const check = (condition, message) => { if (!condition) throw new Error(message); return message };
    const checks = [];
    const byText = (text, root = document) => [...root.querySelectorAll('button')].find(button => button.textContent.trim() === text);
    const provides = document.querySelector('#app').__vue_app__._context.provides;
    const ctx = Reflect.ownKeys(provides).map(key => provides[key]).find(value => value?.jobMaps && value.jobList);
    if (!ctx) throw new Error('Helper provider not found');
    window.dispatchEvent(new Event('pagehide')); // Dispose bridge polling before fixture setup.
    const calls = { start: 0, retry: [], deliver: [], stop: 0, reset: 0 };
    ctx.start = async () => { calls.start++; };
    ctx.stop = () => { calls.stop++; };
    ctx.reset = () => { calls.reset++; };
    ctx.retryJob = async () => { throw new Error('Unexpected retry before fixture binding'); };
    ctx.deliverJob = async key => {
      calls.deliver.push(key);
      ctx.jobMaps.get(key).state.stages.delivery = { status: 'unknown', attempts: 1, message: '模拟响应丢失，请核实' };
    };
    ctx.workflow.status.value = 'pending'; ctx.workflow.errorMessage.value = null; ctx.actionRunning.value = false;
    ctx.conf.formData.aiFiltering.enable = false; ctx.conf.formData.resumeMarkdown.content = '';
    ctx.conf.formData.feishu.enable = false; ctx.conf.formData.autoDelivery.value = true;
    ctx.conf.formData.deliveryLimit.value = ctx.statistics.todayData.value.success + 5;
    const job = (key, name) => ({ key, jobName: name + '（UI验证）', positionName: name, brand: { name: '示例团队' }, link: 'https://www.zhipin.com/', salary: '面议', address: '深圳' });
    const state = (decision = 'APPLY') => ({ stages: {
      detail: { status: 'succeeded', attempts: 1 }, analysis: { status: 'succeeded', attempts: 1 }, storage: { status: 'succeeded', attempts: 1 },
    }, aiMatchResult: { decision, reason: '仅用于界面验证的匹配结论', matchPoints: ['项目实践相关'], gaps: [], uncertainties: [] }, delivered: false });
    const records = [
      { jobData: job('old', '上一页岗位'), state: state('REJECT') },
      { jobData: job('failed', '飞书失败岗位'), state: state() },
      { jobData: job('unknown', '发送待核实岗位'), state: state() },
      { jobData: job('disabled', '未启用AI岗位'), state: state() },
      { jobData: job('send', '待确认投递岗位'), state: state() },
    ];
    records[1].state.stages.storage = { status: 'failed', attempts: 2, message: '缺少表格字段，请检查字段配置' };
    records[2].state.stages.delivery = { status: 'unknown', attempts: 1 };
    records[3].state.stages.analysis = { status: 'skipped', attempts: 0 };
    records[3].state.stages.storage = { status: 'skipped', attempts: 0 };
    delete records[3].state.aiMatchResult;
    ctx.jobMaps.clear(); ctx.jobResultMaps.clear();
    for (const record of records) { ctx.jobMaps.set(record.jobData.key, { ...record, rawData: {} }); ctx.jobResultMaps.set(record.jobData.key, { status: record.jobData.key === 'failed' ? 'error' : 'success' }); }
    ctx.jobList.value = [records[1].jobData, records[4].jobData]; ctx.currentJob.value = 'failed';
    await tick();
    checks.push(check(document.querySelectorAll('.ph-record').length === 5 && ctx.jobList.value.length === 2, 'session list preserves previous-page records'));
    checks.push(check(!byText('开始采集').disabled, 'AI disabled does not require resume and legacy autoDelivery does not block collection'));
    byText('开始采集').click(); await tick();
    checks.push(check(calls.start === 1 && calls.deliver.length === 0, 'start collection never invokes delivery from the UI'));
    const select = async key => { byText(records.find(record => record.jobData.key === key).jobData.jobName, document.querySelector('.ph-result-list')).click(); await tick(); };
    await select('old');
    checks.push(check(document.querySelector('.ph-job-detail').innerText.includes('采集完成') && document.querySelectorAll('.ph-stages .p-tag-success').length === 3, 'REJECT remains analyzed and stored, not a collection error'));
    checks.push(check(!byText('投递该岗位…') || byText('投递该岗位…').disabled, 'REJECT cannot be sent'));
    await select('disabled');
    checks.push(check([...document.querySelectorAll('.ph-stages .p-tag')].filter(tag => tag.textContent === '未启用').length === 2, 'disabled AI and storage display neutral skipped states'));
    await select('failed');
    checks.push(check(document.querySelectorAll('.ph-stages .p-tag-danger').length === 1 && document.querySelector('.ph-stages').innerText.includes('尝试 2 次'), 'only failed storage is marked failed with attempt count'));
    let finishRetry;
    ctx.retryJob = async key => {
      calls.retry.push(key); ctx.actionRunning.value = true;
      ctx.jobMaps.get(key).state.stages.storage = { status: 'running', attempts: 3 };
      await new Promise(resolve => { finishRetry = resolve; });
    };
    byText('重试该岗位', document.querySelector('.ph-job-detail')).click(); await tick();
    checks.push(check(calls.retry.length === 1 && calls.retry[0] === 'failed' && byText('开始采集').disabled, 'single-job retry uses keyed helper and locks other actions'));
    ctx.jobMaps.get('failed').state.stages.storage = { status: 'succeeded', attempts: 3 };
    ctx.actionRunning.value = false; finishRetry(); await tick();
    checks.push(check(ctx.jobMaps.get('failed').state.stages.detail.attempts === 1 && ctx.jobMaps.get('failed').state.stages.analysis.attempts === 1 && document.querySelectorAll('.ph-stages .p-tag-success').length === 3, 'retry success preserves completed detail and analysis evidence'));
    await select('send'); byText('投递该岗位…').click(); await tick();
    checks.push(check(document.querySelector('[role=dialog]').innerText.includes(records[4].jobData.jobName), 'delivery dialog identifies the exact job'));
    byText('取消', document.querySelector('[role=dialog]')).click(); await tick();
    checks.push(check(calls.deliver.length === 0, 'cancel delivery dialog causes zero sends'));
    byText('投递该岗位…').click(); await tick();
    // A fresh snapshot may change the current job while confirmation is open.
    ctx.currentJob.value = 'old'; await tick();
    byText('确认投递', document.querySelector('[role=dialog]')).click(); await tick();
    checks.push(check(calls.deliver.length === 1 && calls.deliver[0] === 'send', 'confirm sends exactly one captured job through helper'));
    checks.push(check(!byText('投递该岗位…', document.querySelector('.ph-job-detail')) && document.querySelector('.ph-job-detail').innerText.includes('发送结果待核实'), 'unknown result removes resend control'));
    await select('unknown');
    checks.push(check(!byText('投递该岗位…', document.querySelector('.ph-job-detail')), 'previous unknown delivery cannot be resent'));
    checks.push(check(document.documentElement.scrollWidth === innerWidth && document.documentElement.scrollHeight === 900, 'viewport has no outer document overflow'));
    await select('failed');
    ctx.jobMaps.get('failed').state.stages.storage = { status: 'failed', attempts: 3, message: '缺少表格字段，请检查字段配置' };
    await tick();
    document.querySelector('.ph-content').scrollTop = 0;
    return checks;
  })()`)
  await new Promise((resolve) => setTimeout(resolve, 500))
  const screenshot = `/tmp/boss-collection-ui-${width}.png`
  await writeFile(
    screenshot,
    Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'),
  )
  await evaluate(`document.querySelector('.ph-job-detail').scrollIntoView({ block: 'start' })`)
  await new Promise((resolve) => setTimeout(resolve, 500))
  await writeFile(
    `/tmp/boss-collection-detail-${width}.png`,
    Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'),
  )
  console.log(JSON.stringify({ checks, mockedCommands: true, persisted: false, screenshot }))
} finally {
  await send('Page.reload', { ignoreCache: true })
  await send('Emulation.clearDeviceMetricsOverride')
  socket.close()
}
