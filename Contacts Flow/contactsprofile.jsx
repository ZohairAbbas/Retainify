// Retainify — Contact Profile page
// Editorial header (serif email + name) → lifecycle journey → stat strip → tabs → right rail.

const { useState: useStateProfile, useMemo: useMemoProfile } = React;

// ── Lifecycle 5-stop journey indicator ────────────────────────────────────
function LifecycleJourney({ stage }) {
  const { LIFECYCLE, LIFECYCLE_ORDER } = window.RetainifyContacts;
  const idx = LIFECYCLE_ORDER.indexOf(stage);
  return (
    <div className="rt-journey">
      <div className="rt-journey-track">
        {LIFECYCLE_ORDER.map((s, i) => {
          const l = LIFECYCLE[s];
          const on = i === idx;
          const passed = i < idx;
          return (
            <div key={s} className={`rt-journey-stop ${on ? 'rt-on' : ''} ${passed ? 'rt-passed' : ''}`}>
              <div className="rt-journey-dot" style={on ? { background: l.ink, color: l.bg } : undefined}>
                {on && <span className="rt-journey-dot-inner" />}
              </div>
              <div className="rt-journey-label" title={l.rule}>{l.label}</div>
            </div>
          );
        })}
        <div className="rt-journey-line" />
        <div className="rt-journey-line-fill" style={{ width: `${(idx / (LIFECYCLE_ORDER.length - 1)) * 100}%` }} />
      </div>
    </div>
  );
}

// ── Suppression banner ────────────────────────────────────────────────────
function SuppressionBanner({ contact }) {
  if (!['unsubscribed', 'bounced', 'complained'].includes(contact.subscriptionStatus)) return null;
  const kind = contact.subscriptionStatus;
  const cfg = {
    unsubscribed: { tone: 'warn', title: `Unsubscribed on ${contact.unsubscribedAt || '—'}`,
      body: `This contact won't receive emails or push notifications until they re-subscribe.`, action: 'Re-subscribe' },
    bounced: { tone: 'danger', title: `Email bounced on ${contact.bouncedAt || '—'}`,
      body: `${contact.bounceReason || 'Hard bounce.'} Re-subscribing a bounced address may harm your sender reputation.`, action: null },
    complained: { tone: 'danger', title: 'Marked as spam',
      body: 'A spam complaint was recorded against an email sent to this contact.', action: null },
  }[kind];
  return (
    <div className={`rt-suppress rt-suppress-${cfg.tone}`}>
      <Icons.Lock size={16} />
      <div className="rt-suppress-body">
        <div className="rt-suppress-title">{cfg.title}</div>
        <div className="rt-suppress-sub">{cfg.body}</div>
        {contact.unsubscribeReason && kind === 'unsubscribed' && (
          <div className="rt-suppress-reason"><span className="t-micro muted">Source</span> {contact.unsubscribeReason}</div>
        )}
      </div>
      {cfg.action && <button className="btn btn-secondary btn-sm">{cfg.action}</button>}
    </div>
  );
}

// ── Mini stat (denser than dashboard) ─────────────────────────────────────
function MiniStat({ label, value, sub }) {
  return (
    <div className="rt-mstat">
      <div className="t-micro muted">{label}</div>
      <div className="rt-mstat-value">{value}</div>
      {sub && <div className="rt-mstat-sub muted">{sub}</div>}
    </div>
  );
}

// ── Timeline event ────────────────────────────────────────────────────────
function TimelineEvent({ event, last }) {
  const { EVENT_VISUALS, EVENT_LABEL, fmtMoney } = window.RetainifyContacts;
  const vis = EVENT_VISUALS[event.kind] || { icon: 'Bolt', tint: 'delay' };
  const Icon = Icons[vis.icon] || Icons.Bolt;
  const p = event.payload || {};
  // Compose context line
  let context = null;
  switch (event.kind) {
    case 'email_sent': case 'email_opened': case 'email_clicked':
      context = <>Subject: <span className="rt-tl-quote">“{p.subject}”</span>{p.journey && <> · <span className="muted">{p.journey}</span></>}</>;
      break;
    case 'order_placed':
      context = <>Order {p.order} · {p.items} · <strong>{fmtMoney(p.total)}</strong></>;
      break;
    case 'cart_abandoned':
    case 'cart_recovered':
      context = <>{p.items || ''}{p.value ? <> · <strong>{fmtMoney(p.value)}</strong></> : null}</>;
      break;
    case 'push_sent': case 'push_clicked':
      context = <>Title: <span className="rt-tl-quote">“{p.title}”</span></>;
      break;
    case 'signed_up':
      context = p.source ? <>via {p.source}</> : null;
      break;
    case 'tagged': case 'untagged':
      context = p.tag ? <>Tag: <strong>{p.tag}</strong></> : null;
      break;
    case 'entered_journey': case 'exited_journey':
      context = p.name ? <>Journey: <strong>{p.name}</strong></> : null;
      break;
    case 'unsubscribed': case 'bounced':
      context = p.reason ? <>{p.reason}</> : null;
      break;
    default:
      context = null;
  }
  const hasLink = ['email_clicked', 'email_opened', 'email_sent', 'order_placed', 'entered_journey'].includes(event.kind);
  return (
    <div className="rt-tl-event">
      <div className="rt-tl-rail">
        <div className={`rt-tl-dot rt-tint-${vis.tint}`}><Icon size={12} /></div>
        {!last && <div className="rt-tl-line" />}
      </div>
      <div className="rt-tl-body">
        <div className="rt-tl-head">
          <span className="rt-tl-title">{EVENT_LABEL[event.kind]}</span>
          <span className="rt-tl-time">{event.at}</span>
        </div>
        {context && <div className="rt-tl-context">{context}</div>}
        {hasLink && <button className="rt-tl-link">View →</button>}
      </div>
    </div>
  );
}

// ── Tab tables ────────────────────────────────────────────────────────────
function OrdersTable({ rows }) {
  const { fmtMoney } = window.RetainifyContacts;
  if (!rows.length) return <EmptyTab icon="Heart" title="No orders yet" body="When this contact buys something, it will appear here." />;
  return (
    <div className="rt-subtable">
      <div className="rt-subhead"><div>Date</div><div>Order</div><div>Items</div><div className="rt-tnum">Total</div><div>Status</div></div>
      {rows.map((r, i) => (
        <div key={i} className="rt-subrow">
          <div className="rt-tdate">{r.date}</div>
          <div className="t-mono">{r.number}</div>
          <div>{r.items}</div>
          <div className="rt-tnum"><strong>{fmtMoney(r.total)}</strong></div>
          <div><StatusPill status="subscribed" /><span style={{ display: 'none' }}>{r.status}</span></div>
        </div>
      ))}
    </div>
  );
}

function CartsTable({ rows }) {
  const { fmtMoney } = window.RetainifyContacts;
  if (!rows.length) return <EmptyTab icon="Cart" title="No carts yet" body="Abandoned and recovered carts will show up here." />;
  return (
    <div className="rt-subtable rt-sub4">
      <div className="rt-subhead"><div>Date</div><div>Items</div><div className="rt-tnum">Value</div><div>Status</div></div>
      {rows.map((r, i) => (
        <div key={i} className="rt-subrow">
          <div className="rt-tdate">{r.date}</div>
          <div>{r.items}</div>
          <div className="rt-tnum"><strong>{fmtMoney(r.value)}</strong></div>
          <div>
            <span className={`rt-pill ${r.status === 'Recovered' ? 'rt-pill-success' : r.status === 'In journey' ? 'rt-pill-info' : 'rt-pill-warn'}`}>
              <span className="rt-pill-dot" />{r.status}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function EmailsTable({ rows }) {
  if (!rows.length) return <EmptyTab icon="Mail" title="No emails sent yet" body="Sent emails will appear here as soon as a journey reaches this contact." />;
  return (
    <div className="rt-subtable rt-sub5">
      <div className="rt-subhead"><div>Date</div><div>Subject</div><div>Journey</div><div>Opened</div><div>Clicked</div></div>
      {rows.map((r, i) => (
        <div key={i} className="rt-subrow">
          <div className="rt-tdate">{r.date}</div>
          <div><span className="rt-tl-quote">“{r.subject}”</span></div>
          <div className="muted">{r.journey}</div>
          <div>{r.opened ? <span className="rt-yes"><Icons.Check size={12} /></span> : <span className="muted">—</span>}</div>
          <div>{r.clicked ? <span className="rt-yes"><Icons.Check size={12} /></span> : <span className="muted">—</span>}</div>
        </div>
      ))}
    </div>
  );
}

function PushesTable({ rows }) {
  if (!rows.length) return <EmptyTab icon="Bell" title="No push notifications yet" body="Push notifications sent to this contact will appear here." />;
  return (
    <div className="rt-subtable rt-sub5">
      <div className="rt-subhead"><div>Date</div><div>Title</div><div>Body</div><div>Delivered</div><div>Clicked</div></div>
      {rows.map((r, i) => (
        <div key={i} className="rt-subrow">
          <div className="rt-tdate">{r.date}</div>
          <div><span className="rt-tl-quote">“{r.title}”</span></div>
          <div className="muted">{r.body}</div>
          <div>{r.delivered ? <span className="rt-yes"><Icons.Check size={12} /></span> : <span className="muted">—</span>}</div>
          <div>{r.clicked ? <span className="rt-yes"><Icons.Check size={12} /></span> : <span className="muted">—</span>}</div>
        </div>
      ))}
    </div>
  );
}

function EmptyTab({ icon, title, body }) {
  const Icon = Icons[icon] || Icons.Bolt;
  return (
    <div className="rt-tab-empty">
      <div className="rt-tab-empty-icon"><Icon size={20} /></div>
      <div className="rt-tab-empty-title">{title}</div>
      <div className="rt-tab-empty-body muted">{body}</div>
    </div>
  );
}

// ── Right rail cards ──────────────────────────────────────────────────────
function TagsCard({ contact, onAddTag, onRemoveTag }) {
  const [adding, setAdding] = useStateProfile(false);
  const [value, setValue] = useStateProfile('');
  const { TAGS } = window.RetainifyContacts;
  const available = TAGS.filter(t => !contact.tags.includes(t.id) && (!value || t.name.toLowerCase().includes(value.toLowerCase())));
  return (
    <div className="rt-rail-card">
      <div className="rt-rail-head"><span className="t-micro">Tags</span><span className="rt-rail-count">{contact.tags.length}</span></div>
      <div className="rt-rail-tags">
        {contact.tags.map(t => <TagChip key={t} tagId={t} removable onRemove={() => onRemoveTag(t)} />)}
        {contact.tags.length === 0 && <span className="muted t-small">No tags yet.</span>}
      </div>
      {!adding ? (
        <button className="rt-rail-add" onClick={() => setAdding(true)}><Icons.Plus size={12} /> Add tag</button>
      ) : (
        <div className="rt-rail-addbox">
          <input className="input" autoFocus placeholder="Type a tag…" value={value} onChange={e => setValue(e.target.value)} onBlur={() => setTimeout(() => setAdding(false), 200)} />
          {available.length > 0 && (
            <div className="rt-rail-tagmenu">
              {available.slice(0, 6).map(t => (
                <button key={t.id} className="rt-rail-tagitem" onMouseDown={() => { onAddTag(t.id); setValue(''); setAdding(false); }}>
                  <TagChip tagId={t.id} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SubscriptionCard({ contact, onToggleEmail }) {
  return (
    <div className="rt-rail-card">
      <div className="rt-rail-head"><span className="t-micro">Subscription</span></div>
      <div className="rt-rail-row">
        <div className="rt-rail-row-left"><Icons.Mail size={14} /><span>Email</span></div>
        <div className="rt-rail-row-right">
          <span className="rt-rail-row-val">{window.RetainifyContacts.STATUS[contact.subscriptionStatus]?.label}</span>
          {contact.subscriptionStatus === 'subscribed' && (
            <label className="rt-toggle" style={{ marginLeft: 8 }}>
              <input type="checkbox" checked={contact.subscriptionStatus === 'subscribed'} onChange={onToggleEmail} />
              <span className="rt-toggle-switch" />
            </label>
          )}
        </div>
      </div>
      <div className="rt-rail-row">
        <div className="rt-rail-row-left"><Icons.Bell size={14} /><span>Push</span></div>
        <div className="rt-rail-row-right">
          <span className="rt-rail-row-val">{contact.pushEnabled ? `Subscribed · ${contact.pushDevices || 1} device${(contact.pushDevices || 1) === 1 ? '' : 's'}` : 'Not subscribed'}</span>
        </div>
      </div>
      {contact.marketingConsentAt && (
        <div className="rt-rail-row">
          <div className="rt-rail-row-left"><Icons.Check size={14} /><span>Consented</span></div>
          <div className="rt-rail-row-right">
            <span className="rt-rail-row-val">{contact.marketingConsentAt}</span>
          </div>
        </div>
      )}
      <div className="rt-rail-row">
        <div className="rt-rail-row-left"><Icons.Refresh size={14} /><span>Source</span></div>
        <div className="rt-rail-row-right">
          <span className="rt-rail-row-val">{window.RetainifyContacts.SOURCE[contact.source]}</span>
        </div>
      </div>
    </div>
  );
}

function SegmentsCard({ contact }) {
  return (
    <div className="rt-rail-card">
      <div className="rt-rail-head"><span className="t-micro">Segments</span><span className="rt-rail-count">{contact.segments.length}</span></div>
      {contact.segments.length === 0 ? (
        <div className="muted t-small">Not in any segments yet.</div>
      ) : (
        <div className="rt-rail-seglist">
          {contact.segments.map(s => (
            <a key={s.id} className="rt-rail-seglink">
              <Icons.Sliders size={12} />
              <span>{s.name}</span>
              <Icons.Chevron size={12} className="rt-rail-segchev" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function JourneysCard({ contact }) {
  const [showPast, setShowPast] = useStateProfile(false);
  return (
    <div className="rt-rail-card">
      <div className="rt-rail-head"><span className="t-micro">Journeys</span><span className="rt-rail-count">{contact.activeJourneys.length}</span></div>
      {contact.activeJourneys.length === 0 && contact.pastJourneys === 0 && (
        <div className="muted t-small">Not in any journeys.</div>
      )}
      {contact.activeJourneys.map((j, i) => (
        <div key={i} className="rt-rail-journey">
          <div className="rt-rail-jhead">
            <Icons.Flow size={13} />
            <span className="rt-rail-jname">{j.name}</span>
          </div>
          <div className="rt-rail-jmeta">
            <span>{j.step}</span>
            <span className="muted">· Started {j.startedAt}</span>
          </div>
        </div>
      ))}
      {contact.pastJourneys > 0 && (
        <button className="rt-rail-pastlink" onClick={() => setShowPast(!showPast)}>
          {showPast ? 'Hide' : 'View'} {contact.pastJourneys} past journey{contact.pastJourneys === 1 ? '' : 's'}
        </button>
      )}
    </div>
  );
}

function CustomPropsCard() {
  return (
    <div className="rt-rail-card rt-rail-locked">
      <div className="rt-rail-head"><span className="t-micro">Custom properties</span><SoonPill /></div>
      <div className="rt-rail-lockedbody">
        <Icons.Lock size={14} />
        <div className="t-small muted">Capture data like favorite category, VIP tier, or referral source on each contact.</div>
      </div>
    </div>
  );
}

// ── Profile shell ─────────────────────────────────────────────────────────
function ContactProfile({ contact, onBack, tweakShowJourney }) {
  const { fmtMoney, fmtPctC } = window.RetainifyContacts;
  const [tab, setTab] = useStateProfile('timeline');
  const [c, setC] = useStateProfile(contact);
  const [kebab, setKebab] = useStateProfile(false);

  // Keep local state in sync if parent contact changes (navigating between contacts).
  React.useEffect(() => { setC(contact); setTab('timeline'); }, [contact]);

  const addTag = (id) => setC({ ...c, tags: [...c.tags, id] });
  const removeTag = (id) => setC({ ...c, tags: c.tags.filter(t => t !== id) });
  const toggleEmail = () => setC({ ...c, subscriptionStatus: c.subscriptionStatus === 'subscribed' ? 'unsubscribed' : 'subscribed', unsubscribedAt: 'just now' });

  return (
    <div className="rt-profile">
      {/* Top: back + breadcrumb actions */}
      <div className="rt-profile-bar">
        <button className="btn btn-ghost btn-sm" onClick={onBack}><Icons.ArrowBack size={14} /> All contacts</button>
        <div className="rt-profile-bar-right">
          <button className="btn btn-secondary btn-sm"><Icons.Plus size={14} /> Add tag</button>
          <button className="btn btn-secondary btn-sm"><Icons.Sliders size={14} /> Add to segment</button>
          <div className="rt-kebab-wrap">
            <button className="btn btn-secondary btn-icon" onClick={() => setKebab(!kebab)} aria-label="More"><Icons.More size={16} /></button>
            {kebab && (
              <>
                <div className="rt-veil" onClick={() => setKebab(false)} />
                <div className="rt-menu" style={{ right: 0, left: 'auto' }}>
                  <button><Icons.Type size={14} /> Edit name</button>
                  <button><Icons.Mail size={14} /> Resend confirmation</button>
                  <button>{c.subscriptionStatus === 'subscribed' ? <><Icons.Close size={14} /> Unsubscribe</> : <><Icons.Check size={14} /> Re-subscribe</>}</button>
                  <div className="rt-menu-sep" />
                  <button className="rt-menu-danger"><Icons.Trash size={14} /> Delete contact</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Editorial header */}
      <div className="rt-profile-head">
        <div className="rt-profile-head-left">
          <Avatar name={c.name} email={c.email} size={88} />
          <div className="rt-profile-head-text">
            <div className="t-micro muted" style={{ marginBottom: 8 }}>
              Contact · First seen {c.firstSeenAt}
            </div>
            <h1 className="rt-profile-name">{c.name || c.email}</h1>
            {c.name && <div className="rt-profile-email">{c.email}</div>}
            <div className="rt-profile-pills">
              <StatusPill status={c.subscriptionStatus} />
              <LifecyclePill stage={c.lifecycleStage} />
              <span className="muted t-small">·</span>
              <span className="muted t-small">Last seen {c.lastSeenAt}</span>
            </div>
          </div>
        </div>
        {tweakShowJourney && <LifecycleJourney stage={c.lifecycleStage} />}
      </div>

      {/* Suppression banner */}
      <SuppressionBanner contact={c} />

      <div className="rt-profile-body">
        {/* Left column */}
        <div className="rt-profile-main">
          {/* Stats strip */}
          <div className="rt-mstats">
            <MiniStat label="Total spent" value={c.stats.totalSpent > 0 ? fmtMoney(c.stats.totalSpent) : '—'} sub={c.stats.orderCount ? `Across ${c.stats.orderCount} orders` : 'No orders yet'} />
            <MiniStat label="Orders placed" value={c.stats.orderCount} sub={c.stats.lastOrderAt ? `Last: ${c.stats.lastOrderAt}` : 'No orders yet'} />
            <MiniStat label="Avg. order value" value={c.stats.averageOrderValue ? fmtMoney(c.stats.averageOrderValue) : '—'} sub={c.stats.orderCount > 1 ? 'Across all orders' : c.stats.orderCount === 1 ? 'From single order' : 'Not enough data'} />
            <MiniStat label="Open rate" value={fmtPctC(c.stats.openRate)} sub={`${c.stats.emailsOpened}/${c.stats.emailsSent} emails opened`} />
          </div>

          {/* Tabs */}
          <div className="rt-tabs">
            {[
              { id: 'timeline', label: 'Timeline', count: c.timeline.length },
              { id: 'orders',   label: 'Orders',   count: c.orders.length },
              { id: 'carts',    label: 'Carts',    count: c.carts.length },
              { id: 'emails',   label: 'Emails',   count: c.emails.length },
              { id: 'pushes',   label: 'Pushes',   count: c.pushes.length },
            ].map(t => (
              <button key={t.id} className={`rt-tab ${tab === t.id ? 'rt-on' : ''}`} onClick={() => setTab(t.id)}>
                <span>{t.label}</span>
                <span className="rt-tab-count">{t.count}</span>
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="rt-tabbody">
            {tab === 'timeline' && (
              c.timeline.length === 0 ? (
                <EmptyTab icon="Bolt" title="No activity yet" body="Events will appear here as this contact engages with your store." />
              ) : (
                <div className="rt-timeline">
                  {c.timeline.map((ev, i) => <TimelineEvent key={i} event={ev} last={i === c.timeline.length - 1} />)}
                </div>
              )
            )}
            {tab === 'orders' && <OrdersTable rows={c.orders} />}
            {tab === 'carts' && <CartsTable rows={c.carts} />}
            {tab === 'emails' && <EmailsTable rows={c.emails} />}
            {tab === 'pushes' && <PushesTable rows={c.pushes} />}
          </div>
        </div>

        {/* Right rail */}
        <aside className="rt-profile-rail">
          <TagsCard contact={c} onAddTag={addTag} onRemoveTag={removeTag} />
          <SubscriptionCard contact={c} onToggleEmail={toggleEmail} />
          <SegmentsCard contact={c} />
          <JourneysCard contact={c} />
          <CustomPropsCard />
        </aside>
      </div>
    </div>
  );
}

Object.assign(window, { ContactProfile, LifecycleJourney });
