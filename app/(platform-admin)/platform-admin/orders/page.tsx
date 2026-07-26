import { OrderDirectory } from "@/components/platform-admin/order-directory";
import { PlatformAdminShell } from "@/components/platform-admin/platform-admin-shell";
import { listPlatformOrders } from "@/features/platform-admin/platform-admin-read-service";

import { getPlatformAdminPageData } from "../platform-admin-page-data";

export default async function OrdersPage() {
  const { actor, repo, period } = await getPlatformAdminPageData();
  const orders = await listPlatformOrders({
    repo,
    query: { page: 1, pageSize: 50, period },
  });
  return (
    <PlatformAdminShell
      currentPath="/platform-admin/orders"
      administratorName={actor.name}
    >
      <OrderDirectory orders={orders.items} total={orders.meta.total} />
    </PlatformAdminShell>
  );
}
