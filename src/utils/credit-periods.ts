export function getOneCalendarMonthAfter(date: Date): Date {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();

  let oneMonthAfter = new Date(year, month + 1, day);

  if (oneMonthAfter.getDate() !== day) {
    oneMonthAfter = new Date(year, month + 2, 0);
  }

  oneMonthAfter.setHours(date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds());

  return oneMonthAfter;
}

export function getOneCalendarMonthBefore(date: Date): Date {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();

  let oneMonthBefore = new Date(year, month - 1, day);

  if (oneMonthBefore.getDate() !== day) {
    oneMonthBefore = new Date(year, month, 0);
  }

  oneMonthBefore.setHours(date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds());

  return oneMonthBefore;
}

export function shouldRefreshCreditsFromDate(
  lastCreditRefreshAt: Date | null | undefined,
  currentTime: Date
): boolean {
  if (!lastCreditRefreshAt) {
    return true;
  }

  return currentTime >= getOneCalendarMonthAfter(new Date(lastCreditRefreshAt));
}

export function getNextCreditRefreshAt({
  lastCreditRefreshAt,
  now,
}: {
  lastCreditRefreshAt: Date | null | undefined;
  now: Date;
}): Date {
  if (!lastCreditRefreshAt) {
    return now;
  }

  const nextRefreshAt = getOneCalendarMonthAfter(new Date(lastCreditRefreshAt));
  return nextRefreshAt <= now ? now : nextRefreshAt;
}
