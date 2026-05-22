import { useSessionStore } from "@/state/session";
import { signOutAction } from "@/actions/sign-out.action";
import { toast } from "sonner";

const useSignOut = () => {
  const { clearSession } = useSessionStore();

  const signOut = async () => {
    const toastId = toast.loading("Signing out...");

    try {
      const { serverError } = await signOutAction();

      if (serverError) {
        throw new Error(serverError.message);
      }

      clearSession();
      toast.dismiss(toastId);
      window.location.replace("/");
    } catch (error) {
      toast.dismiss(toastId);
      toast.error(error instanceof Error ? error.message : "Failed to sign out");
    }
  };

  return { signOut };
};

export default useSignOut;
