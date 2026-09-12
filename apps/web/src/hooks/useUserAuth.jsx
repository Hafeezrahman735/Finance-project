import { useContext, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { UserContext } from "../context/userContext";
import { auth } from "../lib/api";

/** Loads /auth/me once per session; sends the visitor to /login when the token is missing or stale. */
export function useUserAuth() {
  const { user, updateUser, clearUser } = useContext(UserContext);
  const navigate = useNavigate();

  useEffect(() => {
    if (user) return;
    if (!localStorage.getItem("token")) {
      navigate("/login");
      return;
    }
    let mounted = true;
    auth
      .me()
      .then((data) => mounted && updateUser(data))
      .catch(() => {
        if (!mounted) return;
        clearUser();
        navigate("/login");
      });
    return () => {
      mounted = false;
    };
  }, [user, updateUser, clearUser, navigate]);
}
