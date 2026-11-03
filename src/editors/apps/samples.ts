import type { AppCell, AppSpec } from '../../api/types.js';
import type { SampleData } from './appData.js';

/**
 * The editor test page's sample apps (DES-APPS-001 §3; mockup states B, C and E): what the runtime shows on a daemon
 * that has no app store, beside the stub data seam. Made-up rows, clearly labelled samples; nothing reaches a source.
 */

export interface SampleApp { slug: string; spec: AppSpec; data: SampleData }

const t = (name: string, type: 'string' | 'number' | 'integer' | 'boolean' | 'date' | 'datetime') => ({ name, type });

const ESCALATIONS: AppSpec = {
  schema: 'wicked.apps/v1',
  name: 'Escalations',
  description: 'Open escalations and SLA breaches for the support team.',
  theme: { mode: 'auto' },
  linkHosts: ['status.example.com'],
  pages: [
    {
      id: 'overview', title: 'Overview', components: [
        { id: 'search', type: 'filter', filter: 'search', label: 'Search', box: { x: 0, y: 0, w: 4, h: 1 } },
        { id: 'region', type: 'filter', filter: 'select', label: 'Region', box: { x: 6, y: 0, w: 3, h: 1 }, options: { kind: 'query', query: { query: 'regions' }, value: 'region' } },
        { id: 'period', type: 'filter', filter: 'date-range', label: 'Last 90 days', box: { x: 9, y: 0, w: 3, h: 1 }, default: { lastDays: 90 } },
        { id: 'kpi_open', type: 'kpi', title: 'Open escalations', box: { x: 0, y: 1, w: 3, h: 2 }, data: { query: 'open_escalations' }, value: 'open', delta: 'delta', caption: 'vs previous 90 days' },
        { id: 'kpi_breaches', type: 'kpi', title: 'SLA breaches', box: { x: 3, y: 1, w: 3, h: 2 }, data: { query: 'sla_breaches' }, value: 'breaches', delta: 'delta', caption: 'vs previous 90 days' },
        { id: 'kpi_median', type: 'kpi', title: 'Median time to owner', box: { x: 6, y: 1, w: 3, h: 2 }, data: { query: 'median_time_to_owner' }, value: 'seconds', format: { kind: 'duration' }, delta: 'delta', caption: 'vs previous 90 days' },
        { id: 'kpi_unassigned', type: 'kpi', title: 'Unassigned', box: { x: 9, y: 1, w: 3, h: 2 }, data: { query: 'unassigned' }, value: 'unassigned', caption: 'of 214 open' },
        { id: 'weekly', type: 'chart', chart: 'line', title: 'SLA breaches per week', box: { x: 0, y: 3, w: 6, h: 5 }, data: { query: 'breaches_weekly' }, x: 'week', series: [{ column: 'breaches', label: 'Breaches' }, { column: 'target', label: 'Target (4 a week)' }] },
        { id: 'by_region', type: 'chart', chart: 'bar', title: 'Breaches by region', box: { x: 6, y: 3, w: 6, h: 5 }, data: { query: 'breaches_by_region' }, x: 'region', series: [{ column: 'breaches' }] },
        {
          id: 'escalations', type: 'table', title: 'Escalations', box: { x: 0, y: 8, w: 12, h: 6 },
          data: { query: 'escalation_list', params: { region: 'filter.region', search: 'filter.search' } },
          columns: [{ column: 'id', label: 'Ticket' }, { column: 'customer', label: 'Customer' }, { column: 'region', label: 'Region' }, { column: 'owner', label: 'Owner' }, { column: 'sla', label: 'SLA' }, { column: 'age_seconds', label: 'Age', format: { kind: 'duration' } }],
          rowActions: [{ label: 'Assign to me', action: 'assign_to_me', params: { id: 'row.id' } }],
        },
      ],
    },
    {
      id: 'detail', title: 'Detail', components: [
        { id: 'about', type: 'text', style: 'heading', text: 'How escalations are counted', box: { x: 0, y: 0, w: 8, h: 1 } },
        { id: 'about_body', type: 'text', style: 'body', text: 'An escalation is open from the moment a ticket is escalated until its owner closes it. A breach is a ticket past its SLA.', box: { x: 0, y: 1, w: 8, h: 2 } },
        { id: 'status_link', type: 'link', label: 'Support status page', to: { kind: 'href', href: 'https://status.example.com/support' }, box: { x: 0, y: 3, w: 3, h: 1 } },
      ],
    },
  ],
  queries: [
    { id: 'open_escalations', source: 'support-pg', kind: 'sql', output: [t('open', 'integer'), t('delta', 'integer')] },
    { id: 'sla_breaches', source: 'support-pg', kind: 'sql', output: [t('breaches', 'integer'), t('delta', 'integer')] },
    { id: 'median_time_to_owner', source: 'support-pg', kind: 'sql', output: [t('seconds', 'integer'), t('delta', 'string')] },
    { id: 'unassigned', source: 'support-pg', kind: 'sql', output: [t('unassigned', 'integer')] },
    { id: 'breaches_weekly', source: 'support-pg', kind: 'sql', output: [t('week', 'string'), t('breaches', 'integer'), t('target', 'integer')] },
    { id: 'breaches_by_region', source: 'support-pg', kind: 'sql', output: [t('region', 'string'), t('breaches', 'integer')] },
    { id: 'regions', source: 'support-pg', kind: 'sql', output: [t('region', 'string')] },
    {
      id: 'escalation_list', source: 'support-pg', kind: 'sql',
      params: { type: 'object', properties: { region: { type: 'string', maxLength: 80 }, search: { type: 'string', maxLength: 200 } } },
      output: [t('id', 'integer'), t('customer', 'string'), t('region', 'string'), t('owner', 'string'), t('sla', 'string'), t('age_seconds', 'integer')],
    },
  ],
  actions: [
    {
      id: 'assign_to_me', kind: 'row-write', source: 'support-pg-writer', table: 'support.tickets', op: 'update',
      set: { owner: { kind: 'viewer', claim: 'email' } }, key: { id: { kind: 'param', name: 'id' } },
      params: { type: 'object', properties: { id: { type: 'integer', minimum: 1 } }, required: ['id'] },
      description: 'Make yourself the owner of this ticket.',
    },
  ],
};

const weeks = ['Aug 4', 'Aug 11', 'Aug 18', 'Aug 25', 'Sep 1', 'Sep 8', 'Sep 15', 'Sep 22', 'Sep 29', 'Oct 6', 'Oct 13', 'Oct 20', 'Oct 27'];
const weekly = [2, 3, 2.5, 4, 3.5, 5, 4.5, 6, 5.5, 6.5, 6, 8, 7.5];
const ESCALATIONS_ROWS: Record<string, AppCell[][]> = {
  open_escalations: [[214, 12]],
  sla_breaches: [[37, 5]],
  median_time_to_owner: [[9_660, '-18m']],
  unassigned: [[19]],
  breaches_weekly: weeks.map((w, i) => [w, weekly[i]!, 4]),
  breaches_by_region: [['EMEA', 13], ['North America', 10], ['APAC', 7], ['LATAM', 5], ['ANZ', 2]],
  regions: [['EMEA'], ['North America'], ['APAC'], ['LATAM'], ['ANZ']],
  escalation_list: [
    [4821, 'Northwind Ltd', 'EMEA', 'unassigned', 'breached', 275_040],
    [4817, 'Contoso Health', 'North America', 'j.okafor', 'due in 2h', 118_800],
    [4809, 'Fabrikam Freight', 'APAC', 'm.chen', 'on track', 25_200],
    [4802, 'Tailspin Toys', 'EMEA', 'unassigned', 'due in 6h', 61_200],
    [4796, 'Adventure Works', 'LATAM', 'r.silva', 'on track', 14_400],
    [4790, 'Wingtip Imports', 'ANZ', 'unassigned', 'breached', 302_400],
  ],
};

const REFUNDS: AppSpec = {
  schema: 'wicked.apps/v1',
  name: 'Refund approvals',
  description: 'Pending refunds to approve or reject.',
  linkHosts: [],
  pages: [
    {
      id: 'pending', title: 'Pending', components: [
        { id: 'team', type: 'filter', filter: 'select', label: 'Team', box: { x: 9, y: 0, w: 3, h: 1 }, options: { kind: 'values', values: [{ value: 'finance-ops', label: 'Finance ops' }] }, default: 'finance-ops' },
        { id: 'kpi_pending', type: 'kpi', title: 'Pending', box: { x: 0, y: 1, w: 4, h: 2 }, data: { query: 'pending_total' }, value: 'pending', caption: '$1,630.39 in total' },
        { id: 'kpi_approved', type: 'kpi', title: 'Approved this month', box: { x: 4, y: 1, w: 4, h: 2 }, data: { query: 'approved_month' }, value: 'approved', caption: '$6,904.12' },
        { id: 'kpi_decide', type: 'kpi', title: 'Median time to decide', box: { x: 8, y: 1, w: 4, h: 2 }, data: { query: 'median_decide' }, value: 'seconds', format: { kind: 'duration' }, caption: 'last 30 days' },
        {
          id: 'request', type: 'form', title: 'Request a refund', box: { x: 0, y: 3, w: 4, h: 6 },
          fields: [{ name: 'order', label: 'Order', input: 'text', required: true }, { name: 'amount', label: 'Amount (USD)', input: 'number', required: true }, { name: 'reason', label: 'Reason', input: 'text' }],
          submit: { label: 'Submit request', action: 'request_refund', params: { order: 'form.order', amount: 'form.amount', reason: 'form.reason' } },
        },
        {
          id: 'pending_refunds', type: 'table', title: 'Pending refunds', box: { x: 4, y: 3, w: 8, h: 6 }, data: { query: 'pending_refunds' },
          columns: [{ column: 'id', label: 'Refund' }, { column: 'customer', label: 'Customer' }, { column: 'amount', label: 'Amount', format: { kind: 'currency', currency: 'USD' } }, { column: 'requested', label: 'Requested', format: { kind: 'date' } }],
          rowActions: [{ label: 'Approve', action: 'approve_refund', params: { id: 'row.id' } }, { label: 'Reject', action: 'reject_refund', params: { id: 'row.id' } }],
        },
      ],
    },
    { id: 'approved', title: 'Approved', components: [] },
    { id: 'rejected', title: 'Rejected', components: [] },
  ],
  queries: [
    { id: 'pending_total', source: 'finance-db', kind: 'sql', output: [t('pending', 'integer')] },
    { id: 'approved_month', source: 'finance-db', kind: 'sql', output: [t('approved', 'integer')] },
    { id: 'median_decide', source: 'finance-db', kind: 'sql', output: [t('seconds', 'integer')] },
    { id: 'pending_refunds', source: 'finance-api', kind: 'rest', rowPath: '$.items[*]', output: [t('id', 'integer'), t('customer', 'string'), t('amount', 'number'), t('requested', 'date')] },
  ],
  actions: [
    {
      id: 'approve_refund', kind: 'api', source: 'finance-api', call: { kind: 'tool', tool: 'POST /refunds/{id}/approve' },
      args: { id: { kind: 'param', name: 'id' }, approved_by: { kind: 'viewer', claim: 'email' }, channel: { kind: 'literal', value: 'refund-app' } },
      params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] }, description: 'Approve this refund.',
    },
    {
      id: 'reject_refund', kind: 'api', source: 'finance-api', call: { kind: 'tool', tool: 'POST /refunds/{id}/reject' },
      args: { id: { kind: 'param', name: 'id' }, rejected_by: { kind: 'viewer', claim: 'email' } },
      params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
    },
    {
      id: 'request_refund', kind: 'api', source: 'finance-api', call: { kind: 'tool', tool: 'POST /refunds' },
      args: { order: { kind: 'param', name: 'order' }, amount: { kind: 'param', name: 'amount' }, reason: { kind: 'param', name: 'reason' }, requested_by: { kind: 'viewer', claim: 'email' } },
      params: { type: 'object', properties: { order: { type: 'string', maxLength: 40 }, amount: { type: 'number', minimum: 0 }, reason: { type: 'string', maxLength: 400 } }, required: ['order', 'amount'] },
    },
  ],
};

const REFUND_ROWS: Record<string, AppCell[][]> = {
  pending_total: [[4]],
  approved_month: [[27]],
  median_decide: [[18_720]],
  pending_refunds: [[4821, 'Northwind Ltd', 312.4, '2026-10-30'], [4822, 'Tailspin Toys', 58, '2026-10-31'], [4826, 'Adventure Works', 1240, '2026-10-31'], [4830, 'Wingtip Imports', 19.99, '2026-11-01']],
};

export const SAMPLE_APPS: Record<string, SampleApp> = {
  escalations: { slug: 'escalations', spec: ESCALATIONS, data: { rows: ESCALATIONS_ROWS, viewer: 'priya@example.com' } },
  refunds: { slug: 'refund-approvals', spec: REFUNDS, data: { rows: REFUND_ROWS, viewer: 'dana@example.com' } },
};

export function sampleApp(name: string | null): SampleApp {
  return SAMPLE_APPS[name ?? ''] ?? SAMPLE_APPS['escalations']!;
}
