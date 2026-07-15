import { useSessionStore } from "@/state/session";
import { signOutAction } from "@/actions/sign-out.action";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import { getPathname } from "@/i18n/navigation";

const useSignOut = () => {
  const { clearSession } = useSessionStore();
  const locale = useLocale();
  const t = useTranslations("Client.Settings.Nav");

  const signOut = async () => {
    const toastId = toast.loading(t("toastSigningOut"));

    try {
      const { serverError } = await signOutAction();

      if (serverError) {
        throw new Error(serverError.message);
      }

      clearSession();
      toast.dismiss(toastId);
      // Full reload on purpose (clears client state); keep the locale prefix
      // so a Spanish user lands on /es without a middleware redirect hop.
      window.location.replace(getPathname({ href: "/", locale }));
    } catch (error) {
      toast.dismiss(toastId);
      toast.error(error instanceof Error ? error.message : t("toastSignOutError"));
    }
  };

  return { signOut };
};

export default useSignOut;
