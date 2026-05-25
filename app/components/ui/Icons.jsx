// Retainify — Icon set (ES module)
// Lucide-style line icons, 1.5px stroke. All inherit currentColor.

const I = ({ children, size = 18, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...rest}>{children}</svg>
);

export const IconHome = (p) => <I {...p}><path d="M5 9l7-5 7 5v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9z"/><path d="M9 21V13h6v8"/></I>;
export const IconFlow = (p) => <I {...p}><circle cx="5" cy="6" r="2"/><circle cx="19" cy="18" r="2"/><circle cx="12" cy="12" r="2"/><path d="M7 6h3M14 12h3M14 18h3"/><path d="M12 14v2M12 8v2"/></I>;
export const IconMail = (p) => <I {...p}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 8l9 6 9-6"/></I>;
export const IconUsers = (p) => <I {...p}><circle cx="9" cy="8" r="3.5"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14h.5a5 5 0 0 1 5 5"/></I>;
export const IconTicket = (p) => <I {...p}><path d="M3 9a2 2 0 0 0 0 4v3a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3a2 2 0 0 0 0-4V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v3z"/><path d="M9 6v2M9 11v2M9 16v2"/></I>;
export const IconChart = (p) => <I {...p}><path d="M3 21h18M6 17V10M11 17V6M16 17v-5M21 17v-9"/></I>;
export const IconSettings = (p) => <I {...p}><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14 3h-4l-.6 2.6a7 7 0 0 0-2 1.2L5.1 6 3.1 9.4l2 1.4a7 7 0 0 0 0 2.4l-2 1.4 2 3.4 2.3-.9a7 7 0 0 0 2 1.2L10 21h4l.6-2.7a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.4c.1-.4.1-.8.1-1.2z"/></I>;
export const IconPlus = (p) => <I {...p}><path d="M12 5v14M5 12h14"/></I>;
export const IconClose = (p) => <I {...p}><path d="M6 6l12 12M18 6L6 18"/></I>;
export const IconChevron = (p) => <I {...p}><path d="m9 6 6 6-6 6"/></I>;
export const IconChevronDown = (p) => <I {...p}><path d="m6 9 6 6 6-6"/></I>;
export const IconArrow = (p) => <I {...p}><path d="M5 12h14M13 6l6 6-6 6"/></I>;
export const IconArrowBack = (p) => <I {...p}><path d="M19 12H5M11 18l-6-6 6-6"/></I>;
export const IconSearch = (p) => <I {...p}><circle cx="11" cy="11" r="7"/><path d="m21 21-5-5"/></I>;
export const IconMore = (p) => <I {...p}><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></I>;
export const IconCopy = (p) => <I {...p}><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></I>;
export const IconTrash = (p) => <I {...p}><path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/></I>;
export const IconEye = (p) => <I {...p}><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></I>;
export const IconEyeOff = (p) => <I {...p}><path d="M3 3l18 18M10.6 6.1A9 9 0 0 1 12 6c7 0 11 6 11 6a14 14 0 0 1-2.4 2.9M6.6 6.6A14 14 0 0 0 1 12s4 6 11 6c1.5 0 2.9-.3 4.2-.8"/><path d="M9.5 9.5a3 3 0 0 0 4 4"/></I>;
export const IconClock = (p) => <I {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></I>;
export const IconLock = (p) => <I {...p}><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></I>;
export const IconBolt = (p) => <I {...p}><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/></I>;
export const IconSparkles = (p) => <I {...p}><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/><path d="M19 14l.7 2.1L22 17l-2.3.9L19 20l-.7-2.1L16 17l2.3-.9z"/></I>;
export const IconCart = (p) => <I {...p}><path d="M3 4h2l2 12h12l2-8H7"/><circle cx="9" cy="20" r="1.5"/><circle cx="17" cy="20" r="1.5"/></I>;
export const IconHeart = (p) => <I {...p}><path d="M12 20s-7-4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 6-7 10-7 10z"/></I>;
export const IconRefresh = (p) => <I {...p}><path d="M21 12a9 9 0 0 1-15.4 6.4L3 16M3 12a9 9 0 0 1 15.4-6.4L21 8M3 21v-5h5M21 3v5h-5"/></I>;
export const IconSms = (p) => <I {...p}><path d="M21 12c0 4.4-4 8-9 8-1.4 0-2.8-.3-4-.8L3 21l1.3-4.3A7.7 7.7 0 0 1 3 12c0-4.4 4-8 9-8s9 3.6 9 8z"/></I>;
export const IconSplit = (p) => <I {...p}><path d="M6 3v6c0 2 1 4 3 5l3 1 3-1c2-1 3-3 3-5V3"/><path d="M12 15v6M9 21h6"/></I>;
export const IconTag = (p) => <I {...p}><path d="M20.6 13.6 13.6 20.6a2 2 0 0 1-2.8 0L3 12.8V3h9.8l7.8 7.8a2 2 0 0 1 0 2.8z"/><circle cx="8.5" cy="8.5" r="1.5"/></I>;
export const IconExit = (p) => <I {...p}><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l5-5-5-5M15 12H3"/></I>;
export const IconTrigger = (p) => <I {...p}><path d="M14 3v6h5l-9 12v-6H5l9-12z"/></I>;
export const IconPlay = (p) => <I {...p}><path d="M6 4l14 8-14 8z"/></I>;
export const IconPause = (p) => <I {...p}><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></I>;
export const IconDrag = (p) => <I {...p}><circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/></I>;
export const IconHelp = (p) => <I {...p}><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 3.5"/><circle cx="12" cy="16.5" r="0.5" fill="currentColor"/></I>;
export const IconBell = (p) => <I {...p}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9z"/><path d="M10 21a2 2 0 0 0 4 0"/></I>;
export const IconTab = (p) => <I {...p}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/></I>;
export const IconList = (p) => <I {...p}><path d="M3 6h18M3 12h18M3 18h12"/></I>;
export const IconSliders = (p) => <I {...p}><path d="M4 21V14M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"/><circle cx="4" cy="12" r="2"/><circle cx="12" cy="10" r="2"/><circle cx="20" cy="14" r="2"/></I>;
export const IconBold = (p) => <I {...p}><path d="M7 4h6a3.5 3.5 0 0 1 0 7H7zM7 11h7a3.5 3.5 0 0 1 0 7H7z"/></I>;
export const IconItalic = (p) => <I {...p}><path d="M10 4h8M6 20h8M14 4l-4 16"/></I>;
export const IconUnderline = (p) => <I {...p}><path d="M7 4v8a5 5 0 0 0 10 0V4M5 20h14"/></I>;
export const IconLinkIcon = (p) => <I {...p}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 1 0-5.7-5.7L11 7"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 1 0 5.7 5.7L13 17"/></I>;
export const IconHeading1 = (p) => <I {...p}><path d="M4 6v12M12 6v12M4 12h8M16 9l3-1v10"/></I>;
export const IconHeading2 = (p) => <I {...p}><path d="M4 6v12M12 6v12M4 12h8M16 9a2 2 0 1 1 4 0c0 1.5-4 4-4 8h4"/></I>;
export const IconType = (p) => <I {...p}><path d="M4 7V5h16v2M9 5v14M15 19h-6"/></I>;
export const IconImage = (p) => <I {...p}><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m3 18 5-5 4 4 3-3 6 6"/></I>;
export const IconButton = (p) => <I {...p}><rect x="3" y="8" width="18" height="8" rx="4"/><path d="M8 12h8"/></I>;
export const IconDivider = (p) => <I {...p}><path d="M3 12h18M3 6h4M17 6h4M3 18h4M17 18h4"/></I>;
export const IconSpacer = (p) => <I {...p}><path d="M4 5h16M4 19h16M12 8v8M9 11l3-3 3 3M9 16l3 3 3-3"/></I>;
export const IconProductGrid = (p) => <I {...p}><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></I>;
export const IconFooter = (p) => <I {...p}><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 14h18M7 17h2M11 17h6"/></I>;
export const IconLogo = (p) => <I {...p}><circle cx="12" cy="12" r="9"/><path d="M8 12h8M12 8v8"/></I>;
export const IconDiscount = (p) => <I {...p}><path d="M20 13.4 13.4 20a2 2 0 0 1-2.8 0L3 12.4V4h8.4l7.6 7.6c.8.7.8 1.9 0 2.6z"/><circle cx="8" cy="8" r="1" fill="currentColor"/><path d="m9 14 5-5"/></I>;
export const IconPhone = (p) => <I {...p}><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 19h2"/></I>;
export const IconDesktop = (p) => <I {...p}><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></I>;
export const IconSend = (p) => <I {...p}><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/></I>;
export const IconArrowUp = (p) => <I {...p}><path d="M12 19V5M5 12l7-7 7 7"/></I>;
export const IconArrowDown = (p) => <I {...p}><path d="M12 5v14M5 12l7 7 7-7"/></I>;
export const IconAlignLeft = (p) => <I {...p}><path d="M3 6h18M3 12h12M3 18h18"/></I>;
export const IconAlignCenter = (p) => <I {...p}><path d="M3 6h18M6 12h12M3 18h18"/></I>;
export const IconAlignRight = (p) => <I {...p}><path d="M3 6h18M9 12h12M3 18h18"/></I>;
export const IconCheck = (p) => <I {...p}><path d="M5 12l5 5L20 7"/></I>;
export const IconMegaphone = (p) => <I {...p}><path d="M3 11v2a2 2 0 0 0 2 2h1l3 5h2v-4l9 3V5l-9 3H6a3 3 0 0 0-3 3z"/></I>;

const Icons = {
  Home: IconHome,
  Flow: IconFlow,
  Mail: IconMail,
  Users: IconUsers,
  Ticket: IconTicket,
  Chart: IconChart,
  Settings: IconSettings,
  Plus: IconPlus,
  Close: IconClose,
  Chevron: IconChevron,
  ChevronDown: IconChevronDown,
  Arrow: IconArrow,
  ArrowBack: IconArrowBack,
  Search: IconSearch,
  More: IconMore,
  Copy: IconCopy,
  Trash: IconTrash,
  Eye: IconEye,
  EyeOff: IconEyeOff,
  Clock: IconClock,
  Lock: IconLock,
  Bolt: IconBolt,
  Sparkles: IconSparkles,
  Cart: IconCart,
  Heart: IconHeart,
  Refresh: IconRefresh,
  Sms: IconSms,
  Split: IconSplit,
  Tag: IconTag,
  Exit: IconExit,
  Trigger: IconTrigger,
  Play: IconPlay,
  Pause: IconPause,
  Drag: IconDrag,
  Help: IconHelp,
  Bell: IconBell,
  Tab: IconTab,
  List: IconList,
  Sliders: IconSliders,
  Bold: IconBold,
  Italic: IconItalic,
  Underline: IconUnderline,
  LinkIcon: IconLinkIcon,
  Heading1: IconHeading1,
  Heading2: IconHeading2,
  Type: IconType,
  Image: IconImage,
  Button: IconButton,
  Divider: IconDivider,
  Spacer: IconSpacer,
  ProductGrid: IconProductGrid,
  Footer: IconFooter,
  Logo: IconLogo,
  Discount: IconDiscount,
  Phone: IconPhone,
  Desktop: IconDesktop,
  Send: IconSend,
  ArrowUp: IconArrowUp,
  ArrowDown: IconArrowDown,
  AlignLeft: IconAlignLeft,
  AlignCenter: IconAlignCenter,
  AlignRight: IconAlignRight,
  Check: IconCheck,
  Megaphone: IconMegaphone,
};

export default Icons;
