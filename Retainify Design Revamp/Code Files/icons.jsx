// Retainify — Icon set
// Lucide-style line icons, 1.5px stroke. All inherit currentColor.

const I = ({ children, size = 18, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...rest}>{children}</svg>
);

const Icons = {
  Home: (p) => <I {...p}><path d="M5 9l7-5 7 5v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9z"/><path d="M9 21V13h6v8"/></I>,
  Flow: (p) => <I {...p}><circle cx="5" cy="6" r="2"/><circle cx="19" cy="18" r="2"/><circle cx="12" cy="12" r="2"/><path d="M7 6h3M14 12h3M14 18h3"/><path d="M12 14v2M12 8v2"/></I>,
  Mail: (p) => <I {...p}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 8l9 6 9-6"/></I>,
  Users: (p) => <I {...p}><circle cx="9" cy="8" r="3.5"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14h.5a5 5 0 0 1 5 5"/></I>,
  Ticket: (p) => <I {...p}><path d="M3 9a2 2 0 0 0 0 4v3a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3a2 2 0 0 0 0-4V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v3z"/><path d="M9 6v2M9 11v2M9 16v2"/></I>,
  Chart: (p) => <I {...p}><path d="M3 21h18M6 17V10M11 17V6M16 17v-5M21 17v-9"/></I>,
  Settings: (p) => <I {...p}><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14 3h-4l-.6 2.6a7 7 0 0 0-2 1.2L5.1 6 3.1 9.4l2 1.4a7 7 0 0 0 0 2.4l-2 1.4 2 3.4 2.3-.9a7 7 0 0 0 2 1.2L10 21h4l.6-2.7a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.4c.1-.4.1-.8.1-1.2z"/></I>,
  Plus: (p) => <I {...p}><path d="M12 5v14M5 12h14"/></I>,
  Close: (p) => <I {...p}><path d="M6 6l12 12M18 6L6 18"/></I>,
  Chevron: (p) => <I {...p}><path d="m9 6 6 6-6 6"/></I>,
  ChevronDown: (p) => <I {...p}><path d="m6 9 6 6 6-6"/></I>,
  Arrow: (p) => <I {...p}><path d="M5 12h14M13 6l6 6-6 6"/></I>,
  ArrowBack: (p) => <I {...p}><path d="M19 12H5M11 18l-6-6 6-6"/></I>,
  Search: (p) => <I {...p}><circle cx="11" cy="11" r="7"/><path d="m21 21-5-5"/></I>,
  More: (p) => <I {...p}><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></I>,
  Copy: (p) => <I {...p}><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></I>,
  Trash: (p) => <I {...p}><path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/></I>,
  Eye: (p) => <I {...p}><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></I>,
  EyeOff: (p) => <I {...p}><path d="M3 3l18 18M10.6 6.1A9 9 0 0 1 12 6c7 0 11 6 11 6a14 14 0 0 1-2.4 2.9M6.6 6.6A14 14 0 0 0 1 12s4 6 11 6c1.5 0 2.9-.3 4.2-.8"/><path d="M9.5 9.5a3 3 0 0 0 4 4"/></I>,
  Clock: (p) => <I {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></I>,
  Lock: (p) => <I {...p}><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></I>,
  Bolt: (p) => <I {...p}><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/></I>,
  Sparkles: (p) => <I {...p}><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/><path d="M19 14l.7 2.1L22 17l-2.3.9L19 20l-.7-2.1L16 17l2.3-.9z"/></I>,
  Cart: (p) => <I {...p}><path d="M3 4h2l2 12h12l2-8H7"/><circle cx="9" cy="20" r="1.5"/><circle cx="17" cy="20" r="1.5"/></I>,
  Heart: (p) => <I {...p}><path d="M12 20s-7-4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 6-7 10-7 10z"/></I>,
  Refresh: (p) => <I {...p}><path d="M21 12a9 9 0 0 1-15.4 6.4L3 16M3 12a9 9 0 0 1 15.4-6.4L21 8M3 21v-5h5M21 3v5h-5"/></I>,
  Sms: (p) => <I {...p}><path d="M21 12c0 4.4-4 8-9 8-1.4 0-2.8-.3-4-.8L3 21l1.3-4.3A7.7 7.7 0 0 1 3 12c0-4.4 4-8 9-8s9 3.6 9 8z"/></I>,
  Split: (p) => <I {...p}><path d="M6 3v6c0 2 1 4 3 5l3 1 3-1c2-1 3-3 3-5V3"/><path d="M12 15v6M9 21h6"/></I>,
  Tag: (p) => <I {...p}><path d="M20.6 13.6 13.6 20.6a2 2 0 0 1-2.8 0L3 12.8V3h9.8l7.8 7.8a2 2 0 0 1 0 2.8z"/><circle cx="8.5" cy="8.5" r="1.5"/></I>,
  Exit: (p) => <I {...p}><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l5-5-5-5M15 12H3"/></I>,
  Trigger: (p) => <I {...p}><path d="M14 3v6h5l-9 12v-6H5l9-12z"/></I>,
  Play: (p) => <I {...p}><path d="M6 4l14 8-14 8z"/></I>,
  Pause: (p) => <I {...p}><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></I>,
  Drag: (p) => <I {...p}><circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/></I>,
  Help: (p) => <I {...p}><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 3.5"/><circle cx="12" cy="16.5" r="0.5" fill="currentColor"/></I>,
  Bell: (p) => <I {...p}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9z"/><path d="M10 21a2 2 0 0 0 4 0"/></I>,
  Tab: (p) => <I {...p}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/></I>,
  List: (p) => <I {...p}><path d="M3 6h18M3 12h18M3 18h12"/></I>,
  Sliders: (p) => <I {...p}><path d="M4 21V14M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"/><circle cx="4" cy="12" r="2"/><circle cx="12" cy="10" r="2"/><circle cx="20" cy="14" r="2"/></I>,
};

window.Icons = Icons;
