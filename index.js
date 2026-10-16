(() => {
  if (customElements.get('queue-scroll')) return;

  const DEFAULTS = {
    dataCenter: 'us1',
    refreshSeconds: 15,
    staleSeconds: 60,
    lookbackHours: 24,
    waitingWarn: 5,
    waitingAlert: 10,
    waitWarnSeconds: 120,
    waitAlertSeconds: 300,
    offsetTop: '8px',
    offsetLeft: '200px',
  };

  const CATALOG_TTL_MS = 15 * 60 * 1000;
  const OUTCOME_FIELD = 'terminationType';

  const PROPS = {
    token: 'token',
    orgId: 'org-id',
    dataCenter: 'data-center',
    agentProfileId: 'agent-profile-id',
  };

  const WAITING_QUERY = 'query waiting($from:Long! $to:Long! $timeComparator:QueryTimeType $filter:TaskFilters $aggregations:[TaskV2Aggregation]){task(from:$from to:$to timeComparator:$timeComparator filter:$filter aggregations:$aggregations){tasks{lastQueue{name} aggregation{name value}}}}';

  const STATS_QUERY_HEAD = 'query stats($from:Long! $to:Long! $timeComparator:QueryTimeType $filter:TaskFilters $aggregations:[TaskV2Aggregation]){task(from:$from to:$to timeComparator:$timeComparator filter:$filter aggregations:$aggregations){tasks{lastQueue{name}';

  const positive = (value, fallback) => {
    const n = Number(value);
    return n > 0 ? n : fallback;
  };

  const clock = (ms) => {
    const t = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(t / 3600);
    const m = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
    const s = String(t % 60).padStart(2, '0');
    return h ? `${h}:${m}:${s}` : `${m}:${s}`;
  };

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  const STYLE = `
    :host {
      --bg: #ffffff; --fg: #121212; --muted: #5d6874; --line: #d9dee3;
      position: fixed; top: var(--qs-top, 8px); left: var(--qs-left, 200px); z-index: 9999; display: block;
      font-family: 'CiscoSansTT Regular', 'Helvetica Neue', Helvetica, Arial, sans-serif; color: var(--fg);
    }
    :host([dark]) { --bg: #1f2327; --fg: #e8eaed; --muted: #a3acb5; --line: #353b41; }
    .card { display: flex; align-items: center; gap: 18px; padding: 5px 16px; background: var(--bg);
            border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12); }
    .card.stale { opacity: 0.6; }
    .cell { min-width: 56px; text-align: center; }
    .v { font-size: 15px; font-weight: 600; line-height: 22px; font-variant-numeric: tabular-nums; }
    .l { font-size: 10px; line-height: 12px; color: var(--muted); white-space: nowrap; }
    .pill { display: inline-block; min-width: 2.6em; padding: 0 8px; border-radius: 999px; text-align: center; }
    .pill.lv-warn { background: #f5c542; color: #3d2e00; }
    .pill.lv-alert { background: #d9342b; color: #ffffff; }
    .msg { font-size: 12px; color: var(--muted); padding: 4px 0; }
  `;

  class QueueScroll extends HTMLElement {
    static get observedAttributes() {
      return [...Object.values(PROPS), 'base-url', 'darkmode', 'refresh-seconds', 'stale-seconds', 'lookback-hours',
              'waiting-warn', 'waiting-alert', 'wait-warn-seconds', 'wait-alert-seconds',
              'offset-top', 'offset-left'];
    }

    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this.shadowRoot.innerHTML = `<style>${STYLE}</style><div class="card"></div>`;
      this.card = this.shadowRoot.querySelector('.card');
      this.values = {};
      this.data = null;
      this.error = '';
      this.lastGood = 0;
    }

    connectedCallback() {
      this.applyOffsets();
      this.refresh();
      this.startPolling();
      this.ticker = setInterval(() => this.tick(), 1000);
    }

    disconnectedCallback() {
      clearInterval(this.poll);
      clearInterval(this.ticker);
    }

    attributeChangedCallback(name, _old, val) {
      if (name === 'darkmode') this.toggleAttribute('dark', String(val) === 'true');
      if (!this.isConnected) return;
      if (name === 'offset-top' || name === 'offset-left') this.applyOffsets();
      else if (name === 'refresh-seconds') this.startPolling();
      else if (name !== 'darkmode') this.refresh();
    }

    applyOffsets() {
      this.style.setProperty('--qs-top', this.getAttribute('offset-top') || DEFAULTS.offsetTop);
      this.style.setProperty('--qs-left', this.getAttribute('offset-left') || DEFAULTS.offsetLeft);
    }

    startPolling() {
      clearInterval(this.poll);
      this.poll = setInterval(() => this.refresh(), positive(this.getAttribute('refresh-seconds'), DEFAULTS.refreshSeconds) * 1000);
    }

    get darkmode() { return this.hasAttribute('dark'); }
    set darkmode(value) { this.toggleAttribute('dark', String(value) === 'true'); }

    get dataCenterKey() {
      const raw = String(this.dataCenter || '').toLowerCase();
      const match = raw.match(/(?:anz|us|eu|ca|uk|jp|sg)\d+/);
      return match ? match[0] : DEFAULTS.dataCenter;
    }

    get base() {
      const explicit = (this.getAttribute('base-url') || '').trim().replace(/\/+$/, '');
      return explicit || `https://api.wxcc-${this.dataCenterKey}.cisco.com`;
    }

    get lookbackMs() { return positive(this.getAttribute('lookback-hours'), DEFAULTS.lookbackHours) * 3600000; }
    get staleMs() { return positive(this.getAttribute('stale-seconds'), DEFAULTS.staleSeconds) * 1000; }

    get waitingLevels() {
      return {
        warn: positive(this.getAttribute('waiting-warn'), DEFAULTS.waitingWarn),
        alert: positive(this.getAttribute('waiting-alert'), DEFAULTS.waitingAlert),
      };
    }

    get waitLevels() {
      return {
        warn: positive(this.getAttribute('wait-warn-seconds'), DEFAULTS.waitWarnSeconds),
        alert: positive(this.getAttribute('wait-alert-seconds'), DEFAULTS.waitAlertSeconds),
      };
    }

    levelOf(value, levels) {
      if (value >= levels.alert) return 'lv-alert';
      return value >= levels.warn ? 'lv-warn' : '';
    }

    fatal(message) {
      const err = new Error(message);
      err.fatal = true;
      return err;
    }

    async search(query, variables) {
      let res;
      try {
        res = await fetch(`${this.base}/search`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json', Accept: 'application/json',
            Authorization: `Bearer ${this.token}`,
          },
          body: JSON.stringify({ query, variables }),
        });
      } catch (err) {
        throw this.fatal(`Could not reach ${this.base}.`);
      }
      if (res.status === 401 || res.status === 403) {
        throw this.fatal('Your session does not allow this view, or it has expired.');
      }
      if (!res.ok) throw new Error(`The WxCC Search API answered ${res.status}.`);
      const body = await res.json();
      if (body.errors && body.errors.length) throw new Error(body.errors[0].message || 'Search error');
      return body.data;
    }

    async getJson(path) {
      const res = await fetch(`${this.base}${path}`, {
        headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    }

    async loadAccess() {
      const profileId = String(this.agentProfileId || '').trim();
      if (!profileId) return null;
      const now = Date.now();
      if (this.access !== undefined && this.accessFor === profileId && now - this.accessAt < CATALOG_TTL_MS) return this.access;
      let access = null;
      try {
        const body = await this.getJson(`/organization/${this.orgId}/agent-profile/${profileId}`);
        const view = body.viewableStatistics || {};
        access = {
          mode: String(view.accessQueueStats || '').toUpperCase(),
          queueIds: Array.isArray(view.contactServiceQueues) ? view.contactServiceQueues : [],
        };
      } catch (err) {
        access = null;
      }
      this.access = access;
      this.accessFor = profileId;
      this.accessAt = access ? now : now - CATALOG_TTL_MS + 60000;
      return access;
    }

    async loadCatalog() {
      const now = Date.now();
      if (this.catalog && now - this.catalogAt < CATALOG_TTL_MS) return this.catalog;
      try {
        const queues = [];
        let page = 0;
        let totalPages = 1;
        while (page < totalPages && page < 20) {
          const body = await this.getJson(`/organization/${this.orgId}/v2/contact-service-queue?page=${page}&pageSize=100`);
          const rows = Array.isArray(body.data) ? body.data : (Array.isArray(body) ? body : []);
          for (const q of rows) if (q && q.name && q.active !== false) queues.push({ id: q.id, name: q.name });
          totalPages = (body.meta && body.meta.totalPages) || 1;
          page += 1;
        }
        this.catalog = queues;
        this.catalogAt = now;
      } catch (err) {
        this.catalog = null;
        this.catalogAt = now - CATALOG_TTL_MS + 60000;
      }
      return this.catalog;
    }

    async loadWaiting() {
      const now = Date.now();
      const data = await this.search(WAITING_QUERY, {
        from: `${now - this.lookbackMs}`, to: `${now}`, timeComparator: 'createdTime',
        filter: { and: [{ isActive: { equals: true } }, { status: { equals: 'parked' } }] },
        aggregations: [
          { field: 'id', type: 'count', name: 'waiting' },
          { field: 'createdTime', type: 'min', name: 'oldest' },
        ],
      });
      const rows = new Map();
      for (const row of data.task.tasks || []) {
        const name = (row.lastQueue && row.lastQueue.name) || 'Queue';
        const agg = {};
        for (const a of row.aggregation || []) agg[a.name] = a.value;
        rows.set(name, { waiting: Number(agg.waiting) || 0, oldest: Number(agg.oldest) || 0 });
      }
      return rows;
    }

    async loadStats() {
      const now = Date.now();
      if (this.statsRetryAt && now < this.statsRetryAt) return null;
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      const variables = {
        from: `${since.getTime()}`, to: `${now}`, timeComparator: 'createdTime',
        filter: {}, aggregations: [{ field: 'id', type: 'count', name: 'total' }],
      };
      const attempts = this.statsOutcome === undefined ? [OUTCOME_FIELD, ''] : [this.statsOutcome];
      let data = null;
      let outcome = '';
      for (const field of attempts) {
        try {
          data = await this.search(`${STATS_QUERY_HEAD}${field ? ` ${field}` : ''} aggregation{name value}}}}`, variables);
          outcome = field;
          this.statsOutcome = field;
          break;
        } catch (err) {
          if (err.fatal) throw err;
        }
      }
      if (!data) {
        this.statsRetryAt = now + 5 * 60 * 1000;
        return null;
      }
      const rows = (data.task.tasks || []).map((row) => ({
        name: (row.lastQueue && row.lastQueue.name) || '',
        count: Number((row.aggregation || []).find((a) => a.name === 'total')?.value) || 0,
        kind: outcome ? String(row[outcome] || '') : '',
      }));
      return { rows, outcome: Boolean(outcome) };
    }

    async refresh() {
      if (!this.token || !this.orgId) return;
      try {
        const access = await this.loadAccess();
        if (!access) {
          this.data = { unknown: true };
        } else if (access.mode === 'NONE') {
          this.data = { none: true };
        } else {
          const [waitingRows, stats, catalog] = await Promise.all([
            this.loadWaiting(),
            this.loadStats(),
            access.mode === 'ALL' ? null : this.loadCatalog(),
          ]);
          let allowed = null;
          if (access.mode !== 'ALL') {
            allowed = catalog ? new Set(catalog.filter((q) => access.queueIds.includes(q.id)).map((q) => q.name)) : null;
          }
          if (access.mode !== 'ALL' && !allowed) {
            this.data = { unknown: true };
          } else {
            const include = (name) => !allowed || allowed.has(name);
            const totals = { waiting: 0, oldest: 0, offered: 0, handled: 0, abandoned: 0, hasStats: Boolean(stats), outcome: Boolean(stats && stats.outcome) };
            for (const [name, row] of waitingRows) {
              if (!include(name)) continue;
              totals.waiting += row.waiting;
              if (row.oldest && (!totals.oldest || row.oldest < totals.oldest)) totals.oldest = row.oldest;
            }
            if (stats) {
              for (const row of stats.rows) {
                if (!row.name || !include(row.name)) continue;
                totals.offered += row.count;
                if (/abandon/i.test(row.kind)) totals.abandoned += row.count;
                else if (/normal/i.test(row.kind)) totals.handled += row.count;
              }
            }
            this.data = totals;
          }
        }
        this.lastGood = Date.now();
        this.error = '';
      } catch (err) {
        this.error = (err && err.message) || String(err);
      }
      this.render();
    }

    waitCell(since, now) {
      return since
        ? `<span class="pill ${this.levelOf((now - since) / 1000, this.waitLevels)}" data-since="${since}">${clock(now - since)}</span>`
        : '<span class="pill">--:--</span>';
    }

    render() {
      const now = Date.now();
      const d = this.data;
      this.card.classList.toggle('stale', Boolean(this.error && this.lastGood));
      this.card.title = this.error;
      if (this.error && !this.lastGood) {
        this.card.innerHTML = `<div class="msg">${esc(this.error)}</div>`;
        return;
      }
      if (!d) {
        this.card.innerHTML = '<div class="msg">Loading…</div>';
        return;
      }
      if (d.unknown) {
        this.card.innerHTML = '<div class="msg">Queue access could not be determined. Check the agent profile setting.</div>';
        return;
      }
      const cell = (value, label) => `<div class="cell"><div class="v">${value}</div><div class="l">${label}</div></div>`;
      if (d.none) {
        this.card.innerHTML = ['Waiting', 'Longest wait', 'Offered', 'Handled', 'Abandoned'].map((l) => cell('N/A', l)).join('');
        return;
      }
      const waiting = `<span class="pill ${this.levelOf(d.waiting, this.waitingLevels)}">${d.waiting}</span>`;
      this.card.innerHTML = [
        cell(waiting, 'Waiting'),
        cell(this.waitCell(d.waiting ? d.oldest : 0, now), 'Longest wait'),
        cell(d.hasStats ? d.offered : 'N/A', 'Offered today'),
        cell(d.outcome ? d.handled : 'N/A', 'Handled'),
        cell(d.outcome ? d.abandoned : 'N/A', 'Abandoned'),
      ].join('');
    }

    tick() {
      const now = Date.now();
      this.shadowRoot.querySelectorAll('[data-since]').forEach((el) => {
        const since = Number(el.dataset.since);
        el.textContent = clock(now - since);
        el.className = `pill ${this.levelOf((now - since) / 1000, this.waitLevels)}`.trim();
      });
      if (this.lastGood && now - this.lastGood > this.staleMs && !this.error) {
        this.error = 'The data has not refreshed recently.';
        this.render();
      }
    }
  }

  Object.entries(PROPS).forEach(([prop, attr]) => {
    Object.defineProperty(QueueScroll.prototype, prop, {
      get() {
        return this.values[prop] !== undefined ? this.values[prop] : (this.getAttribute(attr) || '');
      },
      set(value) {
        this.values[prop] = value;
        if (this.isConnected) this.refresh();
      },
    });
  });

  customElements.define('queue-scroll', QueueScroll);
})();
