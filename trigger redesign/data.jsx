// Retainify — Sample data + utilities

const TRIGGERS = {
  customer_created: { id: 'customer_created', label: 'Subscribed to Marketing', glyph: 'Users', tint: 'trigger', desc: 'Starts when a new contact opts in.' },
  cart_abandoned:   { id: 'cart_abandoned',   label: 'Cart Abandoned',         glyph: 'Cart',  tint: 'sms',     desc: 'Starts when a cart sits idle for 60 minutes.' },
  order_placed:     { id: 'order_placed',     label: 'Order Placed',           glyph: 'Heart', tint: 'email',   desc: 'Starts when a customer completes checkout.' },
  win_back:         { id: 'win_back',         label: 'Inactive 90 days',       glyph: 'Refresh', tint: 'delay', desc: 'Starts when a customer has not purchased in 90 days.' },
  entered_segment:  { id: 'entered_segment',  label: 'Entered a segment',      glyph: 'Venn',    tint: 'segment', desc: 'Starts when a contact newly matches a segment you choose.', requiresSegment: true },
};

// Helper to mint email nodes
const email = (id, name, subject, after, afterUnit, discount = 0) => ({
  id, type: 'email', name, subject, preview: '', after, afterUnit, discount, style: 'Classic', enabled: true,
});
const delay = (id, hours) => ({ id, type: 'delay', hours, unit: 'hours' });

// Templates
const TEMPLATES = [
  {
    id: 'welcome',
    name: 'Welcome Series',
    trigger: 'customer_created',
    type: 'Welcome Series',
    description: 'Turn new subscribers into first-time customers with a proven three-touch email series.',
    bestFor: [
      'Introducing new subscribers to your brand',
      'Converting subscribers to first-time customers',
      'Establishing regular email touchpoints',
    ],
    nodes: [
      email('e1', 'Welcome', 'Welcome to the family', 0, 'hours'),
      delay('d1', 48),
      email('e2', 'Meet the founders', 'A short story', 48, 'hours'),
      delay('d2', 72),
      email('e3', 'A small gift', 'Here\'s 10% off', 120, 'hours', 10),
    ],
  },
  {
    id: 'cart',
    name: 'Abandoned Cart',
    trigger: 'cart_abandoned',
    type: 'Abandoned Cart',
    description: 'Recover lost sales with a sequence of well-timed reminders.',
    bestFor: ['Reducing cart abandonment', 'Recovering pending revenue', 'Reminding without nagging'],
    nodes: [
      email('e1', 'Cart reminder', 'You left something behind', 0, 'hours'),
      delay('d1', 23),
      email('e2', 'Still thinking?', 'Your cart is waiting', 23, 'hours'),
      delay('d2', 48),
      email('e3', 'Last call', '10% off if you complete today', 71, 'hours', 10),
    ],
  },
  {
    id: 'post',
    name: 'Post-Purchase',
    trigger: 'order_placed',
    type: 'Post Purchase',
    description: 'Thank, educate, and earn a second order from customers who just bought.',
    bestFor: ['Reducing buyer\'s remorse', 'Driving second purchases', 'Collecting reviews'],
    nodes: [
      email('e1', 'Thank you', 'Thanks for your order', 0, 'hours'),
      delay('d1', 70),
      email('e2', 'How are you liking it?', 'Quick check-in', 70, 'hours'),
      delay('d2', 264),
      email('e3', 'Ready for round two?', 'A treat for our regulars', 334, 'hours', 5),
    ],
  },
  {
    id: 'winback',
    name: 'Customer Win-back',
    trigger: 'win_back',
    type: 'Win-back',
    description: 'Re-engage customers who haven\'t purchased in a while and bring them back.',
    bestFor: ['Reviving lapsed customers', 'Reducing churn', 'Surfacing what\'s new'],
    nodes: [
      email('e1', 'We miss you', 'Has it really been 90 days?', 0, 'hours'),
      delay('d1', 72),
      email('e2', 'Something new', 'Look what arrived', 72, 'hours'),
      delay('d2', 96),
      email('e3', 'A small gift', '15% off, no expiry', 168, 'hours', 15),
    ],
  },
];

// Sample existing flows
const FLOWS = [
  {
    id: 'f1', name: 'Welcome Series', status: 'active', trigger: 'customer_created',
    updated: '2 days ago', sent: 1284, openRate: 38.2, clickRate: 6.4,
    nodes: TEMPLATES[0].nodes,
  },
  {
    id: 'f2', name: 'Abandoned Cart — Standard', status: 'active', trigger: 'cart_abandoned',
    updated: '6 days ago', sent: 894, openRate: 42.1, clickRate: 11.3,
    nodes: TEMPLATES[1].nodes,
  },
  {
    id: 'f3', name: 'Post-Purchase Thank You', status: 'paused', trigger: 'order_placed',
    updated: '2 weeks ago', sent: 412, openRate: 51.8, clickRate: 8.9,
    nodes: TEMPLATES[2].nodes,
  },
  {
    id: 'f4', name: 'Win-back 90-day', status: 'draft', trigger: 'win_back',
    updated: 'just now', sent: null, openRate: null, clickRate: null,
    nodes: TEMPLATES[3].nodes,
  },
  {
    id: 'f5', name: 'VIP First Purchase Reward', status: 'draft', trigger: 'order_placed',
    updated: 'yesterday', sent: null, openRate: null, clickRate: null,
    nodes: [ email('e1', 'A note for our VIPs', 'Welcome to the inner circle', 0, 'hours', 20) ],
  },
];

const TRIGGER_OPTIONS = Object.values(TRIGGERS);

// Counts nodes for display
const countSteps = (flow) => flow.nodes.filter(n => n.type === 'email').length;

const fmtNum = (n) => n == null ? '—' : n.toLocaleString();
const fmtPct = (n) => n == null ? '—' : `${n.toFixed(1)}%`;

window.RetainifyData = { TRIGGERS, TEMPLATES, FLOWS, TRIGGER_OPTIONS, countSteps, fmtNum, fmtPct };
