import { useContext, useEffect } from "react";
import { UserContext } from "../context/userContent";
import { useNavigate } from "react-router-dom";
import axiosInstance from "../utils/axiosinstance";
import { API_PATHS } from "../utils/apiPaths";

export const useUserAuth = () => {
    const {user, updateUser, clearUser} = useContext(UserContext);
    const navigate = useNavigate();

    useEffect(() => {
        if (user) return;

        let isMounted = true;

        const fetchUserInfo = async () => {
            try {
                const response = await axiosInstance.get(API_PATHS.AUTH.ME);

                if (isMounted && response.data?.user) {
                    updateUser(response.data.user);
                }
            } catch (error) {
                console.error("Failed to fetch user Information", error);
                if (isMounted) {
                    clearUser();
                    navigate("/login");
                }
            }
        };
        fetchUserInfo();

        return () => {
            isMounted = false;
        };
    }, [updateUser,clearUser,navigate]);
};