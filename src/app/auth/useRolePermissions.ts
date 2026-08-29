import React from "react";
import { AuthContext } from "../../ui/context/AuthContext";
import type { Role } from "../../shared/permissions";
import {
  type Permission,
  canAccessManageSection,
  canAccessPeopleTab,
  getAllowedManageSections,
  getAllowedPeopleTabs,
  getDefaultManageSection,
  getDefaultPeopleTab,
  isReportsOnlyRole,
  roleHasPermission,
} from "../../shared/permissions";
import type { ManagerSection, PeopleTab } from "../../shared/manageSections";
import { peopleTabFromHash } from "../../ui/screens/Manager/managerSections";

export function useRolePermissions() {
  const auth = React.useContext(AuthContext);
  const role = auth?.session?.role as Role | undefined;

  return React.useMemo(() => {
    if (!role) {
      return {
        role: undefined as Role | undefined,
        has: (_permission: Permission) => false,
        allowedManageSections: [] as ManagerSection[],
        allowedPeopleTabs: [] as PeopleTab[],
        reportsOnly: false,
        canOpenManageSection: (_section: ManagerSection | null, _hash?: string) => false,
      };
    }

    return {
      role,
      has: (permission: Permission) => roleHasPermission(role, permission),
      allowedManageSections: getAllowedManageSections(role),
      allowedPeopleTabs: getAllowedPeopleTabs(role),
      reportsOnly: isReportsOnlyRole(role),
      canOpenManageSection: (section: ManagerSection | null, hash?: string) => {
        if (!section) {
          return roleHasPermission(role, "page:manager") || isReportsOnlyRole(role);
        }
        if (section === "people") {
          const tab = peopleTabFromHash(hash ?? (typeof window !== "undefined" ? window.location.hash : ""));
          return canAccessPeopleTab(role, tab);
        }
        if (section === "reports" && isReportsOnlyRole(role)) {
          return true;
        }
        return canAccessManageSection(role, section);
      },
      defaultManageSection: getDefaultManageSection(role),
      defaultPeopleTab: getDefaultPeopleTab(role),
    };
  }, [role]);
}
