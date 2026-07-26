"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { PlatformUserDto } from "@/features/platform-admin/platform-admin-contracts";

import { DirectoryEmpty, DirectoryHeader } from "./directory-primitives";
import { formatDateKey, roleLabel } from "./platform-admin-format";

export function UserDirectory({
  users,
  total,
}: {
  users: PlatformUserDto[];
  total: number;
}) {
  const [search, setSearch] = useState("");
  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return users;
    return users.filter((user) =>
      [
        user.name,
        user.email,
        user.organizationName,
        user.isPrimaryAccount ? "主账号" : "子账号",
        roleLabel(user.role),
        user.status === "active" ? "正常" : "停用",
      ]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [search, users]);

  return (
    <div className="p-4 sm:p-5 lg:p-7">
      <DirectoryHeader
        eyebrow="账号治理"
        title="全部用户"
        description="跨组织查看主账号与子账号、角色、状态和加入时间。"
        trailing={
          <span className="text-xs text-[var(--ink-400)]">
            共 {total} 个成员关系
          </span>
        }
      />

      <label className="relative mb-4 block max-w-md">
        <span className="sr-only">搜索全部用户</span>
        <Search
          aria-hidden="true"
          className="absolute top-2.5 left-3 h-4 w-4 text-[var(--ink-300)]"
        />
        <input
          aria-label="搜索全部用户"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索姓名、邮箱、组织、账号类型、角色或状态"
          className="h-9 w-full rounded-md border border-[var(--line)] bg-white pr-3 pl-9 text-sm outline-none focus:border-[var(--blue-600)] focus:ring-2 focus:ring-blue-100"
        />
      </label>

      {filteredUsers.length > 0 ? (
        <div className="overflow-x-auto rounded-[var(--r-lg)] border border-[var(--line)] bg-white shadow-[var(--shadow-card)]">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-[var(--bg-soft)] text-xs text-[var(--ink-500)]">
              <tr>
                <th className="px-4 py-3 font-medium">用户</th>
                <th className="px-4 py-3 font-medium">组织</th>
                <th className="px-4 py-3 font-medium">账号类型</th>
                <th className="px-4 py-3 font-medium">角色</th>
                <th className="px-4 py-3 font-medium">账号状态</th>
                <th className="px-4 py-3 font-medium">加入日期</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => (
                <tr
                  key={user.membershipId}
                  className="border-t border-[var(--line)]"
                >
                  <td className="px-4 py-3">
                    <p className="font-medium">{user.name}</p>
                    <p className="text-xs text-[var(--ink-400)]">
                      {user.email}
                    </p>
                  </td>
                  <td className="px-4 py-3">{user.organizationName}</td>
                  <td className="px-4 py-3">
                    <Badge tone={user.isPrimaryAccount ? "blue" : "neutral"}>
                      {user.isPrimaryAccount ? "主账号" : "子账号"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">{roleLabel(user.role)}</td>
                  <td className="px-4 py-3">
                    <Badge tone={user.status === "active" ? "green" : "red"}>
                      {user.status === "active" ? "正常" : "停用"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-[var(--ink-500)]">
                    {formatDateKey(user.joinedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <DirectoryEmpty
          title="没有匹配用户"
          description="调整搜索条件后重试。"
        />
      )}
    </div>
  );
}
