import Link from "next/link";

import type { OpsV2NavItem } from "./navigation";

export function MobileNavigation({
  activeHref,
  items,
}: {
  activeHref: string;
  items: readonly OpsV2NavItem[];
}) {
  return (
    <nav className="ops-v2-mobile-nav" aria-label="移动端业务导航">
      {items.map((item) => {
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
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
