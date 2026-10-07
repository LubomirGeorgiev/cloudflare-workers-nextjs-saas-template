import { CmsWriteReloadToast } from "./_components/zone-purge-warning";

export default function CmsAdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <CmsWriteReloadToast />
    </>
  );
}
