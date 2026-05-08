"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Bell,
  Bot,
  CheckCircle2,
  FileText,
  Globe2,
  Languages,
  LayoutDashboard,
  Megaphone,
  MessageSquareText,
  Plus,
  Search,
  Store,
  Workflow
} from "lucide-react";
import type { ReactNode } from "react";
import { getDictionary } from "@/lib/dictionaries";

const dictionary = getDictionary();

const navItems = [
  { href: "/dashboard", label: dictionary.nav.dashboard, icon: LayoutDashboard },
  { href: "/stores", label: dictionary.nav.stores, icon: Store },
  { href: "/ai-settings", label: dictionary.nav.aiSettings, icon: Bot },
  { href: "/languages", label: dictionary.nav.languages, icon: Languages },
  { href: "/campaigns", label: dictionary.nav.campaigns, icon: Megaphone },
  { href: "/articles", label: dictionary.nav.articles, icon: FileText },
  { href: "/brand-voice", label: dictionary.nav.brandVoice, icon: MessageSquareText },
  { href: "/logs", label: dictionary.nav.logs, icon: Activity }
];

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="admin-shell">
      <aside className="sidebar" aria-label="主导航">
        <Link href="/dashboard" className="brand" aria-label={dictionary.productName}>
          <span className="brand__mark">
            <Workflow size={20} aria-hidden="true" />
          </span>
          <span>
            <strong>{dictionary.productName}</strong>
            <small>{dictionary.workspaceName}</small>
          </span>
        </Link>

        <nav className="nav-list">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={isActive ? "nav-link nav-link--active" : "nav-link"}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar__footer">
          <div className="sidebar__footer-row">
            <CheckCircle2 size={16} aria-hidden="true" />
            <span>{dictionary.common.cnDefault}</span>
          </div>
          <small>{dictionary.common.enReserved}</small>
          <div className="sidebar__chips" aria-label="系统能力">
            <span>8 modules</span>
            <span>zh-CN</span>
          </div>
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
            <button className="icon-button" type="button" aria-label="通知">
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
