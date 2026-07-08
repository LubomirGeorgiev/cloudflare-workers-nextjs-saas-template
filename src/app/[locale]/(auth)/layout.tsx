import NavFooterLayout from "@/layouts/NavFooterLayout";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <NavFooterLayout renderFooter={false}>{children}</NavFooterLayout>;
}
