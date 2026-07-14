interface BlogEmptyStateProps {
  message: string
}

export function BlogEmptyState({ message }: BlogEmptyStateProps) {
  return (
    <div className="rounded-xl border border-dashed py-16 text-center">
      <p className="text-muted-foreground">{message}</p>
    </div>
  )
}
