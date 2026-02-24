import Link from "next/link"
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
  currentPage: number;
  totalPages: number;
}

export function BlogPaginationServer({ currentPage, totalPages }: BlogPaginationServerProps) {
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
    <Pagination>
      <PaginationContent>
        <PaginationItem>
          {currentPage === 1 ? (
            <PaginationPrevious className="pointer-events-none opacity-50" />
          ) : (
            <>
              {/* TODO Remove legacyBehavior and passHref when these are resolved: */}
              {/* https://github.com/vercel/next.js/discussions/76329 */}
              {/* https://github.com/vercel/next.js/discussions/80179 */}
              <Link href={`/blog?page=${currentPage - 1}`} passHref legacyBehavior>
                <PaginationPrevious />
              </Link>
            </>
          )}
        </PaginationItem>

        {pageNumbers().map((page, index) => (
          <PaginationItem key={index}>
            {page === 'ellipsis' ? (
              <PaginationEllipsis />
            ) : (
              <Link href={`/blog?page=${page}`} passHref legacyBehavior>
                <PaginationLink isActive={currentPage === page}>
                  {page}
                </PaginationLink>
              </Link>
            )}
          </PaginationItem>
        ))}

        <PaginationItem>
          {currentPage === totalPages ? (
            <PaginationNext className="pointer-events-none opacity-50" />
          ) : (
            <Link href={`/blog?page=${currentPage + 1}`} passHref legacyBehavior>
              <PaginationNext />
            </Link>
          )}
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
