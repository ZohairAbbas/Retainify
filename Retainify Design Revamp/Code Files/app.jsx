// Retainify — Main App
// Manages screens, flows state, and modal visibility.

const { useState: useStateApp, useEffect: useEffectApp } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "density": "comfortable",
  "showEmpty": false,
  "accentMode": "subtle"
}/*EDITMODE-END*/;

function App() {
  const [flows, setFlows] = useStateApp(() => {
    // Add a branching example into the first one for canvas demo
    const f = JSON.parse(JSON.stringify(window.RetainifyData.FLOWS));
    return f;
  });
  const [screen, setScreen] = useStateApp('list'); // 'list' | 'builder'
  const [activeFlowId, setActiveFlowId] = useStateApp(null);
  const [showCreate, setShowCreate] = useStateApp(false);
  const [navActive, setNavActive] = useStateApp('flows');
  const [tweaks, setTweaks] = useStateApp(() => ({ ...TWEAK_DEFAULTS }));
  const [tweaksOpen, setTweaksOpen] = useStateApp(false);

  // Edit mode protocol
  useEffectApp(() => {
    const handler = (e) => {
      if (e.data && e.data.type === '__activate_edit_mode') setTweaksOpen(true);
      if (e.data && e.data.type === '__deactivate_edit_mode') setTweaksOpen(false);
    };
    window.addEventListener('message', handler);
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    return () => window.removeEventListener('message', handler);
  }, []);

  const setTweak = (key, value) => {
    setTweaks(t => {
      const next = { ...t, [key]: value };
      window.parent.postMessage({ type: '__edit_mode_set_keys', edits: { [key]: value }}, '*');
      return next;
    });
  };

  const closeTweaks = () => {
    setTweaksOpen(false);
    window.parent.postMessage({ type: '__edit_mode_dismissed' }, '*');
  };

  // Apply density to root
  useEffectApp(() => {
    document.documentElement.dataset.density = tweaks.density || 'comfortable';
    document.documentElement.dataset.accent = tweaks.accentMode || 'subtle';
  }, [tweaks]);

  const activeFlow = flows.find(f => f.id === activeFlowId);

  const handleCreatePick = (templateId) => {
    setShowCreate(false);
    const { TEMPLATES } = window.RetainifyData;
    let nodes;
    let trigger = 'customer_created';
    let name = 'Untitled flow';
    if (templateId) {
      const t = TEMPLATES.find(x => x.id === templateId);
      nodes = JSON.parse(JSON.stringify(t.nodes));
      trigger = t.trigger;
      name = t.name + ' (copy)';
    } else {
      nodes = [];
    }
    // Add trigger + exit wrappers
    const triggerNode = { id: 'trig', type: 'trigger', trigger, frequency: 'none' };
    const exitNode = { id: 'exit', type: 'exit' };
    const newFlow = {
      id: 'f_' + Math.random().toString(36).slice(2, 7),
      name,
      status: 'draft',
      trigger,
      updated: 'just now',
      sent: null, openRate: null, clickRate: null,
      nodes: [triggerNode, ...nodes, exitNode],
    };
    setFlows([newFlow, ...flows]);
    setActiveFlowId(newFlow.id);
    setScreen('builder');
  };

  const handleOpenFlow = (id) => {
    // Wrap nodes with trigger + exit if not already
    setFlows(prev => prev.map(f => {
      if (f.id !== id) return f;
      if (f.nodes[0]?.type !== 'trigger') {
        const triggerNode = { id: 'trig', type: 'trigger', trigger: f.trigger, frequency: 'none' };
        const exitNode = { id: 'exit', type: 'exit' };
        // Inject a split into the first one for demo
        let body = f.nodes;
        if (f.id === 'f1') {
          body = [
            ...body.slice(0, 3),
            {
              id: 'split1', type: 'split', condition: 'opened "Welcome to the family"', label: 'Engaged?',
              branches: [
                [{ id: 's1', type: 'email', name: 'Send thank-you', subject: 'Thanks for reading', after: 24, afterUnit: 'hours', discount: 0, style: 'Classic', enabled: true }],
                [{ id: 's2', type: 'delay', hours: 48, unit: 'hours' }, { id: 's3', type: 'email', name: 'Re-engage', subject: 'In case you missed it', after: 48, afterUnit: 'hours', discount: 5, style: 'Classic', enabled: true }],
              ],
            },
            ...body.slice(3),
          ];
        }
        return { ...f, nodes: [triggerNode, ...body, exitNode] };
      }
      return f;
    }));
    setActiveFlowId(id);
    setScreen('builder');
  };

  const handleUpdate = (updated) => {
    setFlows(prev => prev.map(f => f.id === updated.id ? { ...updated, updated: 'just now' } : f));
  };

  // Coming soon for non-flow nav clicks
  const handleNav = (id) => {
    setNavActive(id);
    if (id === 'flows') { setScreen('list'); }
    else { setScreen('list'); /* would route to other screens — out of scope */ }
  };

  // ── Render ──
  if (screen === 'builder' && activeFlow) {
    return (
      <>
        <Builder flow={activeFlow} onBack={() => setScreen('list')} onUpdate={handleUpdate} />
        {tweaksOpen && <TweaksPanel tweaks={tweaks} setTweak={setTweak} onClose={closeTweaks} />}
      </>
    );
  }

  const showEmpty = tweaks.showEmpty;

  return (
    <>
      <ShopifyAppShell active={navActive} onNav={handleNav}>
        {navActive === 'flows' ? (
          <FlowsList
            flows={flows}
            onCreate={() => setShowCreate(true)}
            onOpenFlow={handleOpenFlow}
            showEmpty={showEmpty}
          />
        ) : (
          <FlowsList flows={flows} onCreate={() => setShowCreate(true)} onOpenFlow={handleOpenFlow} showEmpty={false} />
        )}
      </ShopifyAppShell>
      <CreateFlowModal open={showCreate} onClose={() => setShowCreate(false)} onPick={handleCreatePick} />
      {tweaksOpen && <TweaksPanel tweaks={tweaks} setTweak={setTweak} onClose={closeTweaks} />}
    </>
  );
}

// ── Tweaks Panel ──
function TweaksPanel({ tweaks, setTweak, onClose }) {
  return (
    <div className="rt-tweaks">
      <div className="rt-tweaks-head">
        <span className="t-micro">Tweaks</span>
        <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close"><Icons.Close size={14} /></button>
      </div>
      <div className="rt-tweaks-body">
        <div className="rt-tweak">
          <div className="t-small" style={{ fontWeight: 500, marginBottom: 8 }}>Density</div>
          <div className="rt-segmented">
            {['cozy', 'comfortable', 'spacious'].map(d => (
              <button key={d} className={tweaks.density === d ? 'rt-seg-on' : ''} onClick={() => setTweak('density', d)} style={{ textTransform: 'capitalize' }}>{d}</button>
            ))}
          </div>
        </div>
        <div className="rt-tweak">
          <div className="t-small" style={{ fontWeight: 500, marginBottom: 8 }}>Accent intensity</div>
          <div className="rt-segmented">
            {[['subtle', 'Subtle'], ['bold', 'Bold']].map(([k, l]) => (
              <button key={k} className={tweaks.accentMode === k ? 'rt-seg-on' : ''} onClick={() => setTweak('accentMode', k)}>{l}</button>
            ))}
          </div>
        </div>
        <div className="rt-tweak">
          <label className="rt-toggle">
            <input type="checkbox" checked={tweaks.showEmpty} onChange={e => setTweak('showEmpty', e.target.checked)} />
            <span className="rt-toggle-switch" />
            <span>Show empty state (Flows list)</span>
          </label>
        </div>
        <div className="rt-tweaks-foot">
          <a href="Design System.html" className="btn btn-secondary btn-sm" style={{ width: '100%', justifyContent: 'center' }}>
            Open Design System →
          </a>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('app')).render(<App />);
