import OpsReferenceApp from "@/components/reference-ui/ops-reference";

import {
  currentUserFromAuth,
  organizationSettingsFromAuth,
  requireConsoleStaffAuth,
} from "./console-auth";

export default async function ConsolePage() {
  const { auth } = await requireConsoleStaffAuth();

  return (
    <OpsReferenceApp
      initialRoute="warroom"
      currentUser={currentUserFromAuth(auth)}
      organizationSettings={organizationSettingsFromAuth(auth)}
    />
  );
}
