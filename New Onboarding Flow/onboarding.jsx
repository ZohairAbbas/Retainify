// Retainify — Onboarding (standalone revamp)
// Phases: welcome takeover → persistent setup checklist → celebratory live moment.
// Tasks expand inline with their own mini-UI; progress + skip handled per task.

const { useState: useS, useEffect: useE, useRef: useR } = React;

const OWNER = "Maya";
const STORE = "Northhill & Co.";
const STORE_DOMAIN = "northhill.myshopify.com";

// ── Small helpers ──────────────────────────────────────────────────────
function InfoDot() {
  return (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.5"/></svg>);
}

// A button that shows a spinner for `ms`, then fires onDone.
function ActionButton({ label, busyLabel, cls = "btn btn-primary", ms = 1100, onDone, icon }) {
  const [busy, setBusy] = useS(false);
  return (
    <button className={cls} disabled={busy} onClick={() => { setBusy(true); setTimeout(() => { setBusy(false); onDone && onDone(); }, ms); }}>
      {busy ? <><span className="ob-spin" />{busyLabel || "Working…"}</> : <>{icon}{label}</>}
    </button>
  );
}

// ── Task panels ────────────────────────────────────────────────────────
function StorePanel({ onComplete }) {
  return (
    <div className="ob-panel-pad">
      <p className="ob-panel-lede">We detected the store this app was installed on. Confirm it's the right one — everything Retainify sends and shows will run here.</p>
      <div className="ob-store-confirm">
        <div className="ob-store-avatar">N</div>
        <div className="ob-store-info">
          <div className="ob-si-name">{STORE}</div>
          <div className="ob-si-domain">{STORE_DOMAIN}</div>
        </div>
        <span className="ob-store-badge"><Icons.Check size={13} /> Connected</span>
      </div>
      <div className="ob-panel-actions">
        <ActionButton label="Confirm & continue" busyLabel="Confirming…" ms={800} onDone={onComplete} />
        <span className="ob-time-tag"><Icons.Clock size={13} /> Auto-detected</span>
      </div>
    </div>
  );
}

function SenderPanel({ onComplete }) {
  const [name, setName] = useS(STORE);
  const [email, setEmail] = useS("hello@northhill.com");
  const [reply, setReply] = useS("");
  const valid = name.trim() && /.+@.+\..+/.test(email);
  return (
    <div className="ob-panel-pad">
      <p className="ob-panel-lede">This is the “From” name and address shoppers see in their inbox. A recognizable sender lifts open rates — use your store name and a branded address.</p>
      <div className="ob-field-row">
        <div>
          <label className="field-label">Sender name</label>
          <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Your store name" />
        </div>
        <div>
          <label className="field-label">Sender email</label>
          <input className="input" value={email} onChange={e => setEmail(e.target.value)} placeholder="hello@yourstore.com" />
        </div>
      </div>
      <div className="ob-field-full">
        <label className="field-label">Reply-to email <span className="faint">(optional)</span></label>
        <input className="input" value={reply} onChange={e => setReply(e.target.value)} placeholder="Where replies should land" />
      </div>
      <div className="ob-hint"><InfoDot /><span>Sending from a domain you own (not a free inbox) keeps you out of spam. You can verify your domain later in Settings.</span></div>
      <div className="ob-panel-actions">
        <ActionButton label="Save sender details" busyLabel="Saving…" ms={700} onDone={onComplete} cls={`btn btn-primary ${valid ? "" : "is-disabled"}`} />
      </div>
    </div>
  );
}

function EmbedPanel({ onComplete }) {
  const [enabled, setEnabled] = useS(false);
  return (
    <div className="ob-panel-pad">
      <p className="ob-panel-lede">Your popups and on-site nudges run through a Retainify app embed in your theme. Turn it on once — click below to open your theme editor with the embed pre-highlighted, then hit <b>Save</b> in the top-right.</p>
      <div className="ob-hint"><InfoDot /><span>Nothing appears on your storefront until you also publish a popup (next step). The embed just gives Retainify permission to render.</span></div>
      <div className="ob-panel-actions">
        {!enabled ? (
          <ActionButton label="Open theme editor to enable" busyLabel="Opening theme editor…" ms={1400} icon={<Icons.Exit size={15} />} onDone={() => setEnabled(true)} />
        ) : (
          <>
            <span className="ob-done-word"><Icons.Check size={14} /> Embed enabled in theme</span>
            <button className="btn btn-primary" onClick={onComplete}>Continue</button>
          </>
        )}
      </div>
    </div>
  );
}

function PopupPanel({ onComplete }) {
  return (
    <div className="ob-panel-pad">
      <p className="ob-panel-lede">Start capturing emails from day one. This “Join the club” form appears to first-time visitors — publish it now and refine the copy, image, and timing later from the Popups page.</p>
      <div className="ob-popup-preview">
        <div className="ob-store-mini">
          <div className="ob-store-mini-bar"><i/><i/><i/><span className="ob-store-mini-url">{STORE_DOMAIN.replace('.myshopify','')}</span></div>
          <div className="ob-store-mini-body">
            <div className="ob-smb-line" style={{width:'40%'}}/><div className="ob-smb-line" style={{width:'85%',height:38}}/><div className="ob-smb-line" style={{width:'70%'}}/><div className="ob-smb-line" style={{width:'55%'}}/>
          </div>
          <div className="ob-store-dim2">
            <div className="ob-mini-popup">
              <div className="ob-mini-popup-img" />
              <div className="ob-mini-popup-c">
                <div className="ob-mini-popup-h">Join the club — 10% off</div>
                <div className="ob-mini-popup-p">Get first access to drops and members-only deals, straight to your inbox.</div>
                <div className="ob-mini-popup-input" />
                <div className="ob-mini-popup-btn">Count me in</div>
              </div>
            </div>
          </div>
        </div>
        <div className="ob-popup-side">
          <h4>Welcome popup</h4>
          <p>Email capture · shows after 5s to new visitors · mobile-optimized. Editorial template, matched to your brand.</p>
          <div className="ob-panel-actions" style={{marginTop:0}}>
            <ActionButton label="Publish popup" busyLabel="Publishing…" ms={1100} icon={<Icons.Megaphone size={15} />} onDone={onComplete} />
          </div>
        </div>
      </div>
    </div>
  );
}

const FLOW_OPTS = [
  { id: 'cart', icon: 'Cart', title: 'Cart recovery', desc: 'Win back shoppers who leave items behind — a 3-email sequence with a nudge and an offer.', stat: 'Recovers ~12% of abandoned carts' },
  { id: 'welcome', icon: 'Heart', title: 'Welcome series', desc: 'Greet new subscribers, tell your story, and turn the first-purchase intent into a sale.', stat: '↑ First-order conversion' },
];

function FlowPanel({ onComplete }) {
  const [sel, setSel] = useS('cart');
  return (
    <div className="ob-panel-pad">
      <p className="ob-panel-lede">Turn on your first automation. Pick a starting point — it launches pre-built with proven copy and timing, and you can tweak every step in the flow builder afterward.</p>
      <div className="ob-flow-grid">
        {FLOW_OPTS.map(o => {
          const Ic = Icons[o.icon];
          return (
            <button key={o.id} className={`ob-flow-opt ${sel === o.id ? 'sel' : ''}`} onClick={() => setSel(o.id)}>
              <span className="ob-radio" />
              <div className="ob-flow-opt-ic"><Ic size={18} /></div>
              <div className="ob-flow-opt-title">{o.title}</div>
              <div className="ob-flow-opt-desc">{o.desc}</div>
              <div className="ob-flow-opt-stat"><Icons.Bolt size={12} /> {o.stat}</div>
            </button>
          );
        })}
      </div>
      <div className="ob-panel-actions">
        <ActionButton label="Turn on flow" busyLabel="Activating flow…" ms={1200} icon={<Icons.Play size={14} />} onDone={onComplete} />
      </div>
    </div>
  );
}

function CallPanel({ onComplete, onSkip }) {
  const [booked, setBooked] = useS(false);
  return (
    <div className="ob-panel-pad">
      <p className="ob-panel-lede">Optional, but worth it. A 20-minute call with an onboarding specialist to review your flows, deliverability, and a 30-day plan tailored to {STORE}.</p>
      <div className="ob-call-card">
        <div className="ob-call-ic"><Icons.Clock size={22} /></div>
        <div className="ob-call-info">
          <h4>{booked ? "You're booked — check your inbox" : "Book a free onboarding call"}</h4>
          <p>{booked ? "A calendar invite and prep notes are on the way." : "1-on-1 walkthrough · 20 min · no cost"}</p>
        </div>
        {booked && <span className="ob-store-badge"><Icons.Check size={13} /> Scheduled</span>}
      </div>
      <div className="ob-panel-actions">
        {!booked ? (
          <>
            <ActionButton label="Pick a time" busyLabel="Opening calendar…" ms={900} onDone={() => setBooked(true)} />
            <button className="ob-skip-btn" onClick={onSkip}>Skip for now</button>
          </>
        ) : (
          <button className="btn btn-primary" onClick={onComplete}>Done</button>
        )}
      </div>
    </div>
  );
}

// ── Task registry ──────────────────────────────────────────────────────
const TASKS = [
  { id: 'store',  title: 'Connect your store',        sub: 'Confirm Retainify is on the right shop',         time: '30 sec', optional: false, Panel: StorePanel },
  { id: 'sender', title: 'Set your sender details',    sub: 'The “From” name & address in every email',       time: '1 min',  optional: false, Panel: SenderPanel },
  { id: 'embed',  title: 'Enable the on-site popup',   sub: 'Turn on the Retainify embed in your theme',      time: '1 min',  optional: false, Panel: EmbedPanel },
  { id: 'popup',  title: 'Publish your first popup',   sub: 'Start collecting emails from new visitors',       time: '1 min',  optional: false, Panel: PopupPanel },
  { id: 'flow',   title: 'Launch your first flow',     sub: 'Cart recovery or a welcome series',              time: '2 min',  optional: false, Panel: FlowPanel },
  { id: 'call',   title: 'Book an onboarding call',    sub: 'Get a specialist to review your setup',          time: '20 min', optional: true,  Panel: CallPanel },
];
const REQUIRED_IDS = TASKS.filter(t => !t.optional).map(t => t.id);

// ── Welcome takeover ───────────────────────────────────────────────────
function Welcome({ onStart, onLater }) {
  return (
    <div className="ob-welcome">
      <div className="ob-welcome-inner">
        <span className="ob-eyebrow"><span className="ob-dot" /> Setup · about 5 minutes</span>
        <h1>Welcome, {OWNER}.<br/>Let's turn visitors into <em>repeat customers.</em></h1>
        <p className="ob-welcome-lede">A few quick steps and <b>{STORE}</b> will be recovering carts, capturing emails, and running automations on autopilot.</p>
        <div className="ob-preview-tasks">
          {TASKS.map((t, i) => (
            <div className="ob-preview-task" key={t.id}>
              <span className="ob-ptn">{i + 1}</span>
              <span>{t.title}</span>
              <span className="ob-pt-time">{t.time}</span>
            </div>
          ))}
        </div>
        <div className="ob-welcome-cta">
          <button className="btn btn-primary btn-lg" onClick={onStart}>Get started <Icons.Arrow size={16} /></button>
          <button className="ob-later" onClick={onLater}>I'll set up later</button>
        </div>
      </div>
    </div>
  );
}

// ── Progress ring (welcome-back header) ────────────────────────────────
function Ring({ done, total }) {
  const r = 26, c = 2 * Math.PI * r, pct = done / total;
  return (
    <div className="ob-progress-ring">
      <svg width="60" height="60">
        <circle cx="30" cy="30" r={r} fill="none" stroke="rgba(244,239,228,0.2)" strokeWidth="5" />
        <circle cx="30" cy="30" r={r} fill="none" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} style={{ transition: 'stroke-dashoffset 640ms var(--ease)' }} />
      </svg>
      <span className="ob-progress-ring-num">{done}/{total}</span>
    </div>
  );
}

// ── Checklist ──────────────────────────────────────────────────────────
function Checklist({ state, dispatch, onFinish }) {
  const { done, skipped, open } = state;
  const reqDone = REQUIRED_IDS.filter(id => done[id]).length;
  const reqTotal = REQUIRED_IDS.length;
  const allDone = done;
  const totalDone = Object.keys(done).filter(k => done[k]).length;
  const totalTasks = TASKS.length;
  const pct = Math.round((reqDone / reqTotal) * 100);
  const allRequiredDone = reqDone === reqTotal;

  return (
    <>
      <div className="ob-page">
        <div className="ob-header">
          <h1>Hey {OWNER} <span className="ob-wave">👋</span></h1>
          <p>Finish setting up {STORE} — do these in any order, your progress is saved.</p>
        </div>

        <div className="ob-progress-card">
          <div className="ob-progress-copy">
            <div className="ob-pc-title">{allRequiredDone ? "You're ready to go live" : "Never lose another visitor"}</div>
            <div className="ob-pc-sub">{allRequiredDone ? "All essentials done — activate whenever you're ready." : `${reqTotal - reqDone} essential ${reqTotal - reqDone === 1 ? 'step' : 'steps'} left to launch`}</div>
          </div>
          <div className="ob-progress-bar-wrap">
            <div className="ob-progress-bar-top">
              <span className="ob-pb-count">{reqDone} of {reqTotal} essentials</span>
              <span className="ob-pb-pct">{pct}%</span>
            </div>
            <div className="ob-progress-track"><div className="ob-progress-fill" style={{ width: `${pct}%` }} /></div>
          </div>
          <Ring done={reqDone} total={reqTotal} />
        </div>

        <div className="ob-tasks">
          {TASKS.map((t, i) => {
            const isDone = !!done[t.id];
            const isSkipped = !!skipped[t.id];
            const isOpen = open === t.id;
            const Panel = t.Panel;
            return (
              <div key={t.id} className={`ob-task ${isOpen ? 'is-open' : ''} ${isDone ? 'is-done' : ''}`} style={{ animationDelay: `${i * 55}ms` }}>
                <button className="ob-task-head" onClick={() => dispatch({ type: 'toggle', id: t.id })}>
                  <span className="ob-task-num">{isDone ? <Icons.Check size={16} className="ob-check-anim" /> : (i + 1)}</span>
                  <div className="ob-task-body-head">
                    <div className="ob-task-title">{t.title}</div>
                    <div className="ob-task-sub">{isSkipped && !isDone ? 'Skipped — you can do this anytime' : t.sub}</div>
                  </div>
                  <div className="ob-task-meta">
                    {isDone ? <span className="ob-done-word"><Icons.Check size={13} /> Done</span> : (
                      <>
                        {t.optional && <span className="ob-optional-tag">Optional</span>}
                        <span className="ob-time-tag"><Icons.Clock size={13} /> {t.time}</span>
                        <span className="ob-chev"><Icons.Chevron size={16} /></span>
                      </>
                    )}
                  </div>
                </button>
                <div className="ob-task-panel"><div className="ob-task-panel-inner">
                  <Panel
                    onComplete={() => dispatch({ type: 'complete', id: t.id })}
                    onSkip={() => dispatch({ type: 'skip', id: t.id })}
                  />
                </div></div>
              </div>
            );
          })}
        </div>

        <div className="ob-panel-actions" style={{ justifyContent: 'center', marginTop: 30 }}>
          <button className="btn btn-primary btn-lg" disabled={!allRequiredDone} onClick={onFinish} style={!allRequiredDone ? { opacity: 0.45, cursor: 'not-allowed' } : {}}>
            {allRequiredDone ? <>Activate Retainify <Icons.Sparkles size={16} /></> : `Complete ${reqTotal - reqDone} more to activate`}
          </button>
        </div>

        <div className="ob-foot">Stuck on a step? <a href="#">Read the setup guide</a> or <a href="#">chat with support</a>.</div>
      </div>
    </>
  );
}

// ── Live celebration ───────────────────────────────────────────────────
function Confetti() {
  const colors = ['#E8F25A', '#1F3D2F', '#356A53', '#C0B697', '#DCE7DF'];
  const pieces = Array.from({ length: 70 }).map((_, i) => ({
    left: Math.random() * 100,
    delay: Math.random() * 0.6,
    dur: 2.6 + Math.random() * 1.8,
    color: colors[i % colors.length],
    rot: Math.random() * 360,
    w: 6 + Math.random() * 6,
  }));
  return (
    <div className="ob-confetti">
      {pieces.map((p, i) => (
        <span key={i} className="ob-conf" style={{ left: `${p.left}%`, background: p.color, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`, width: p.w, height: p.w * 1.5, transform: `rotate(${p.rot}deg)` }} />
      ))}
    </div>
  );
}

function Live({ onDashboard, skippedCall }) {
  return (
    <div className="ob-live">
      <Confetti />
      <div className="ob-live-inner">
        <div className="ob-live-badge"><Icons.Sparkles size={44} /></div>
        <h1>Retainify is live.</h1>
        <p className="ob-live-lede">{STORE} is now capturing emails and recovering carts automatically. Here's what's running for you right now:</p>
        <div className="ob-live-stats">
          <div className="ob-live-stat"><div className="ob-ls-num">1</div><div className="ob-ls-lbl">popup capturing<br/>emails</div></div>
          <div className="ob-live-stat"><div className="ob-ls-num">1</div><div className="ob-ls-lbl">flow running<br/>on autopilot</div></div>
          <div className="ob-live-stat"><div className="ob-ls-num">24/7</div><div className="ob-ls-lbl">watching every<br/>visitor</div></div>
        </div>
        <div className="ob-live-cta">
          <button className="btn btn-primary btn-lg" onClick={onDashboard}>Go to dashboard <Icons.Arrow size={16} /></button>
          <button className="btn btn-secondary btn-lg" onClick={onDashboard}>Build another flow</button>
        </div>
      </div>
    </div>
  );
}

// ── Top bar ────────────────────────────────────────────────────────────
function TopBar() {
  return (
    <div className="ob-top">
      <div className="ob-brand"><span className="ob-mark">R</span><span className="ob-brand-name">Retainify</span></div>
      <div className="ob-top-right">
        <a className="ob-help-link" href="#">Help</a>
        <div className="ob-store-chip"><span className="ob-store-dot">N</span> {STORE}</div>
      </div>
    </div>
  );
}

// ── Root ───────────────────────────────────────────────────────────────
function reducer(state, action) {
  switch (action.type) {
    case 'toggle':
      return { ...state, open: state.open === action.id ? null : action.id };
    case 'complete': {
      const done = { ...state.done, [action.id]: true };
      const skipped = { ...state.skipped }; delete skipped[action.id];
      // auto-advance to next incomplete task
      const next = TASKS.find(t => !done[t.id] && !skipped[t.id]);
      return { ...state, done, skipped, open: next ? next.id : null };
    }
    case 'skip': {
      const skipped = { ...state.skipped, [action.id]: true };
      const next = TASKS.find(t => !state.done[t.id] && !skipped[t.id] && t.id !== action.id);
      return { ...state, skipped, open: next ? next.id : null };
    }
    default: return state;
  }
}

function OnboardingApp() {
  const [phase, setPhase] = useS('welcome'); // welcome | checklist | live
  const [state, dispatch] = React.useReducer(reducer, { done: {}, skipped: {}, open: 'store' });

  useE(() => { window.scrollTo(0, 0); }, [phase]);

  return (
    <div className="ob-root">
      <div className="ob-noise" />
      <TopBar />
      {phase === 'welcome' && <Welcome onStart={() => setPhase('checklist')} onLater={() => setPhase('checklist')} />}
      {phase === 'checklist' && <Checklist state={state} dispatch={dispatch} onFinish={() => setPhase('live')} />}
      {phase === 'live' && <Live onDashboard={() => setPhase('welcome')} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('app')).render(<OnboardingApp />);
