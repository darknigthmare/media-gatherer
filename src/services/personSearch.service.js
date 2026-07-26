function resultSourceId(item = {}) {
  return String(item.sourceId || item.source || '').trim().toLowerCase();
}

function sourceExecutionState(status = {}) {
  if (status.skipped) return 'skipped';
  if (status.success === false || status.error) return 'error';
  return 'interrogated';
}

function updateCoverage(coverage, task, payload = {}, error = null) {
  const items = [...(payload.images || []), ...(payload.videos || [])];
  task.sourceIds.forEach(sourceId => {
    const row = coverage.find(entry => entry.identityId === task.identityId && entry.sourceId === sourceId);
    if (!row) return;
    const status = payload.status?.[sourceId] || {};
    const results = items.filter(item => resultSourceId(item) === sourceId).length;
    row.interrogatedQueries += 1;
    row.results += results;
    if (error) {
      row.state = 'error';
      row.errors.push(error.message || String(error));
      return;
    }
    const nextState = sourceExecutionState(status);
    if (nextState === 'error') {
      row.state = 'error';
      row.errors.push(status.error || status.note || 'source_failed');
    } else if (nextState === 'skipped' && row.state !== 'error') {
      row.state = 'skipped';
      row.reason = status.zeroReason || status.note || 'source_skipped';
    } else if (row.state !== 'error') {
      row.state = 'interrogated';
      row.reason = row.results ? 'results_found' : (status.zeroReason || 'no_matching_result');
    }
  });
}

function aggregateSourceCoverage(coverage = []) {
  const grouped = new Map();
  coverage.forEach(row => {
    if (!grouped.has(row.sourceId)) {
      grouped.set(row.sourceId, {
        sourceId: row.sourceId,
        sourceLabel: row.sourceLabel,
        planned: 0,
        interrogated: 0,
        skipped: 0,
        errors: 0,
        results: 0
      });
    }
    const summary = grouped.get(row.sourceId);
    if (row.plannedQueries?.length) summary.planned += 1;
    if (row.interrogatedQueries > 0) summary.interrogated += 1;
    if (row.state === 'skipped') summary.skipped += 1;
    if (row.state === 'error') summary.errors += 1;
    summary.results += Number(row.results || 0);
  });
  return [...grouped.values()];
}

async function executePersonSearchPlan(options = {}) {
  const plan = options.plan || { tasks: [], coverage: [] };
  if (typeof options.runTask !== 'function') throw new TypeError('runTask requis');
  const coverage = (plan.coverage || []).map(row => ({
    ...row,
    plannedQueries: [...(row.plannedQueries || [])],
    errors: [...(row.errors || [])]
  }));
  const links = [];
  const failures = [];
  const executions = [];

  for (const task of plan.tasks || []) {
    const startedAt = Date.now();
    try {
      const payload = await options.runTask(task);
      const taskLinks = typeof options.mapItems === 'function'
        ? await options.mapItems([...(payload.images || []), ...(payload.videos || [])], task, payload)
        : [];
      links.push(...(taskLinks || []));
      if (taskLinks?.length && typeof options.onLinks === 'function') await options.onLinks(taskLinks, task, payload);
      updateCoverage(coverage, task, payload);
      executions.push({
        taskId: task.id,
        identityId: task.identityId,
        query: task.query,
        sourceIds: task.sourceIds,
        durationMs: Date.now() - startedAt,
        images: (payload.images || []).length,
        videos: (payload.videos || []).length,
        created: taskLinks?.length || 0,
        ok: true
      });
    } catch (error) {
      updateCoverage(coverage, task, {}, error);
      failures.push({ taskId: task.id, query: task.query, sourceIds: task.sourceIds, error: error.message });
      executions.push({
        taskId: task.id,
        identityId: task.identityId,
        query: task.query,
        sourceIds: task.sourceIds,
        durationMs: Date.now() - startedAt,
        images: 0,
        videos: 0,
        created: 0,
        ok: false,
        error: error.message
      });
    }
  }
  return {
    links,
    failures,
    executions,
    coverage,
    sourceCoverage: aggregateSourceCoverage(coverage),
    completedTasks: executions.filter(entry => entry.ok).length,
    failedTasks: failures.length
  };
}

module.exports = {
  resultSourceId,
  sourceExecutionState,
  aggregateSourceCoverage,
  executePersonSearchPlan
};
