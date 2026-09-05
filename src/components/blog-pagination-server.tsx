import { getBlogCollectionPagePath } from "@/lib/blog-routing"
import { getTranslator } from "@/i18n/translator";
import { getPathname } from "@/i18n/navigation"
import type { Locale } from "@/i18n/config"
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"

interface BlogPaginationServerProps {
  // Locale-agnostic list path (e.g. "/blog", "/blog/tags/x") the page links are built from.
  pathname: string;
  currentPage: number;
  totalPages: number;
  locale: Locale;
}

export async function BlogPaginationServer({ currentPage, totalPages, locale, pathname }: BlogPaginationServerProps) {
  const t = await getTranslator({ locale, namespace: "Client.Pagination" });
  // `PaginationLink` renders a plain `<a href>`, so the href must already carry
  // any active locale prefix or pagination can drop the visitor's locale.
  const pageHref = (page: number) => getPathname({ href: getBlogCollectionPagePath({ pathname, page }), locale })
  const pageNumbers = () => {
    const pages: (number | 'ellipsis')[] = [];
    const showEllipsisThreshold = 7;

    if (totalPages <= showEllipsisThreshold) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      if (currentPage <= 3) {
        for (let i = 1; i <= 4; i++) {
          pages.push(i);
        }
        pages.push('ellipsis');
        pages.push(totalPages);
      } else if (currentPage >= totalPages - 2) {
        pages.push(1);
        pages.push('ellipsis');
        for (let i = totalPages - 3; i <= totalPages; i++) {
          pages.push(i);
        }
      } else {
        pages.push(1);
        pages.push('ellipsis');
        pages.push(currentPage - 1);
        pages.push(currentPage);
        pages.push(currentPage + 1);
        pages.push('ellipsis');
        pages.push(totalPages);
      }
    }

    return pages;
  }

  if (totalPages <= 1) {
    return null;
  }


  return (
    <Pagination ariaLabel={t("navAria")}>
      <PaginationContent>
        <PaginationItem>
          {currentPage === 1 ? (
            <PaginationPrevious
              className="pointer-events-none opacity-50"
              label={t("previous")}
              ariaLabel={t("previousAria")}
            />
          ) : (
            <PaginationPrevious
              href={pageHref(currentPage - 1)}
              label={t("previous")}
              ariaLabel={t("previousAria")}
            />
          )}
        </PaginationItem>

        {pageNumbers().map((page, index) => (
          <PaginationItem key={index}>
            {page === 'ellipsis' ? (
              <PaginationEllipsis label={t("morePages")} />
            ) : (
              <PaginationLink href={pageHref(page)} isActive={currentPage === page}>
                {page}
              </PaginationLink>
            )}
          </PaginationItem>
        ))}

        <PaginationItem>
          {currentPage === totalPages ? (
            <PaginationNext
              className="pointer-events-none opacity-50"
              label={t("next")}
              ariaLabel={t("nextAria")}
            />
          ) : (
            <PaginationNext
              href={pageHref(currentPage + 1)}
              label={t("next")}
              ariaLabel={t("nextAria")}
            />
          )}
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
