// Retainify — Contacts sample data
// Northhill & Co. — small-batch home goods + apparel.
// Mix of lifecycle stages, statuses, sources for a real-feeling list.

const TAG_PALETTE = {
  // Brighter playful palette per merchant request.
  forest:    { bg: '#DCE7DF', ink: '#1F3D2F' },
  blue:      { bg: '#DCE4ED', ink: '#25406A' },
  amber:     { bg: '#F1E4C5', ink: '#6B5018' },
  purple:    { bg: '#EAD6EA', ink: '#5A2E5A' },
  tan:       { bg: '#E4DAD7', ink: '#5A3F38' },
  red:       { bg: '#EED9D2', ink: '#7A2E1F' },
};

const TAGS = [
  { id: 't_vip',         name: 'VIP',                color: 'forest' },
  { id: 't_wholesale',   name: 'Wholesale',          color: 'blue' },
  { id: 't_bf25',        name: 'Black Friday 2025',  color: 'amber' },
  { id: 't_press',       name: 'Press list',         color: 'purple' },
  { id: 't_local',       name: 'Portland local',     color: 'tan' },
  { id: 't_giftcard',    name: 'Gift card holder',   color: 'red' },
  { id: 't_subscriber',  name: 'Newsletter',         color: 'blue' },
  { id: 't_returner',    name: '2x returner',        color: 'amber' },
];

// Lifecycle stage spec — for pills + 5-stop indicator + tooltips.
const LIFECYCLE = {
  new:              { id: 'new',              label: 'New',             bg: 'var(--info-bg)',  ink: 'var(--info-ink)',  rule: 'First seen ≤ 14 days ago, no orders yet.' },
  never_purchased:  { id: 'never_purchased',  label: 'Never purchased', bg: '#E4DAD7',         ink: '#5A3F38',          rule: 'Around 14+ days, hasn’t placed an order.' },
  active:           { id: 'active',           label: 'Active',          bg: 'var(--brand-100)',ink: 'var(--brand-700)', rule: 'Ordered in the last 30 days.' },
  at_risk:          { id: 'at_risk',          label: 'At-risk',         bg: 'var(--warn-bg)',  ink: 'var(--warn-ink)',  rule: 'Last order 31–90 days ago.' },
  churned:          { id: 'churned',          label: 'Churned',         bg: 'var(--status-draft-bg)', ink: 'var(--status-draft-ink)', rule: 'Last order more than 90 days ago.' },
};
const LIFECYCLE_ORDER = ['new', 'never_purchased', 'active', 'at_risk', 'churned'];

const STATUS = {
  subscribed:     { label: 'Subscribed',     bg: 'var(--success-bg)',       ink: 'var(--success-ink)' },
  unsubscribed:   { label: 'Unsubscribed',   bg: 'var(--status-draft-bg)',  ink: 'var(--status-draft-ink)' },
  bounced:        { label: 'Bounced',        bg: 'var(--danger-bg)',        ink: 'var(--danger-ink)' },
  complained:     { label: 'Complained',     bg: 'var(--danger-bg)',        ink: 'var(--danger-ink)' },
  never_opted_in: { label: 'Never opted in', bg: '#E7E4D8',                 ink: '#4A4736' },
};

const SOURCE = {
  popup:            'Popup',
  cart_abandoned:   'Abandoned cart',
  shopify_customer: 'Shopify customer',
  csv_import:       'CSV import',
  push_only:        'Push only',
  manual:           'Added manually',
};

// Helper to build event objects
const ev = (kind, at, payload = {}) => ({ kind, at, payload });

const CONTACTS = [
  {
    id: 'c1', email: 'maren.holloway@gmail.com', name: 'Maren Holloway',
    firstSeenAt: 'Feb 3, 2025', lastSeenAt: '12 min ago',
    source: 'popup',
    subscriptionStatus: 'subscribed',
    pushEnabled: true, pushDevices: 2,
    marketingConsentAt: 'Feb 3, 2025',
    lifecycleStage: 'active',
    tags: ['t_vip', 't_returner', 't_local'],
    segments: [{ id: 'sg_vip', name: 'VIP buyers' }, { id: 'sg_engaged', name: 'Engaged subscribers' }, { id: 'sg_local', name: 'Portland local' }],
    activeJourneys: [{ name: 'Post-Purchase Thank You', step: 'Step 2 of 3', startedAt: '2 days ago' }],
    pastJourneys: 4,
    stats: {
      totalSpent: 2148.00, orderCount: 7, lastOrderAt: '3 days ago', averageOrderValue: 306.86,
      cartAbandonCount: 2, lastCartAbandonAt: '6 weeks ago', lastCartValue: 84,
      emailsSent: 42, emailsOpened: 31, emailsClicked: 18, openRate: 73.8, clickRate: 42.9,
      pushesSent: 11, pushesClicked: 6,
    },
    timeline: [
      ev('email_opened',  '12 min ago',  { subject: 'A small thank-you, on us' }),
      ev('order_placed',  '3 days ago',  { order: '#10821', total: 184.00, items: '2 items' }),
      ev('cart_recovered','3 days ago',  { value: 184.00 }),
      ev('cart_abandoned','3 days ago',  { value: 184.00, items: 'Linen throw, Tea light set' }),
      ev('email_clicked', '4 days ago',  { subject: 'Your cart is waiting' }),
      ev('email_sent',    '4 days ago',  { subject: 'You left something behind', journey: 'Abandoned Cart — Standard' }),
      ev('entered_journey','4 days ago', { name: 'Abandoned Cart — Standard' }),
      ev('push_clicked',  '11 days ago', { title: 'New: cedar tumbler restock' }),
      ev('order_placed',  '2 weeks ago', { order: '#10743', total: 412.50, items: '5 items' }),
      ev('tagged',        '3 weeks ago', { tag: 'VIP' }),
      ev('order_placed',  '1 month ago', { order: '#10612', total: 96.00, items: '1 item' }),
      ev('email_opened',  '5 weeks ago', { subject: 'Spring collection is here' }),
      ev('signed_up',     'Feb 3, 2025', { source: 'Popup — “10% off first order”' }),
    ],
    orders: [
      { date: '3 days ago', number: '#10821', items: 2, total: 184.00, status: 'Fulfilled' },
      { date: '2 weeks ago', number: '#10743', items: 5, total: 412.50, status: 'Fulfilled' },
      { date: '1 month ago', number: '#10612', items: 1, total: 96.00, status: 'Fulfilled' },
      { date: 'Mar 14', number: '#10488', items: 3, total: 248.00, status: 'Fulfilled' },
      { date: 'Mar 2',  number: '#10412', items: 2, total: 162.50, status: 'Fulfilled' },
      { date: 'Feb 22', number: '#10377', items: 1, total: 78.00, status: 'Fulfilled' },
      { date: 'Feb 9',  number: '#10311', items: 4, total: 1067.00, status: 'Fulfilled' },
    ],
    carts: [
      { date: '3 days ago', items: 'Linen throw, Tea light set', value: 184.00, status: 'Recovered' },
      { date: '6 weeks ago', items: 'Cedar tumbler (set of 2)', value: 84.00, status: 'Abandoned' },
    ],
    emails: [
      { date: '12 min ago', subject: 'A small thank-you, on us', journey: 'Post-Purchase Thank You', opened: true, clicked: false },
      { date: '4 days ago', subject: 'You left something behind', journey: 'Abandoned Cart — Standard', opened: true, clicked: true },
      { date: '5 weeks ago', subject: 'Spring collection is here', journey: 'Broadcast — Apr', opened: true, clicked: false },
      { date: 'Mar 14', subject: 'Welcome to the family', journey: 'Welcome Series', opened: true, clicked: true },
    ],
    pushes: [
      { date: '11 days ago', title: 'New: cedar tumbler restock', body: 'Back in stock — limited run.', delivered: true, clicked: true },
      { date: 'Apr 4',       title: 'Spring drop is live',        body: '12 new pieces, made in PDX.',  delivered: true, clicked: false },
    ],
  },
  {
    id: 'c2', email: 'oren.dax@studiokin.co', name: 'Oren Dax',
    firstSeenAt: 'May 18, 2026', lastSeenAt: '2 hours ago',
    source: 'popup',
    subscriptionStatus: 'subscribed', pushEnabled: false, marketingConsentAt: 'May 18, 2026',
    lifecycleStage: 'new',
    tags: ['t_subscriber'],
    segments: [{ id: 'sg_new', name: 'New (this week)' }, { id: 'sg_subscribed', name: 'Subscribed' }],
    activeJourneys: [{ name: 'Welcome Series', step: 'Step 1 of 3', startedAt: '2 hours ago' }],
    pastJourneys: 0,
    stats: {
      totalSpent: 0, orderCount: 0, lastOrderAt: null, averageOrderValue: 0,
      cartAbandonCount: 0, lastCartAbandonAt: null, lastCartValue: 0,
      emailsSent: 1, emailsOpened: 1, emailsClicked: 0, openRate: 100, clickRate: 0,
      pushesSent: 0, pushesClicked: 0,
    },
    timeline: [
      ev('email_opened', '2 hours ago', { subject: 'Welcome to Northhill' }),
      ev('email_sent',   '2 hours ago', { subject: 'Welcome to Northhill', journey: 'Welcome Series' }),
      ev('entered_journey', '2 hours ago', { name: 'Welcome Series' }),
      ev('confirmed_email', '2 hours ago', {}),
      ev('signed_up',    '2 hours ago', { source: 'Popup — Editorial' }),
    ],
    orders: [], carts: [],
    emails: [{ date: '2 hours ago', subject: 'Welcome to Northhill', journey: 'Welcome Series', opened: true, clicked: false }],
    pushes: [],
  },
  {
    id: 'c3', email: 'jules.kapoor@hey.com', name: 'Jules Kapoor',
    firstSeenAt: 'Nov 4, 2024', lastSeenAt: '5 days ago',
    source: 'cart_abandoned',
    subscriptionStatus: 'subscribed', pushEnabled: true, pushDevices: 1, marketingConsentAt: 'Nov 4, 2024',
    lifecycleStage: 'at_risk',
    tags: ['t_bf25', 't_returner'],
    segments: [{ id: 'sg_atrisk', name: 'At-risk customers' }, { id: 'sg_bf25', name: 'Black Friday 2025 buyers' }],
    activeJourneys: [], pastJourneys: 3,
    stats: {
      totalSpent: 684.50, orderCount: 3, lastOrderAt: '47 days ago', averageOrderValue: 228.17,
      cartAbandonCount: 4, lastCartAbandonAt: '5 days ago', lastCartValue: 138,
      emailsSent: 28, emailsOpened: 14, emailsClicked: 4, openRate: 50.0, clickRate: 14.3,
      pushesSent: 6, pushesClicked: 1,
    },
    timeline: [
      ev('cart_abandoned','5 days ago', { value: 138, items: 'Olive wool throw, Beeswax tapers' }),
      ev('email_opened',  '12 days ago', { subject: 'Did you forget?' }),
      ev('email_sent',    '12 days ago', { subject: 'Did you forget?', journey: 'Abandoned Cart — Standard' }),
      ev('order_placed',  '47 days ago', { order: '#10401', total: 246.00, items: '3 items' }),
      ev('order_placed',  'Nov 28, 2025', { order: '#9921', total: 312.00, items: '4 items' }),
      ev('tagged',        'Nov 28, 2025', { tag: 'Black Friday 2025' }),
      ev('signed_up',     'Nov 4, 2024',  { source: 'Cart abandoned' }),
    ],
    orders: [
      { date: '47 days ago', number: '#10401', items: 3, total: 246.00, status: 'Fulfilled' },
      { date: 'Nov 28, 2025', number: '#9921', items: 4, total: 312.00, status: 'Fulfilled' },
      { date: 'Nov 4, 2024', number: '#7218', items: 1, total: 126.50, status: 'Fulfilled' },
    ],
    carts: [
      { date: '5 days ago', items: 'Olive wool throw, Beeswax tapers', value: 138.00, status: 'Abandoned' },
    ],
    emails: [
      { date: '12 days ago', subject: 'Did you forget?', journey: 'Abandoned Cart — Standard', opened: true, clicked: false },
    ],
    pushes: [],
  },
  {
    id: 'c4', email: 'rosa.dimartino@studiorosa.it', name: 'Rosa Di Martino',
    firstSeenAt: 'Sep 12, 2024', lastSeenAt: '4 months ago',
    source: 'shopify_customer',
    subscriptionStatus: 'subscribed', pushEnabled: false, marketingConsentAt: 'Sep 12, 2024',
    lifecycleStage: 'churned',
    tags: ['t_wholesale'],
    segments: [{ id: 'sg_churned', name: 'Churned customers' }, { id: 'sg_wholesale', name: 'Wholesale accounts' }],
    activeJourneys: [], pastJourneys: 2,
    stats: {
      totalSpent: 4280.00, orderCount: 11, lastOrderAt: '4 months ago', averageOrderValue: 389.09,
      cartAbandonCount: 1, lastCartAbandonAt: '6 months ago', lastCartValue: 320,
      emailsSent: 36, emailsOpened: 9, emailsClicked: 1, openRate: 25.0, clickRate: 2.8,
      pushesSent: 0, pushesClicked: 0,
    },
    timeline: [
      ev('order_placed',  '4 months ago', { order: '#9801', total: 580.00, items: '6 items' }),
      ev('synced_from_shopify', '4 months ago', {}),
      ev('email_opened',  '5 months ago', { subject: 'New for the season' }),
      ev('order_placed',  '6 months ago', { order: '#9624', total: 412.00, items: '4 items' }),
      ev('tagged',        '8 months ago', { tag: 'Wholesale' }),
      ev('signed_up',     'Sep 12, 2024', { source: 'Shopify customer' }),
    ],
    orders: [
      { date: '4 months ago', number: '#9801', items: 6, total: 580.00, status: 'Fulfilled' },
      { date: '6 months ago', number: '#9624', items: 4, total: 412.00, status: 'Fulfilled' },
    ],
    carts: [{ date: '6 months ago', items: 'Brass candleholder, Linen napkins x4', value: 320.00, status: 'Recovered' }],
    emails: [
      { date: '5 months ago', subject: 'New for the season', journey: 'Broadcast — Jan', opened: true, clicked: false },
    ],
    pushes: [],
  },
  {
    id: 'c5', email: 'theo.brennan@outlook.com', name: 'Theo Brennan',
    firstSeenAt: 'Mar 22, 2025', lastSeenAt: '3 weeks ago',
    source: 'popup',
    subscriptionStatus: 'unsubscribed', pushEnabled: false,
    marketingConsentAt: 'Mar 22, 2025',
    unsubscribedAt: 'Apr 12, 2026', unsubscribeReason: 'Clicked unsubscribe link in “Spring drop is live”',
    lifecycleStage: 'never_purchased',
    tags: ['t_subscriber'],
    segments: [{ id: 'sg_unsub', name: 'Unsubscribed' }],
    activeJourneys: [], pastJourneys: 1,
    stats: {
      totalSpent: 0, orderCount: 0, lastOrderAt: null, averageOrderValue: 0,
      cartAbandonCount: 1, lastCartAbandonAt: '2 months ago', lastCartValue: 64,
      emailsSent: 14, emailsOpened: 5, emailsClicked: 0, openRate: 35.7, clickRate: 0,
      pushesSent: 0, pushesClicked: 0,
    },
    timeline: [
      ev('unsubscribed', '3 weeks ago', { reason: 'Clicked unsubscribe in “Spring drop is live”' }),
      ev('email_opened', '3 weeks ago', { subject: 'Spring drop is live' }),
      ev('cart_abandoned','2 months ago', { value: 64, items: 'Hinoki soap' }),
      ev('signed_up',    'Mar 22, 2025', { source: 'Popup — “Hello there”' }),
    ],
    orders: [], carts: [{ date: '2 months ago', items: 'Hinoki soap', value: 64.00, status: 'Abandoned' }],
    emails: [{ date: '3 weeks ago', subject: 'Spring drop is live', journey: 'Broadcast — Apr', opened: true, clicked: false }],
    pushes: [],
  },
  {
    id: 'c6', email: 'aanya.r@northhill.shop', name: 'Aanya Ramachandran',
    firstSeenAt: 'Aug 1, 2024', lastSeenAt: 'yesterday',
    source: 'shopify_customer',
    subscriptionStatus: 'subscribed', pushEnabled: true, pushDevices: 3, marketingConsentAt: 'Aug 1, 2024',
    lifecycleStage: 'active',
    tags: ['t_vip', 't_press', 't_giftcard'],
    segments: [{ id: 'sg_vip', name: 'VIP buyers' }, { id: 'sg_press', name: 'Press list' }, { id: 'sg_engaged', name: 'Engaged subscribers' }],
    activeJourneys: [{ name: 'Welcome Series — VIP', step: 'Step 3 of 3', startedAt: '5 days ago' }],
    pastJourneys: 6,
    stats: {
      totalSpent: 5942.00, orderCount: 18, lastOrderAt: '6 days ago', averageOrderValue: 330.11,
      cartAbandonCount: 3, lastCartAbandonAt: '2 months ago', lastCartValue: 142,
      emailsSent: 62, emailsOpened: 51, emailsClicked: 28, openRate: 82.3, clickRate: 45.2,
      pushesSent: 22, pushesClicked: 14,
    },
    timeline: [
      ev('email_clicked', 'yesterday', { subject: 'VIP early access — Fall edit' }),
      ev('order_placed',  '6 days ago', { order: '#10810', total: 412.00, items: '4 items' }),
      ev('tagged',        '2 weeks ago', { tag: 'Press list' }),
      ev('order_placed',  '3 weeks ago', { order: '#10692', total: 248.00, items: '2 items' }),
      ev('signed_up',     'Aug 1, 2024', { source: 'Shopify customer' }),
    ],
    orders: [
      { date: '6 days ago', number: '#10810', items: 4, total: 412.00, status: 'Fulfilled' },
      { date: '3 weeks ago', number: '#10692', items: 2, total: 248.00, status: 'Fulfilled' },
    ],
    carts: [],
    emails: [{ date: 'yesterday', subject: 'VIP early access — Fall edit', journey: 'Broadcast — VIPs', opened: true, clicked: true }],
    pushes: [{ date: '2 days ago', title: 'VIP early access', body: 'You\'re in 24 hours early.', delivered: true, clicked: true }],
  },
  {
    id: 'c7', email: 'mikko.salonen@kotimaa.fi', name: 'Mikko Salonen',
    firstSeenAt: 'Dec 9, 2024', lastSeenAt: '8 days ago',
    source: 'cart_abandoned',
    subscriptionStatus: 'bounced', pushEnabled: false, marketingConsentAt: 'Dec 9, 2024',
    bouncedAt: 'Apr 1, 2026', bounceReason: 'Hard bounce — mailbox does not exist',
    lifecycleStage: 'churned',
    tags: [],
    segments: [{ id: 'sg_churned', name: 'Churned customers' }],
    activeJourneys: [], pastJourneys: 2,
    stats: {
      totalSpent: 412.00, orderCount: 1, lastOrderAt: '9 months ago', averageOrderValue: 412.00,
      cartAbandonCount: 3, lastCartAbandonAt: '8 days ago', lastCartValue: 96,
      emailsSent: 22, emailsOpened: 3, emailsClicked: 0, openRate: 13.6, clickRate: 0,
      pushesSent: 0, pushesClicked: 0,
    },
    timeline: [
      ev('bounced', 'Apr 1, 2026', { reason: 'Hard bounce — mailbox does not exist' }),
      ev('cart_abandoned','8 days ago', { value: 96, items: 'Wool throw' }),
      ev('order_placed',  '9 months ago', { order: '#8821', total: 412.00, items: '3 items' }),
      ev('signed_up',     'Dec 9, 2024', { source: 'Cart abandoned' }),
    ],
    orders: [{ date: '9 months ago', number: '#8821', items: 3, total: 412.00, status: 'Fulfilled' }],
    carts: [{ date: '8 days ago', items: 'Wool throw', value: 96.00, status: 'Abandoned' }],
    emails: [],
    pushes: [],
  },
  {
    id: 'c8', email: 'priya.shah@inkandgrain.co', name: 'Priya Shah',
    firstSeenAt: 'May 28, 2026', lastSeenAt: '1 day ago',
    source: 'popup',
    subscriptionStatus: 'subscribed', pushEnabled: false, marketingConsentAt: 'May 28, 2026',
    lifecycleStage: 'new',
    tags: ['t_subscriber'],
    segments: [{ id: 'sg_new', name: 'New (this week)' }, { id: 'sg_subscribed', name: 'Subscribed' }],
    activeJourneys: [{ name: 'Welcome Series', step: 'Step 2 of 3', startedAt: '5 days ago' }],
    pastJourneys: 0,
    stats: {
      totalSpent: 0, orderCount: 0, lastOrderAt: null, averageOrderValue: 0,
      cartAbandonCount: 0, lastCartAbandonAt: null, lastCartValue: 0,
      emailsSent: 2, emailsOpened: 2, emailsClicked: 1, openRate: 100, clickRate: 50,
      pushesSent: 0, pushesClicked: 0,
    },
    timeline: [
      ev('email_clicked', '1 day ago', { subject: 'Meet the founders' }),
      ev('email_sent',    '1 day ago', { subject: 'Meet the founders', journey: 'Welcome Series' }),
      ev('signed_up',     'May 28, 2026', { source: 'Popup — Editorial' }),
    ],
    orders: [], carts: [],
    emails: [{ date: '1 day ago', subject: 'Meet the founders', journey: 'Welcome Series', opened: true, clicked: true }],
    pushes: [],
  },
  {
    id: 'c9', email: 'casper.weil@weilstudio.de', name: 'Casper Weil',
    firstSeenAt: 'Apr 4, 2025', lastSeenAt: '2 days ago',
    source: 'push_only',
    subscriptionStatus: 'never_opted_in', pushEnabled: true, pushDevices: 1,
    lifecycleStage: 'never_purchased',
    tags: [],
    segments: [{ id: 'sg_pushonly', name: 'Push only' }],
    activeJourneys: [], pastJourneys: 0,
    stats: {
      totalSpent: 0, orderCount: 0, lastOrderAt: null, averageOrderValue: 0,
      cartAbandonCount: 0, lastCartAbandonAt: null, lastCartValue: 0,
      emailsSent: 0, emailsOpened: 0, emailsClicked: 0, openRate: null, clickRate: null,
      pushesSent: 8, pushesClicked: 3,
    },
    timeline: [
      ev('push_clicked', '2 days ago', { title: 'New: brass candleholder' }),
      ev('push_sent',    '2 days ago', { title: 'New: brass candleholder' }),
      ev('signed_up',    'Apr 4, 2025', { source: 'Push opt-in' }),
    ],
    orders: [], carts: [], emails: [],
    pushes: [{ date: '2 days ago', title: 'New: brass candleholder', body: 'Made by Ana in PDX.', delivered: true, clicked: true }],
  },
  {
    id: 'c10', email: 'sara.lo@gmail.com', name: 'Sara Lo',
    firstSeenAt: 'Jan 11, 2025', lastSeenAt: '38 days ago',
    source: 'popup',
    subscriptionStatus: 'subscribed', pushEnabled: false, marketingConsentAt: 'Jan 11, 2025',
    lifecycleStage: 'at_risk',
    tags: ['t_subscriber'],
    segments: [{ id: 'sg_atrisk', name: 'At-risk customers' }],
    activeJourneys: [], pastJourneys: 1,
    stats: {
      totalSpent: 198.00, orderCount: 1, lastOrderAt: '38 days ago', averageOrderValue: 198.00,
      cartAbandonCount: 2, lastCartAbandonAt: '2 weeks ago', lastCartValue: 64,
      emailsSent: 18, emailsOpened: 7, emailsClicked: 2, openRate: 38.9, clickRate: 11.1,
      pushesSent: 0, pushesClicked: 0,
    },
    timeline: [
      ev('cart_abandoned','2 weeks ago', { value: 64, items: 'Tea light set' }),
      ev('order_placed',  '38 days ago', { order: '#10522', total: 198.00, items: '2 items' }),
      ev('signed_up',     'Jan 11, 2025', { source: 'Popup' }),
    ],
    orders: [{ date: '38 days ago', number: '#10522', items: 2, total: 198.00, status: 'Fulfilled' }],
    carts: [{ date: '2 weeks ago', items: 'Tea light set', value: 64.00, status: 'Abandoned' }],
    emails: [],
    pushes: [],
  },
  {
    id: 'c11', email: 'noah.giles@gilesatelier.com', name: 'Noah Giles',
    firstSeenAt: 'Jun 1, 2026', lastSeenAt: '3 hours ago',
    source: 'popup',
    subscriptionStatus: 'subscribed', pushEnabled: true, pushDevices: 1, marketingConsentAt: 'Jun 1, 2026',
    lifecycleStage: 'new',
    tags: [],
    segments: [{ id: 'sg_new', name: 'New (this week)' }, { id: 'sg_subscribed', name: 'Subscribed' }],
    activeJourneys: [{ name: 'Welcome Series', step: 'Step 1 of 3', startedAt: '3 hours ago' }],
    pastJourneys: 0,
    stats: {
      totalSpent: 0, orderCount: 0, lastOrderAt: null, averageOrderValue: 0,
      cartAbandonCount: 0, lastCartAbandonAt: null, lastCartValue: 0,
      emailsSent: 1, emailsOpened: 0, emailsClicked: 0, openRate: 0, clickRate: 0,
      pushesSent: 0, pushesClicked: 0,
    },
    timeline: [
      ev('email_sent', '3 hours ago', { subject: 'Welcome to Northhill', journey: 'Welcome Series' }),
      ev('signed_up',  '3 hours ago', { source: 'Popup — Editorial' }),
    ],
    orders: [], carts: [], emails: [], pushes: [],
  },
  {
    id: 'c12', email: 'farah.k@khouriferments.com', name: 'Farah Khouri',
    firstSeenAt: 'Oct 20, 2024', lastSeenAt: '4 hours ago',
    source: 'shopify_customer',
    subscriptionStatus: 'subscribed', pushEnabled: true, pushDevices: 2, marketingConsentAt: 'Oct 20, 2024',
    lifecycleStage: 'active',
    tags: ['t_vip', 't_giftcard', 't_returner'],
    segments: [{ id: 'sg_vip', name: 'VIP buyers' }, { id: 'sg_engaged', name: 'Engaged subscribers' }],
    activeJourneys: [],
    pastJourneys: 3,
    stats: {
      totalSpent: 1820.00, orderCount: 6, lastOrderAt: '8 days ago', averageOrderValue: 303.33,
      cartAbandonCount: 2, lastCartAbandonAt: '3 weeks ago', lastCartValue: 120,
      emailsSent: 38, emailsOpened: 26, emailsClicked: 12, openRate: 68.4, clickRate: 31.6,
      pushesSent: 14, pushesClicked: 5,
    },
    timeline: [
      ev('order_placed', '8 days ago', { order: '#10778', total: 248.00, items: '3 items' }),
      ev('signed_up',    'Oct 20, 2024', { source: 'Shopify customer' }),
    ],
    orders: [{ date: '8 days ago', number: '#10778', items: 3, total: 248.00, status: 'Fulfilled' }],
    carts: [], emails: [], pushes: [],
  },
  {
    id: 'c13', email: 'ben.ackers@gmail.com', name: 'Ben Ackers',
    firstSeenAt: 'Mar 1, 2025', lastSeenAt: '60 days ago',
    source: 'cart_abandoned',
    subscriptionStatus: 'unsubscribed', pushEnabled: false, marketingConsentAt: 'Mar 1, 2025',
    unsubscribedAt: 'Apr 2, 2026', unsubscribeReason: 'Clicked unsubscribe link',
    lifecycleStage: 'never_purchased',
    tags: [],
    segments: [{ id: 'sg_unsub', name: 'Unsubscribed' }],
    activeJourneys: [], pastJourneys: 1,
    stats: {
      totalSpent: 0, orderCount: 0, lastOrderAt: null, averageOrderValue: 0,
      cartAbandonCount: 2, lastCartAbandonAt: '60 days ago', lastCartValue: 88,
      emailsSent: 9, emailsOpened: 3, emailsClicked: 0, openRate: 33.3, clickRate: 0,
      pushesSent: 0, pushesClicked: 0,
    },
    timeline: [
      ev('unsubscribed','60 days ago', { reason: 'Clicked unsubscribe link' }),
      ev('signed_up',   'Mar 1, 2025', { source: 'Cart abandoned' }),
    ],
    orders: [], carts: [], emails: [], pushes: [],
  },
  {
    id: 'c14', email: 'lena.q@quintaroom.com', name: 'Lena Quintaro',
    firstSeenAt: 'Jul 15, 2025', lastSeenAt: '21 days ago',
    source: 'popup',
    subscriptionStatus: 'subscribed', pushEnabled: false, marketingConsentAt: 'Jul 15, 2025',
    lifecycleStage: 'never_purchased',
    tags: ['t_subscriber', 't_press'],
    segments: [{ id: 'sg_subscribed', name: 'Subscribed' }, { id: 'sg_engaged', name: 'Engaged subscribers' }],
    activeJourneys: [], pastJourneys: 2,
    stats: {
      totalSpent: 0, orderCount: 0, lastOrderAt: null, averageOrderValue: 0,
      cartAbandonCount: 1, lastCartAbandonAt: '6 weeks ago', lastCartValue: 142,
      emailsSent: 24, emailsOpened: 16, emailsClicked: 3, openRate: 66.7, clickRate: 12.5,
      pushesSent: 0, pushesClicked: 0,
    },
    timeline: [
      ev('email_opened', '21 days ago', { subject: 'Spring drop is live' }),
      ev('cart_abandoned','6 weeks ago', { value: 142, items: 'Brass candleholder' }),
      ev('signed_up',    'Jul 15, 2025', { source: 'Popup' }),
    ],
    orders: [], carts: [{ date: '6 weeks ago', items: 'Brass candleholder', value: 142.00, status: 'Abandoned' }],
    emails: [{ date: '21 days ago', subject: 'Spring drop is live', journey: 'Broadcast — Apr', opened: true, clicked: false }],
    pushes: [],
  },
];

// Summary counters for the stats strip.
const summarizeContacts = (cs) => {
  const total = cs.length;
  const subscribed = cs.filter(c => c.subscriptionStatus === 'subscribed').length;
  const unsubscribed = cs.filter(c => c.subscriptionStatus === 'unsubscribed' || c.subscriptionStatus === 'bounced' || c.subscriptionStatus === 'complained').length;
  // "new this week" — anything with lifecycleStage 'new'
  const newThisWeek = cs.filter(c => c.lifecycleStage === 'new').length;
  return { total, subscribed, unsubscribed, newThisWeek };
};

// Event kind → icon + color
const EVENT_VISUALS = {
  signed_up:        { icon: 'Mail',      tint: 'trigger' },
  confirmed_email:  { icon: 'Check',     tint: 'trigger' },
  cart_abandoned:   { icon: 'Cart',      tint: 'sms' },
  cart_recovered:   { icon: 'Check',     tint: 'email' },
  order_placed:     { icon: 'Heart',     tint: 'email' },
  email_sent:       { icon: 'Send',      tint: 'delay' },
  email_opened:     { icon: 'Eye',       tint: 'email' },
  email_clicked:    { icon: 'Bolt',      tint: 'email' },
  push_sent:        { icon: 'Bell',      tint: 'split' },
  push_clicked:     { icon: 'Bolt',      tint: 'split' },
  unsubscribed:     { icon: 'Close',     tint: 'exit' },
  bounced:          { icon: 'Close',     tint: 'exit' },
  complained:       { icon: 'Close',     tint: 'exit' },
  tagged:           { icon: 'Tag',       tint: 'tag' },
  untagged:         { icon: 'Tag',       tint: 'tag' },
  entered_journey:  { icon: 'Flow',      tint: 'trigger' },
  exited_journey:   { icon: 'Exit',      tint: 'exit' },
  added_to_segment: { icon: 'Sliders',   tint: 'trigger' },
  synced_from_shopify: { icon: 'Refresh', tint: 'delay' },
};

const EVENT_LABEL = {
  signed_up:        'Signed up',
  confirmed_email:  'Confirmed email',
  cart_abandoned:   'Cart abandoned',
  cart_recovered:   'Cart recovered',
  order_placed:     'Order placed',
  email_sent:       'Email sent',
  email_opened:     'Email opened',
  email_clicked:    'Email clicked',
  push_sent:        'Push sent',
  push_clicked:     'Push clicked',
  unsubscribed:     'Unsubscribed',
  bounced:          'Email bounced',
  complained:       'Marked as spam',
  tagged:           'Tagged',
  untagged:         'Tag removed',
  entered_journey:  'Entered journey',
  exited_journey:   'Exited journey',
  added_to_segment: 'Added to segment',
  synced_from_shopify: 'Synced from Shopify',
};

const fmtMoney = (n) => n == null ? '—' : `$${n.toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const fmtPctC  = (n) => n == null ? '—' : `${n.toFixed(1)}%`;
const initials = (nameOrEmail) => {
  if (!nameOrEmail) return '·';
  const t = nameOrEmail.trim();
  if (t.includes(' ')) return t.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  return t[0].toUpperCase();
};

window.RetainifyContacts = {
  CONTACTS, TAGS, TAG_PALETTE, LIFECYCLE, LIFECYCLE_ORDER, STATUS, SOURCE,
  EVENT_VISUALS, EVENT_LABEL,
  summarizeContacts, fmtMoney, fmtPctC, initials,
};
