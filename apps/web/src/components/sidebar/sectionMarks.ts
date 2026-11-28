import { AlarmClockIcon, CheckIcon, LoaderIcon } from "lucide-react";

/** 受信箱より下の区分の見分け方。行のアイコンと見出しの線で色をそろえる。 */
export const SIDEBAR_SECTION_MARKS = {
  working: { icon: LoaderIcon, color: "info", iconClassName: "text-info" },
  snoozed: { icon: AlarmClockIcon, color: "warning", iconClassName: "text-warning" },
  settled: { icon: CheckIcon, color: "success", iconClassName: "text-success" },
} as const;

export type SidebarMarkedSection = keyof typeof SIDEBAR_SECTION_MARKS;
