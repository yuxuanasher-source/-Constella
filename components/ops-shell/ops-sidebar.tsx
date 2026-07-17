import Image from "next/image";
import Link from "next/link";

import type { OpsV2NavItem } from "./navigation";

export function OpsSidebar({
  brandName,
  activeHref,
  items,
}: {
  brandName: string;
  activeHref: string;
  items: readonly OpsV2NavItem[];
}) {
  return (
    <aside className="ops-v2-sidebar" aria-label="经营端主导航">
      <div className="ops-v2-brand">
        <Image
          className="ops-v2-brand-mark"
          src="/brand/ops-mascot-logo.png"
          alt="经营舱品牌标识"
          width={32}
          height={32}
          priority
        />
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{brandName}</div>
          <div className="ops-v2-muted">MCN OPERATIONS</div>
        </div>
      </div>
      <nav className="ops-v2-nav" aria-label="业务页面">
        {items.map((item) => {
          const Icon = item.icon;
          const active = item.href === activeHref;
          return (
            <Link
              key={item.href}
              className="ops-v2-nav-item"
              data-active={active ? "true" : "false"}
              aria-current={active ? "page" : undefined}
              href={item.href}
              prefetch={false}
            >
              <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
