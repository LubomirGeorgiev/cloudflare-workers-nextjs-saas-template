const FILE_SIZE_UNITS = ["Bytes", "KB", "MB", "GB"] as const;

export function formatFileSize(bytes: number): string {
  if (bytes === 0) {
    return `0 ${FILE_SIZE_UNITS[0]}`;
  }

  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    FILE_SIZE_UNITS.length - 1
  );

  return `${parseFloat((bytes / 1024 ** exponent).toFixed(2))} ${FILE_SIZE_UNITS[exponent]}`;
}
