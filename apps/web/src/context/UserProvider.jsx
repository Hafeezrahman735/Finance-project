import React, { useCallback, useMemo, useState } from "react";
import { UserContext } from "./userContext";

export default function UserProvider({ children }) {
  const [user, setUser] = useState(null);
  const [organization, setOrganization] = useState(null);

  const updateUser = useCallback((data) => {
    // Accepts either { user, organization } (auth responses) or a bare user.
    if (data && data.user) {
      setUser(data.user);
      setOrganization(data.organization ?? null);
    } else {
      setUser(data ?? null);
    }
  }, []);

  const clearUser = useCallback(() => {
    setUser(null);
    setOrganization(null);
  }, []);

  const value = useMemo(() => ({ user, organization, updateUser, clearUser }), [user, organization, updateUser, clearUser]);
  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}
