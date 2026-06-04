// Retainify — Segments sample data
// System segments, user segments, templates, field catalog for the rule builder.

// ── Field catalog (used by the builder dropdown) ─────────────────────────
// Each field: { id, label, group, type, unit?, options? }
// type drives which operators show up.
const FIELDS = [
  // Purchase
  { id: 'totalSpent',     label: 'Total spent',          group: 'Purchase', type: 'money' },
  { id: 'orderCount',     label: 'Order count',          group: 'Purchase', type: 'number' },
  { id: 'lastOrderAt',    label: 'Last order date',      group: 'Purchase', type: 'date' },
  { id: 'aov',            label: 'Average order value',  group: 'Purchase', type: 'money' },
  // Cart
  { id: 'cartAbandonCount', label: 'Abandoned cart count', group: 'Cart',   type: 'number' },
  { id: 'lastCartAt',     label: 'Last cart abandoned',  group: 'Cart',     type: 'date' },
  { id: 'lastCartValue',  label: 'Last cart value',      group: 'Cart',     type: 'money' },
  { id: 'hasActiveCart',  label: 'Has an active cart',   group: 'Cart',     type: 'boolean' },
  // Email
  { id: 'emailsSent',     label: 'Emails sent',          group: 'Email engagement', type: 'number' },
  { id: 'emailsOpened',   label: 'Emails opened',        group: 'Email engagement', type: 'number' },
  { id: 'openRate',       label: 'Open rate',            group: 'Email engagement', type: 'percent' },
  { id: 'emailsClicked',  label: 'Emails clicked',       group: 'Email engagement', type: 'number' },
  { id: 'clickRate',      label: 'Click rate',           group: 'Email engagement', type: 'percent' },
  { id: 'lastEmailOpenedAt', label: 'Last email opened', group: 'Email engagement', type: 'date' },
  // Profile
  { id: 'subscriptionStatus', label: 'Subscription status', group: 'Profile', type: 'enum',
    options: [{ id: 'subscribed', label: 'Subscribed' }, { id: 'unsubscribed', label: 'Unsubscribed' }, { id: 'bounced', label: 'Bounced' }, { id: 'never_opted_in', label: 'Never opted in' }] },
  { id: 'lifecycleStage', label: 'Lifecycle stage',      group: 'Profile', type: 'enum',
    options: [{ id: 'new', label: 'New' }, { id: 'active', label: 'Active' }, { id: 'at_risk', label: 'At-risk' }, { id: 'churned', label: 'Churned' }, { id: 'never_purchased', label: 'Never purchased' }] },
  { id: 'source',         label: 'Source',               group: 'Profile', type: 'enum',
    options: [{ id: 'popup', label: 'Popup' }, { id: 'cart_abandoned', label: 'Abandoned cart' }, { id: 'shopify_customer', label: 'Shopify customer' }, { id: 'csv_import', label: 'CSV import' }, { id: 'push_only', label: 'Push only' }, { id: 'manual', label: 'Added manually' }] },
  { id: 'hasTag',         label: 'Has tag',              group: 'Profile', type: 'tag' },
  { id: 'firstSeenAt',    label: 'First seen',           group: 'Profile', type: 'date' },
  { id: 'lastSeenAt',     label: 'Last seen',            group: 'Profile', type: 'date' },
  { id: 'pushEnabled',    label: 'Push enabled',         group: 'Profile', type: 'boolean' },
];

const FIELD_BY_ID = Object.fromEntries(FIELDS.map(f => [f.id, f]));

// ── Operators per type ────────────────────────────────────────────────────
const OPERATORS = {
  money:   [{ id: 'gt', label: 'is more than' }, { id: 'lt', label: 'is less than' }, { id: 'eq', label: 'is exactly' }, { id: 'between', label: 'is between' }],
  number:  [{ id: 'gt', label: 'is more than' }, { id: 'lt', label: 'is less than' }, { id: 'eq', label: 'is exactly' }, { id: 'between', label: 'is between' }],
  percent: [{ id: 'gt', label: 'is more than' }, { id: 'lt', label: 'is less than' }, { id: 'between', label: 'is between' }],
  date:    [{ id: 'in_last', label: 'in the last' }, { id: 'more_than', label: 'more than' }, { id: 'before', label: 'is before' }, { id: 'after', label: 'is after' }, { id: 'empty', label: 'is empty' }],
  enum:    [{ id: 'is', label: 'is' }, { id: 'is_not', label: 'is not' }, { id: 'is_one_of', label: 'is one of' }],
  boolean: [{ id: 'is_true', label: 'is true' }, { id: 'is_false', label: 'is false' }],
  string:  [{ id: 'is', label: 'is' }, { id: 'is_not', label: 'is not' }, { id: 'contains', label: 'contains' }, { id: 'empty', label: 'is empty' }],
  tag:     [{ id: 'has', label: 'is' }, { id: 'has_not', label: 'is not' }, { id: 'has_any', label: 'is any of' }],
};

// ── System segments (pinned, can't be deleted) ────────────────────────────
const SYSTEM_SEGMENTS = [
  { id: 'sys_all',          name: 'All contacts',       description: 'Everyone in your audience',                          icon: 'Users',   contactCount: 4230, delta: '+128 this week', flows: [], system: true },
  { id: 'sys_subscribed',   name: 'Subscribed',         description: 'Email opt-ins, not unsubscribed or bounced',          icon: 'Check',   contactCount: 3812, delta: '+114 this week', flows: ['Welcome Series'], system: true },
  { id: 'sys_unsub',        name: 'Unsubscribed',       description: 'Suppressed contacts \u2014 no marketing sends',       icon: 'Close',   contactCount: 312,  delta: '+8 this week',   flows: [], system: true },
  { id: 'sys_new',          name: 'New (this week)',    description: 'First seen in the last 7 days',                       icon: 'Sparkle', contactCount: 128,  delta: '+32% vs prior',  flows: ['Welcome Series'], system: true },
  { id: 'sys_atrisk',       name: 'At-risk customers',  description: 'Last order 31\u201390 days ago',                      icon: 'Clock',   contactCount: 264,  delta: '+12 this week',  flows: ['Win-back \u2014 Soft'], system: true },
  { id: 'sys_churned',      name: 'Churned customers',  description: 'Last order more than 90 days ago',                    icon: 'Exit',    contactCount: 482,  delta: '+5 this week',   flows: [], system: true },
];

// ── User segments ─────────────────────────────────────────────────────────
const USER_SEGMENTS = [
  {
    id: 'sg_vip', name: 'VIP buyers', description: 'Spent over $1,000 lifetime, with active subscription',
    kind: 'dynamic', contactCount: 142, delta: '+8 this week', deltaPct: 12, updated: '2 hours ago',
    flows: ['VIP early access', 'Anniversary thank-you'],
    sparkline: [120, 124, 128, 130, 132, 130, 135, 138, 140, 139, 142],
    rules: {
      type: 'group', match: 'all', children: [
        { type: 'rule', field: 'totalSpent', op: 'gt', value: 1000 },
        { type: 'rule', field: 'subscriptionStatus', op: 'is', value: 'subscribed' },
      ],
    },
  },
  {
    id: 'sg_engaged', name: 'Engaged subscribers', description: 'Opened or clicked an email in the last 30 days',
    kind: 'dynamic', contactCount: 1248, delta: '+42 this week', deltaPct: 4, updated: 'yesterday',
    flows: ['Broadcast \u2014 Spring drop'],
    sparkline: [1180, 1192, 1204, 1198, 1210, 1218, 1224, 1232, 1238, 1244, 1248],
    rules: {
      type: 'group', match: 'any', children: [
        { type: 'rule', field: 'lastEmailOpenedAt', op: 'in_last', value: 30, unit: 'days' },
        { type: 'rule', field: 'clickRate', op: 'gt', value: 20 },
      ],
    },
  },
  {
    id: 'sg_bf25', name: 'Black Friday 2025 buyers', description: 'Customers tagged Black Friday 2025',
    kind: 'static', contactCount: 318, delta: 'Static \u2014 not updating', deltaPct: 0, updated: 'Nov 30, 2025',
    flows: ['BFCM anniversary'],
    sparkline: [318, 318, 318, 318, 318, 318, 318, 318, 318, 318, 318],
    rules: null,
  },
  {
    id: 'sg_cart7', name: 'Recent cart abandoners', description: 'Abandoned a cart worth $50+ in the last 7 days',
    kind: 'dynamic', contactCount: 84, delta: '+24 this week', deltaPct: 40, updated: '4 hours ago',
    flows: ['Abandoned Cart \u2014 Standard'],
    sparkline: [56, 60, 62, 64, 68, 72, 76, 78, 80, 82, 84],
    rules: {
      type: 'group', match: 'all', children: [
        { type: 'rule', field: 'lastCartAt', op: 'in_last', value: 7, unit: 'days' },
        { type: 'rule', field: 'lastCartValue', op: 'gt', value: 50 },
      ],
    },
  },
  {
    id: 'sg_local', name: 'Portland local', description: 'Tagged as Portland local for in-store events',
    kind: 'dynamic', contactCount: 96, delta: '+2 this week', deltaPct: 2, updated: '3 days ago',
    flows: [],
    sparkline: [88, 90, 90, 92, 92, 93, 94, 94, 95, 95, 96],
    rules: {
      type: 'group', match: 'all', children: [
        { type: 'rule', field: 'hasTag', op: 'has', value: 't_local' },
      ],
    },
  },
  {
    id: 'sg_press', name: 'Press list', description: 'Tagged press contacts for early access',
    kind: 'static', contactCount: 24, delta: 'Static \u2014 not updating', deltaPct: 0, updated: '2 weeks ago',
    flows: [],
    sparkline: [24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24],
    rules: null,
  },
  {
    id: 'sg_wholesale', name: 'Wholesale accounts', description: 'Tagged wholesale buyers with AOV over $400',
    kind: 'dynamic', contactCount: 38, delta: '+1 this week', deltaPct: 3, updated: '5 days ago',
    flows: ['Wholesale catalog drop'],
    sparkline: [34, 35, 35, 36, 36, 37, 37, 37, 38, 38, 38],
    rules: {
      type: 'group', match: 'all', children: [
        { type: 'rule', field: 'hasTag', op: 'has', value: 't_wholesale' },
        { type: 'rule', field: 'aov', op: 'gt', value: 400 },
      ],
    },
  },
  {
    id: 'sg_engaged_unbought', name: 'Engaged but never bought',
    description: 'Opened 3+ emails but hasn\u2019t placed an order in 30+ days',
    kind: 'dynamic', contactCount: 412, delta: '+18 this week', deltaPct: 4, updated: 'yesterday',
    flows: ['First-order nudge'],
    sparkline: [388, 394, 398, 402, 404, 406, 408, 410, 411, 412, 412],
    rules: {
      type: 'group', match: 'all', children: [
        { type: 'rule', field: 'emailsOpened', op: 'gt', value: 3 },
        { type: 'rule', field: 'orderCount', op: 'eq', value: 0 },
      ],
    },
  },
];

// ── Templates ─────────────────────────────────────────────────────────────
const TEMPLATES = [
  {
    id: 'tpl_bigspend', name: 'Big spenders', description: 'Customers who\u2019ve spent over $200 lifetime',
    icon: 'Heart', accent: '#DCE7DF', accentInk: '#1F3D2F',
    rules: { type: 'group', match: 'all', children: [{ type: 'rule', field: 'totalSpent', op: 'gt', value: 200 }] },
  },
  {
    id: 'tpl_cart', name: 'Recent cart abandoners', description: 'Abandoned a cart in the last 7 days',
    icon: 'Cart', accent: '#F1E4C5', accentInk: '#6B5018',
    rules: { type: 'group', match: 'all', children: [{ type: 'rule', field: 'lastCartAt', op: 'in_last', value: 7, unit: 'days' }] },
  },
  {
    id: 'tpl_engaged', name: 'Engaged but never bought', description: 'Opened 3+ emails, no orders yet',
    icon: 'Eye', accent: '#DCE4ED', accentInk: '#25406A',
    rules: { type: 'group', match: 'all', children: [
      { type: 'rule', field: 'emailsOpened', op: 'gt', value: 3 },
      { type: 'rule', field: 'orderCount', op: 'eq', value: 0 },
    ] },
  },
  {
    id: 'tpl_winback', name: 'Win-back candidates', description: 'At-risk lifecycle with prior order over $100',
    icon: 'Clock', accent: '#EAD6EA', accentInk: '#5A2E5A',
    rules: { type: 'group', match: 'all', children: [
      { type: 'rule', field: 'lifecycleStage', op: 'is', value: 'at_risk' },
      { type: 'rule', field: 'totalSpent', op: 'gt', value: 100 },
    ] },
  },
];

// ── Sample preview contacts for the live preview pane ─────────────────────
// 6 lightweight rows — name, email, lifecycle, lastSeen, spent
const PREVIEW_CONTACTS = [
  { id: 'p1', name: 'Maren Holloway',  email: 'maren.holloway@gmail.com',    lifecycle: 'active', spent: 2148, lastSeen: '12 min ago' },
  { id: 'p2', name: 'Aanya Ramachandran', email: 'aanya.r@northhill.shop',   lifecycle: 'active', spent: 5942, lastSeen: 'yesterday' },
  { id: 'p3', name: 'Farah Khouri',    email: 'farah.k@khouriferments.com',  lifecycle: 'active', spent: 1820, lastSeen: '4 hours ago' },
  { id: 'p4', name: 'Hugh Bertelsen',  email: 'hugh@bertelsen.studio',       lifecycle: 'active', spent: 1462, lastSeen: '2 days ago' },
  { id: 'p5', name: 'Reema Khan',      email: 'reema.k@reemandco.com',       lifecycle: 'active', spent: 1218, lastSeen: '3 days ago' },
  { id: 'p6', name: 'Tomas Veiga',     email: 'tveiga@oficinaveiga.pt',      lifecycle: 'active', spent: 1144, lastSeen: '5 days ago' },
];

// ── Helpers ───────────────────────────────────────────────────────────────
const formatRuleValue = (rule) => {
  const f = FIELD_BY_ID[rule.field]; if (!f) return String(rule.value);
  if (f.type === 'money') return `$${Number(rule.value).toLocaleString()}`;
  if (f.type === 'percent') return `${rule.value}%`;
  if (f.type === 'date' && (rule.op === 'in_last' || rule.op === 'more_than')) return `${rule.value} ${rule.unit || 'days'}`;
  if (f.type === 'enum') return f.options?.find(o => o.id === rule.value)?.label || rule.value;
  if (f.type === 'boolean') return rule.op === 'is_true' ? 'yes' : 'no';
  if (f.type === 'tag') {
    const tag = (window.RetainifyContacts?.TAGS || []).find(t => t.id === rule.value);
    return tag?.name || rule.value;
  }
  return String(rule.value);
};

const opLabel = (rule) => {
  const f = FIELD_BY_ID[rule.field]; if (!f) return rule.op;
  return (OPERATORS[f.type] || []).find(o => o.id === rule.op)?.label || rule.op;
};

// Best-default value when picking a field
const defaultValueFor = (fieldId) => {
  const f = FIELD_BY_ID[fieldId];
  if (!f) return '';
  if (f.type === 'money' || f.type === 'number') return 100;
  if (f.type === 'percent') return 20;
  if (f.type === 'date') return 7;
  if (f.type === 'enum') return f.options?.[0]?.id;
  if (f.type === 'boolean') return true;
  if (f.type === 'tag') return (window.RetainifyContacts?.TAGS || [])[0]?.id;
  return '';
};

const defaultOpFor = (fieldId) => {
  const f = FIELD_BY_ID[fieldId]; if (!f) return 'is';
  if (f.type === 'date') return 'in_last';
  if (f.type === 'boolean') return 'is_true';
  return (OPERATORS[f.type] || [{ id: 'is' }])[0].id;
};

window.RetainifySegments = {
  FIELDS, FIELD_BY_ID, OPERATORS,
  SYSTEM_SEGMENTS, USER_SEGMENTS, TEMPLATES,
  PREVIEW_CONTACTS,
  formatRuleValue, opLabel, defaultValueFor, defaultOpFor,
};
