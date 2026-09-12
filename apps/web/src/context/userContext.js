import { createContext } from "react";

export const UserContext = createContext({ user: null, organization: null, updateUser: () => {}, clearUser: () => {} });
