import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ContextMenuSource } from "@t3tools/contracts";
import { EllipsisIcon } from "lucide-react";
import { type ReactNode, useLayoutEffect } from "react";
import { cn } from "~/lib/utils";
import { useClientSettings } from "../../hooks/useSettings";
import { contextMenuSourceOf, openContextMenuFromKeyboard } from "../../contextMenuSource";
import { Button } from "../ui/button";
import {
  animateSidebarLayoutChanges,
  sidebarMarkerId,
  type SidebarListMarker,
} from "../Sidebar.logic";
import { SIDEBAR_SECTION_MARKS } from "./sectionMarks";
import { SIDEBAR_SORTABLE_DRAG_DISABLED } from "./SidebarThreadRow";

function SortableSidebarMarker(props: {
  marker: SidebarListMarker;
  className?: string;
  children?: ReactNode;
  revealOverflow?: boolean;
  "data-testid"?: string;
}) {
  const { node, setNodeRef, transform, transition } = useSortable({
    id: sidebarMarkerId(props.marker),
    disabled: SIDEBAR_SORTABLE_DRAG_DISABLED,
    animateLayoutChanges: animateSidebarLayoutChanges,
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the projected drop box inside the scroll viewport as drag transforms move it
  useLayoutEffect(() => {
    if (props.revealOverflow && transform?.y !== undefined) {
      node.current?.firstElementChild?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [node, props.revealOverflow, transform?.y]);
  return (
    <li
      ref={setNodeRef}
      data-thread-selection-safe
      data-testid={props["data-testid"]}
      className={cn("list-none", props.className)}
      style={{
        transform: CSS.Translate.toString(transform),
        transition: props.marker.endsWith("-placeholder") ? "none" : transition,
        visibility: transform?.scaleY === 0 ? "hidden" : undefined,
      }}
    >
      {props.children}
    </li>
  );
}

export function SidebarSectionPlaceholder(props: {
  marker: "active-placeholder" | "settled-placeholder";
  label: string;
  showHint: boolean;
  isDropTarget: boolean;
}) {
  return (
    <SortableSidebarMarker
      marker={props.marker}
      data-testid={`sidebar-${props.marker}`}
      className="relative mx-0.5 -mb-px h-0"
      // Revealing on every drag scrolls the list out from under the pointer.
      revealOverflow={
        props.marker === "settled-placeholder" && props.showHint && props.isDropTarget
      }
    >
      {props.showHint ? (
        <div
          className={cn(
            "absolute inset-x-0 top-0 flex h-9 items-center justify-center rounded-md border border-dashed border-sidebar-foreground/25 text-xs text-sidebar-foreground/80",
            props.isDropTarget && "border-primary/40 bg-primary/5 text-primary",
          )}
        >
          {props.label}
        </div>
      ) : null}
    </SortableSidebarMarker>
  );
}

export function SidebarDragBoundary(props: {
  marker: "pinned-header" | "pinned-divider";
  label: string;
  visible: boolean;
  isDropTarget: boolean;
}) {
  return (
    <SortableSidebarMarker
      marker={props.marker}
      data-testid={`sidebar-${props.marker}`}
      className="pointer-events-none relative mx-0.5 -mb-px h-0"
    >
      {props.visible ? (
        <div className="sidebar-drag-boundary-label absolute inset-x-2 top-1 flex h-4 items-center gap-2">
          <span
            className={cn(
              "shrink-0 text-xs font-medium",
              props.isDropTarget ? "text-primary" : "text-sidebar-foreground/80",
            )}
          >
            {props.label}
          </span>
          <span
            aria-hidden
            className={cn(
              "h-px flex-1",
              props.isDropTarget ? "bg-primary/50" : "bg-sidebar-foreground/25",
            )}
          />
        </div>
      ) : null}
    </SortableSidebarMarker>
  );
}

export function SidebarSectionHeader(props: {
  marker: "working-header" | "snoozed-header" | "settled-header";
  label: string;
  /** A muted trailing count. */
  count: number;
  className?: string;
  dragging?: boolean;
  isDropTarget?: boolean;
  toggle: { expanded: boolean; onToggle: () => void };
  /** 区分全体の操作。末尾のボタンと、見出しの右クリックで開く。 */
  menu?: {
    label: string;
    onOpen: (position: { x: number; y: number }, source: ContextMenuSource) => void;
  };
}) {
  const { menu } = props;
  const colored = useClientSettings((settings) => settings.sidebarSectionColorsEnabled);
  const shelf =
    props.marker === "working-header"
      ? "working"
      : props.marker === "snoozed-header"
        ? "snoozed"
        : "settled";
  return (
    <SortableSidebarMarker
      marker={props.marker}
      data-testid={`sidebar-${props.marker}`}
      className={cn("group/shelf-header relative mx-0.5 h-8", props.className)}
    >
      <CollapsibleSectionHeader
        data-sidebar-row={`shelf:${shelf}`}
        onClick={props.toggle.onToggle}
        onContextMenu={
          menu
            ? (event) => {
                event.preventDefault();
                menu.onOpen({ x: event.clientX, y: event.clientY }, contextMenuSourceOf(event));
              }
            : undefined
        }
        onKeyDown={menu ? openContextMenuFromKeyboard : undefined}
        expanded={props.toggle.expanded}
        {...(colored ? { lineColor: SIDEBAR_SECTION_MARKS[shelf].color } : {})}
        tone={props.isDropTarget ? "accent" : props.dragging ? "emphasized" : "muted"}
        data-testid={`sidebar-${shelf}-shelf-toggle`}
        accessory={
          <span
            className={cn(
              "font-normal tabular-nums",
              menu &&
                "group-hover/shelf-header:invisible group-has-[[data-sidebar-action-for]:focus]/shelf-header:invisible pointer-coarse:me-7",
            )}
          >
            {props.count}
          </span>
        }
      >
        {props.label}
      </CollapsibleSectionHeader>
      {menu ? (
        // 矢印の左に置く。マウスでは件数に重ね、タッチ端末では件数を左へ寄せて並べる。
        <span className="absolute inset-y-0 right-6 flex items-center opacity-0 focus-within:opacity-100 group-hover/shelf-header:opacity-100 pointer-coarse:opacity-100">
          <Button
            data-sidebar-action-for={`shelf:${shelf}`}
            size="icon-xs"
            variant="ghost-muted"
            aria-label={menu.label}
            aria-haspopup="menu"
            onClick={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              menu.onOpen({ x: bounds.left, y: bounds.bottom }, contextMenuSourceOf(event));
            }}
          >
            <EllipsisIcon aria-hidden />
          </Button>
        </span>
      ) : null}
    </SortableSidebarMarker>
  );
}
