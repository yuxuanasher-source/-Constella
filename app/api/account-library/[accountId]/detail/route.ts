import { NextResponse } from "next/server";

import {
  listAccountBanRecords,
  listAccountDevices,
  listAccountLoginLogs,
  listAccountMetrics,
  listAccountStatusLogs,
} from "@/features/account-library/account-library-queries";
import {
  getAccountLibraryRouteContext,
  jsonServiceError,
} from "@/features/account-library/account-library-route-utils";
import {
  toAccountBanRecordDtos,
  toAccountDeviceDtos,
  toAccountLoginLogDtos,
  toAccountMetricsDtos,
  toAccountStatusLogDtos,
} from "@/features/account-library/account-library-ui-adapters";

// 账号安全/生命周期/指标详情聚合：设备白名单、登录日志、封禁存档、状态流转、日指标
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const context = await getAccountLibraryRouteContext();
    if (context instanceof NextResponse) {
      return context;
    }
    const { supabase } = context;

    const { accountId } = await params;
    const [statusLogs, devices, loginLogs, banRecords, metrics] =
      await Promise.all([
        listAccountStatusLogs(supabase, accountId),
        listAccountDevices(supabase, accountId),
        listAccountLoginLogs(supabase, accountId),
        listAccountBanRecords(supabase, accountId),
        listAccountMetrics(supabase, accountId),
      ]);

    return NextResponse.json({
      statusLogs: toAccountStatusLogDtos(statusLogs),
      devices: toAccountDeviceDtos(devices),
      loginLogs: toAccountLoginLogDtos(loginLogs),
      banRecords: toAccountBanRecordDtos(banRecords),
      metrics: toAccountMetricsDtos(metrics),
    });
  } catch (error) {
    return jsonServiceError(error);
  }
}
