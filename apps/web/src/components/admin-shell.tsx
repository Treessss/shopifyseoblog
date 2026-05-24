"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Bell,
  Bot,
  Boxes,
  CheckCircle2,
  ChevronDown,
  FileText,
  Globe2,
  Languages,
  LayoutDashboard,
  Megaphone,
  Radar,
  MessageSquareText,
  ListTodo,
  Search,
  Settings2,
  Plus,
  Store
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { getDictionary } from "@/lib/dictionaries";
import { ProductLogo } from "@/components/product-logo";

const dictionary = getDictionary();

const navGroups = [
  {
    id: "overview",
    label: "开始",
    description: "只留一个起点",
  icon: LayoutDashboard,
    items: [
      { href: "/dashboard", label: dictionary.nav.dashboard, icon: LayoutDashboard },
      { href: "/agents", label: dictionary.nav.agents, icon: Bot }
    ]
  },
  {
    id: "execution",
    label: "执行",
    description: "店铺 / 任务 / 文章",
    icon: Boxes,
    items: [
      { href: "/stores", label: dictionary.nav.stores, icon: Store },
      { href: "/campaigns", label: dictionary.nav.campaigns, icon: Megaphone },
      { href: "/articles", label: dictionary.nav.articles, icon: FileText },
      { href: "/content-rules", label: dictionary.nav.contentRules, icon: CheckCircle2 }
    ]
  },
  {
    id: "insights",
    label: "洞察",
    description: "研究 / 优先级 / 复盘",
    icon: Radar,
    items: [
      { href: "/research", label: dictionary.nav.research, icon: Radar },
      { href: "/search-console", label: "Search Console", icon: Search },
      { href: "/priorities", label: "优先级板", icon: ListTodo },
      { href: "/performance-review", label: "性能复盘", icon: Activity }
    ]
  },
  {
    id: "platform",
    label: "设置",
    description: "AI / 语言 / 品牌 / 日志",
    icon: Settings2,
    items: [
      { href: "/ai-settings", label: dictionary.nav.aiSettings, icon: Bot },
      { href: "/languages", label: dictionary.nav.languages, icon: Languages },
      { href: "/brand-voice", label: dictionary.nav.brandVoice, icon: MessageSquareText },
      { href: "/logs", label: dictionary.nav.logs, icon: Activity }
    ]
  }
];

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const activeGroup = navGroups.find((group) => group.items.some((item) => isActivePath(pathname, item.href)));
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set(["overview", activeGroup?.id ?? "overview"]));

  function toggleGroup(groupId: string) {
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }

  return (
    <div className="admin-shell">
      <aside className="sidebar" aria-label="主导航">
        <Link href="/dashboard" className="brand" aria-label={dictionary.productName}>
          <span className="brand__mark">
            <ProductLogo size={40} />
          </span>
          <span>
            <strong>{dictionary.productName}</strong>
            <small>{dictionary.workspaceName}</small>
          </span>
        </Link>

        <nav className="nav-list">
          {navGroups.map((group) => {
            const GroupIcon = group.icon;
            const groupActive = group.items.some((item) => isActivePath(pathname, item.href));
            const expanded = openGroups.has(group.id) || groupActive;

            return (
              <section className={groupActive ? "nav-group nav-group--active" : "nav-group"} key={group.id}>
                <button
                  className="nav-group__trigger"
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={`nav-group-${group.id}`}
                  title={`${group.label} · ${group.description}`}
                  onClick={() => toggleGroup(group.id)}
                >
                  <span className="nav-group__icon">
                    <GroupIcon size={17} aria-hidden="true" />
                  </span>
                  <span>
                    <strong>{group.label}</strong>
                    <small>{group.description}</small>
                  </span>
                  <ChevronDown className="nav-group__chevron" size={16} aria-hidden="true" />
                </button>

                {expanded ? (
                  <div className="nav-sublist" id={`nav-group-${group.id}`}>
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const isActive = isActivePath(pathname, item.href);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={isActive ? "nav-link nav-link--active" : "nav-link"}
                          aria-current={isActive ? "page" : undefined}
                          title={item.label}
                        >
                          <Icon size={16} aria-hidden="true" />
                          <span>{item.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            );
          })}
        </nav>

        <div className="sidebar__footer">
          <div className="sidebar__footer-row">
            <CheckCircle2 size={16} aria-hidden="true" />
            <span>按“开始 → 执行 → 洞察”走</span>
          </div>
          <small>{dictionary.common.cnDefault}，复杂功能都放在次级入口里。</small>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <form className="search-box" action={pathname} method="get" role="search">
            <Search size={17} aria-hidden="true" />
            <label className="sr-only" htmlFor="global-admin-search">
              {dictionary.common.search}
            </label>
            <input id="global-admin-search" name="q" placeholder={dictionary.common.search} />
          </form>
          <div className="topbar__actions">
            <span className="topbar__status">
              <Globe2 size={15} aria-hidden="true" />
              多店铺在线
            </span>
            <button className="icon-button" type="button" aria-label="通知" title="通知">
              <Bell size={18} aria-hidden="true" />
            </button>
            <Link href="/campaigns" className="button button--primary">
              <Plus size={17} aria-hidden="true" />
              {dictionary.common.newCampaign}
            </Link>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
