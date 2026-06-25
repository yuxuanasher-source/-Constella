import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import OpsReferenceApp from "./ops-reference";

describe("OpsReferenceApp organization member actions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const organizationMembers = [
    {
      id: "member-finance",
      userId: "user-finance",
      email: "finance@example.com",
      name: "Finance User",
      role: "finance",
      status: "active",
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
    },
  ];
  const suspendedOrganizationMembers = [
    {
      ...organizationMembers[0],
      status: "suspended",
    },
  ];

  it("shows the live member count in the sidebar instead of the quota", () => {
    render(
      <OpsReferenceApp
        initialRoute="org"
        organizationMembers={organizationMembers}
        organizationSettings={{ name: "Real Org", memberLimit: 32 }}
      />,
    );

    expect(
      screen.getByText(/\u5f53\u524d\u7ec4\u7ec7 \u00b7 1 \u540d\u6210\u5458/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        /\u5f53\u524d\u7ec4\u7ec7 \u00b7 32 \u540d\u6210\u5458/,
      ),
    ).not.toBeInTheDocument();
  });

  it("hides internal user IDs and local placeholder emails from member rows", () => {
    render(
      <OpsReferenceApp
        initialRoute="org"
        organizationMembers={[
          {
            id: "member-subaccount",
            userId: "4f4d4578-877e-4a27-a437-655f341bd382",
            email: "jy-jwh8du@subaccount.local",
            name: "Sub Account",
            role: "streamer",
            status: "active",
            createdAt: "2026-06-03T00:00:00.000Z",
            updatedAt: "2026-06-03T00:00:00.000Z",
          },
        ]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /\u6210\u5458\u7ba1\u7406/ }),
    );

    expect(
      screen.getByText(
        /\u9ed8\u8ba4\u8d26\u53f7 jy-jwh8du \u00b7 \u9996\u6b21\u767b\u5f55\u5f85\u6fc0\u6d3b/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/4f4d4578/)).not.toBeInTheDocument();
    expect(screen.queryByText(/subaccount\.local/)).not.toBeInTheDocument();
  });

  it("hides member creation controls when the backend reports no creatable roles", () => {
    render(
      <OpsReferenceApp
        initialRoute="org"
        organizationMembers={organizationMembers}
        organizationMemberPermissions={{
          actorRole: "streamer",
          canCreateMembers: false,
          creatableRoles: [],
        }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /\u6210\u5458\u7ba1\u7406/ }),
    );

    expect(
      screen.getByText(
        /\u5f53\u524d\u89d2\u8272\u65e0\u521b\u5efa\u6743\u9650/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: /\u9080\u8bf7\u6210\u5458/,
      }),
    ).toBeNull();
  });

  it("derives organization overview metrics from live projects, streamers and billing data", () => {
    render(
      <OpsReferenceApp
        initialRoute="org"
        organizationMembers={[
          { ...organizationMembers[0], status: "active" },
          {
            ...organizationMembers[0],
            id: "member-invite",
            userId: "user-invite",
            email: "invite@example.com",
            name: "Invite User",
            status: "invited",
          },
        ]}
        organizationMemberPermissions={{
          actorRole: "owner",
          canViewMembers: true,
          canCreateMembers: true,
          creatableRoles: ["streamer"],
        }}
        organizationSettings={{ id: "org-real", name: "Real Org" }}
        projectCards={[
          { id: "project-active", status: "active" },
          { id: "project-recruiting", status: "recruiting" },
          { id: "project-archived", status: "archived" },
        ]}
        streamerCards={[
          { id: "streamer-active", cooperation: "active" },
          { id: "streamer-signed", cooperation: "signed" },
        ]}
        billingStatus={{
          plan: { tier: "basic", code: "basic", name: "基础版" },
          subscriptionStatus: "active",
          mode: "active",
          entitlements: {},
          usage: [
            { metric: "storage_mb", usedQuantity: 2048, allowanceQuantity: 0 },
            { metric: "ocr", usedQuantity: 8, allowanceQuantity: 0 },
            { metric: "ai", usedQuantity: 12, allowanceQuantity: 0 },
            { metric: "export", usedQuantity: 3, allowanceQuantity: 0 },
          ],
        }}
      />,
    );

    expect(screen.getAllByText("Real Org").length).toBeGreaterThan(0);
    expect(screen.getByText("基础版")).toBeInTheDocument();
    expect(screen.getByText("2 位合作中")).toBeInTheDocument();
    expect(screen.getByText("共 3 个项目")).toBeInTheDocument();
    expect(screen.getByText("2.0 GB")).toBeInTheDocument();
    expect(screen.getByText("23")).toBeInTheDocument();
    expect(screen.queryByText("187")).not.toBeInTheDocument();
    expect(screen.queryByText("84.2 GB")).not.toBeInTheDocument();
    expect(screen.queryByText("14.6k")).not.toBeInTheDocument();
  });

  it("submits member invitations to the organization members API", async () => {
    const fetchMock = vi.fn(async (url, init) => {
      if (
        String(url) === "/api/organization/members" &&
        init?.method === "POST"
      ) {
        return {
          ok: true,
          json: async () => ({
            member: {
              ...organizationMembers[0],
              id: "member-invite",
              email: "invite@example.com",
              name: "Invite User",
              role: "operator_business",
              status: "invited",
            },
          }),
        };
      }
      if (String(url) === "/api/organization/members") {
        return {
          ok: true,
          json: async () => ({ members: organizationMembers }),
        };
      }
      return { ok: false, json: async () => ({ error: "unexpected request" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="org"
        organizationMembers={organizationMembers}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /成员管理/ }));
    expect(screen.getByText(/finance@example\.com/)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "邀请成员" })[0]);
    fireEvent.change(screen.getByLabelText("成员邮箱"), {
      target: { value: "invite@example.com" },
    });
    fireEvent.change(screen.getByLabelText("成员姓名"), {
      target: { value: "Invite User" },
    });
    fireEvent.change(screen.getByLabelText("成员角色"), {
      target: { value: "operator_business" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送邀请" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/organization/members",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"mode":"invite"'),
        }),
      ),
    );
  });

  it("creates subaccounts and shows generated first-login credentials", async () => {
    const fetchMock = vi.fn(async (url, init) => {
      if (
        String(url) === "/api/organization/members" &&
        init?.method === "POST"
      ) {
        return {
          ok: true,
          json: async () => ({
            member: {
              ...organizationMembers[0],
              id: "member-sub",
              email: "jy-sub-001@subaccount.local",
              name: "Sub Account",
              role: "streamer",
              status: "active",
            },
            credentials: {
              account: "jy-sub-001",
              password: "A1b2C3d4",
              requiresActivation: true,
            },
          }),
        };
      }
      if (String(url) === "/api/organization/members") {
        return {
          ok: true,
          json: async () => ({ members: organizationMembers }),
        };
      }
      return { ok: false, json: async () => ({ error: "unexpected request" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="org"
        organizationMembers={organizationMembers}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /成员管理/ }));
    fireEvent.click(screen.getAllByRole("button", { name: "邀请成员" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "创建子账号" }));
    fireEvent.change(screen.getByLabelText("成员姓名"), {
      target: { value: "Sub Account" },
    });
    fireEvent.change(screen.getByLabelText("成员角色"), {
      target: { value: "streamer" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认创建" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/organization/members",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"mode":"subaccount"'),
        }),
      ),
    );
    const createCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url) === "/api/organization/members" && init?.method === "POST",
    );
    expect(createCall?.[1].body).not.toContain("temporaryPassword");
    expect(await screen.findByText(/jy-sub-001/)).toBeInTheDocument();
    expect(await screen.findByText(/A1b2C3d4/)).toBeInTheDocument();
  });

  it("updates member roles through the organization member detail API", async () => {
    const fetchMock = vi.fn(async (url, init) => {
      if (
        String(url) === "/api/organization/members/member-finance" &&
        init?.method === "PATCH"
      ) {
        return {
          ok: true,
          json: async () => ({
            member: { ...organizationMembers[0], role: "ops_manager" },
          }),
        };
      }
      if (String(url) === "/api/organization/members") {
        return {
          ok: true,
          json: async () => ({ members: organizationMembers }),
        };
      }
      return { ok: false, json: async () => ({ error: "unexpected request" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="org"
        organizationMembers={organizationMembers}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /成员管理/ }));
    fireEvent.click(screen.getByRole("button", { name: "编辑角色" }));
    fireEvent.change(screen.getByLabelText("新角色"), {
      target: { value: "ops_manager" },
    });
    fireEvent.change(screen.getByLabelText("变更原因"), {
      target: { value: "接管项目审批" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存角色" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/organization/members/member-finance",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining('"role":"ops_manager"'),
        }),
      ),
    );
  });

  it("suspends active members through the organization member detail API", async () => {
    const fetchMock = vi.fn(async (url, init) => {
      if (
        String(url) === "/api/organization/members/member-finance" &&
        init?.method === "PATCH"
      ) {
        return {
          ok: true,
          json: async () => ({
            member: { ...organizationMembers[0], status: "suspended" },
          }),
        };
      }
      if (String(url) === "/api/organization/members") {
        return {
          ok: true,
          json: async () => ({ members: organizationMembers }),
        };
      }
      return { ok: false, json: async () => ({ error: "unexpected request" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="org"
        organizationMembers={organizationMembers}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /成员管理/ }));
    fireEvent.click(screen.getByRole("button", { name: "停用成员" }));
    fireEvent.change(screen.getByLabelText("状态变更原因"), {
      target: { value: "离职停用账号" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认停用" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/organization/members/member-finance",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining('"status":"suspended"'),
        }),
      ),
    );
  });

  it("reactivates suspended members through the organization member detail API", async () => {
    const fetchMock = vi.fn(async (url, init) => {
      if (
        String(url) === "/api/organization/members/member-finance" &&
        init?.method === "PATCH"
      ) {
        return {
          ok: true,
          json: async () => ({
            member: { ...suspendedOrganizationMembers[0], status: "active" },
          }),
        };
      }
      if (String(url) === "/api/organization/members") {
        return {
          ok: true,
          json: async () => ({ members: suspendedOrganizationMembers }),
        };
      }
      return { ok: false, json: async () => ({ error: "unexpected request" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="org"
        organizationMembers={suspendedOrganizationMembers}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /成员管理/ }));
    fireEvent.click(screen.getByRole("button", { name: "恢复成员" }));
    fireEvent.change(screen.getByLabelText("状态变更原因"), {
      target: { value: "重新加入团队" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认恢复" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/organization/members/member-finance",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining('"status":"active"'),
        }),
      ),
    );
  });
});
