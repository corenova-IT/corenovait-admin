import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function make(paths: React.ReactNode) {
  return function Icon({ size = 18, ...props }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        {...props}
      >
        {paths}
      </svg>
    );
  };
}

export const IconOverview = make(<><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>);
export const IconDollar = make(<><path d="M12 2.5v19" /><path d="M16.5 6.5c-.7-1.3-2.4-2-4.5-2-2.6 0-4.5 1.4-4.5 3.5s1.9 3 4.5 3.5 4.5 1.4 4.5 3.5-1.9 3.5-4.5 3.5c-2.2 0-4-.8-4.8-2.3" /></>);
export const IconTrend = make(<><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></>);
export const IconReceipt = make(<><path d="M6 2.5h12v19l-3-2-3 2-3-2-3 2z" /><path d="M9 7.5h6M9 11.5h6M9 15.5h3" /></>);
export const IconCard = make(<><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M2.5 10h19M6.5 15h3" /></>);
export const IconMegaphone = make(<><path d="M3 10.5v3a1 1 0 0 0 1 1h2l6 4.5v-14L6 9.5H4a1 1 0 0 0-1 1z" /><path d="M16 9a4 4 0 0 1 0 6" /></>);
export const IconCalendar = make(<><rect x="3.5" y="4.5" width="17" height="16" rx="2.5" /><path d="M3.5 9.5h17M8 2.5v4M16 2.5v4" /></>);
export const IconTasks = make(<><path d="M9 6.5h11M9 12h11M9 17.5h11" /><path d="M3.5 6.5l1.2 1.2L6.8 5.5M3.5 12l1.2 1.2 2.1-2.2M3.5 17.5l1.2 1.2 2.1-2.2" /></>);
export const IconChat = make(<path d="M4.5 4.5h15a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9.5l-5 4v-15a1 1 0 0 1 1-1z" />);
export const IconUsers = make(<><circle cx="9" cy="8.5" r="3.5" /><path d="M2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5" /><path d="M16 5.2a3.3 3.3 0 0 1 0 6.6M18 14.8c2 .8 3.2 2.6 3.5 5.2" /></>);
export const IconSettings = make(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>);
export const IconShield = make(<><path d="M12 2.5l8 3v6c0 4.8-3.3 8.6-8 10-4.7-1.4-8-5.2-8-10v-6z" /><path d="M9 12l2.2 2.2L15.5 10" /></>);
export const IconSearch = make(<><circle cx="11" cy="11" r="6.5" /><path d="M20.5 20.5l-4.9-4.9" /></>);
export const IconBell = make(<><path d="M6 9.5a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15.5 6 9.5" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0" /></>);
export const IconSun = make(<><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></>);
export const IconMoon = make(<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />);
export const IconChevronDown = make(<path d="M6 9l6 6 6-6" />);
export const IconChevronLeft = make(<path d="M15 6l-6 6 6 6" />);
export const IconChevronRight = make(<path d="M9 6l6 6-6 6" />);
export const IconX = make(<path d="M6 6l12 12M18 6L6 18" />);
export const IconPlus = make(<path d="M12 5v14M5 12h14" />);
export const IconCheck = make(<path d="M5 12.5l4.5 4.5L19 7.5" />);
export const IconLogout = make(<><path d="M15 4.5h3.5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H15" /><path d="M10 16.5L5.5 12 10 7.5M5.5 12H15" /></>);
export const IconLock = make(<><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></>);
export const IconMenu = make(<path d="M4 7h16M4 12h16M4 17h16" />);
export const IconMail = make(<><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M3.5 6.5l8.5 6.5 8.5-6.5" /></>);
export const IconAlert = make(<><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5h.01" /></>);
export const IconKey = make(<><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M17 6l2.5 2.5M14.5 8.5L17 11" /></>);
export const IconRefresh = make(<><path d="M20 11a8 8 0 0 0-14.5-4.5L4 8" /><path d="M4 3.5V8h4.5M4 13a8 8 0 0 0 14.5 4.5L20 16" /><path d="M20 20.5V16h-4.5" /></>);
export const IconDownload = make(<><path d="M12 3.5v12M7 10.5l5 5 5-5" /><path d="M4.5 19.5h15" /></>);
